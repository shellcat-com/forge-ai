import { randomUUID } from 'node:crypto'
import type { PoolClient, Pool } from 'pg'
import { pool } from '../db'
import { ByokError, validateDestination } from './transport'
import { vault, credentialBinding } from './vault'
import type { CredentialEnvelope } from './vault'
import {
  connectionInputSchema,
  modelProfileSchema,
  routingSchema,
  selectionsOf,
  taskRoles,
} from '../../shared/byok'
import type {
  ProviderConnection,
  ModelProfile,
  RoutingProfile,
  RunSnapshot,
  Selection,
} from '../../shared/byok'
export interface Principal {
  id: string
  local: boolean
  sessionId?: string
}
export interface ConnectionRow {
  id: string
  owner_id: string
  label: string
  provider: ProviderConnection['provider']
  protocol: ProviderConnection['protocol']
  base_url: string
  revision: number
  envelope: CredentialEnvelope | null
  secret_ref: string | null
  models: ModelProfile[]
  deleted: boolean
  updated_at: Date
}
export type Transaction = Pick<PoolClient, 'query'>
export class ConnectionStore {
  constructor(
    readonly database: Pool = pool(),
    private readonly cipher = vault()
  ) {}
  async transaction<T>(who: Principal, action: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.database.connect()
    try {
      await tx.query('BEGIN')
      await tx.query("SELECT set_config('forge.byok_owner',$1,true)", [who.id])
      // Owner lock gives routing updates, limits, connection mutations and dispatch a common order.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['byok:' + who.id])
      if (!who.local) {
        const session = await tx.query(
          'SELECT id FROM forge_session WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR SHARE',
          [who.sessionId ?? '', who.id]
        )
        if (!session.rowCount)
          throw new ByokError('SESSION', 'Sign in again before using this connection.', 401)
      }
      const result = await action(tx)
      await tx.query('COMMIT')
      return result
    } catch (error) {
      await tx.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      tx.release()
    }
  }
  async read(tx: Transaction, owner: string, id: string, lock = false): Promise<ConnectionRow> {
    const row = await tx.query<ConnectionRow>(
      `SELECT * FROM forge_connections WHERE owner_id=$1 AND id=$2 AND NOT deleted${lock ? ' FOR UPDATE' : ''}`,
      [owner, id]
    )
    if (!row.rows[0])
      throw new ByokError(
        'CONNECTION',
        'Connection unavailable. Select or reconnect your model.',
        404
      )
    return row.rows[0]
  }
  public(row: ConnectionRow): ProviderConnection {
    return {
      id: row.id,
      label: row.label,
      provider: row.provider,
      protocol: row.protocol,
      baseUrl: row.base_url,
      revision: row.revision,
      configured: !row.deleted && (!!row.envelope || !!row.secret_ref || row.protocol === 'ollama'),
      deleted: row.deleted,
      models: row.models.map((m) => modelProfileSchema.parse(m)),
      updatedAt: new Date(row.updated_at).toISOString(),
    }
  }
  async list(who: Principal, query = '', cursor?: string) {
    return this.transaction(who, async (tx) => {
      const rows = await tx.query<ConnectionRow>(
        'SELECT * FROM forge_connections WHERE owner_id=$1 AND NOT deleted AND label ILIKE $2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 51',
        [who.id, '%' + query.slice(0, 80).replace(/[%_\\]/g, '\\$&') + '%', cursor ?? null]
      )
      return {
        connections: rows.rows.slice(0, 50).map((r) => this.public(r)),
        nextCursor: rows.rows.length > 50 ? rows.rows[49].id : null,
      }
    })
  }
  async connect(who: Principal, raw: unknown) {
    const input = connectionInputSchema.parse(raw)
    validateDestination(input)
    if (!input.key && input.protocol !== 'ollama')
      throw new ByokError('KEY', 'Enter your provider API key.')
    const row = {
      id: randomUUID(),
      owner_id: who.id,
      label: input.label,
      provider: input.provider,
      protocol: input.protocol,
      base_url: input.baseUrl,
      revision: 1,
    }
    const envelope = input.key ? await this.cipher.encrypt(credentialBinding(row), input.key) : null
    return this.transaction(who, async (tx) => {
      const result = await tx.query<ConnectionRow>(
        'INSERT INTO forge_connections(id,owner_id,label,provider,protocol,base_url,envelope) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [row.id, who.id, row.label, row.provider, row.protocol, row.base_url, envelope]
      )
      return this.public(result.rows[0])
    })
  }
  async change(who: Principal, id: string, revision: number, key?: string) {
    return this.transaction(who, async (tx) => {
      const old = await this.read(tx, who.id, id, true)
      if (old.revision !== revision)
        throw new ByokError('STALE', 'Connection changed. Reload before trying again.', 409)
      const envelope = key
        ? await this.cipher.encrypt(credentialBinding({ ...old, revision: revision + 1 }), key)
        : null
      const result = await tx.query<ConnectionRow>(
        "UPDATE forge_connections SET revision=revision+1,envelope=$3,secret_ref=NULL,deleted=$4,models='[]',updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *",
        [who.id, id, envelope, !key]
      )
      return this.public(result.rows[0])
    })
  }
  async key(row: ConnectionRow, who: Principal) {
    if (row.deleted) throw new ByokError('REVOKED', 'Connection was revoked.')
    if (row.envelope) return this.cipher.decrypt(credentialBinding(row), row.envelope)
    if (row.secret_ref) {
      if (
        !who.local ||
        !/^(GEMINI_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY)$/.test(
          row.secret_ref
        )
      )
        throw new ByokError('KEY', 'Server key references are available only to local owners.')
      const value = process.env[row.secret_ref]
      if (!value) throw new ByokError('KEY', 'The configured server secret is unavailable.')
      return value
    }
    if (row.protocol !== 'ollama') throw new ByokError('KEY', 'Reconnect this provider.')
  }
  async saveModels(who: Principal, id: string, revision: number, models: ModelProfile[]) {
    return this.transaction(who, async (tx) => {
      const old = await this.read(tx, who.id, id, true)
      if (old.revision !== revision)
        throw new ByokError('STALE', 'Connection changed during model discovery.', 409)
      // Capability tests are retained only for matching model configuration.
      const result = await tx.query<ConnectionRow>(
        'UPDATE forge_connections SET models=$3,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *',
        [who.id, id, JSON.stringify(models.map((m) => modelProfileSchema.parse(m)))]
      )
      return this.public(result.rows[0])
    })
  }
  async snapshot(tx: Transaction, who: Principal, profile: RoutingProfile): Promise<RunSnapshot> {
    const routing = routingSchema.parse(profile),
      bindings: RunSnapshot['bindings'] = []
    for (const selection of selectionsOf(routing)) {
      const row = await this.read(tx, who.id, selection.connectionId)
      const model = row.models.find((m) => m.id === selection.modelId)
      if (!model) throw new ByokError('MODEL', 'Choose a saved model for every task.')
      bindings.push({
        ...selection,
        revision: row.revision,
        profile: modelProfileSchema.parse(model),
      })
    }
    const snapshot: RunSnapshot = { version: 1, routing, bindings }
    for (const role of taskRoles) {
      const targets = [
        routing.assignments[role],
        ...routing.candidates[role],
        ...routing.fallbacks[role],
      ]
      for (const target of targets) if (target) requireCapability(snapshot, target, role)
    }
    if (routing.router) requireCapability(snapshot, routing.router, 'router')
    return snapshot
  }
  async profile(who: Principal, scope: string) {
    return this.transaction(who, async (tx) => {
      await assertScope(tx, who.id, scope)
      const rows = await tx.query(
        'SELECT scope,revision,profile FROM forge_routing_profiles WHERE owner_id=$1 AND scope=ANY($2::text[]) ORDER BY (scope=$3) DESC LIMIT 1',
        [who.id, [scope, 'account'], scope]
      )
      const saved = rows.rows[0]
      if (!saved) return null
      const ids = [
        ...new Set(selectionsOf(routingSchema.parse(saved.profile)).map((s) => s.connectionId)),
      ]
      const connections = await tx.query(
        'SELECT id,label,provider,deleted FROM forge_connections WHERE owner_id=$1 AND id=ANY($2::uuid[])',
        [who.id, ids]
      )
      return { ...saved, connections: connections.rows }
    })
  }
  async saveProfile(
    who: Principal,
    scope: string,
    input: RoutingProfile,
    expectedRevision: number
  ) {
    return this.transaction(who, async (tx) => {
      await assertScope(tx, who.id, scope)
      await this.snapshot(tx, who, input)
      const prior = await tx.query(
        'SELECT revision FROM forge_routing_profiles WHERE owner_id=$1 AND scope=$2 FOR UPDATE',
        [who.id, scope]
      )
      if ((prior.rows[0]?.revision ?? 0) !== expectedRevision)
        throw new ByokError('STALE', 'Routing changed. Reload before saving.', 409)
      const r = await tx.query(
        'INSERT INTO forge_routing_profiles(owner_id,scope,profile) VALUES($1,$2,$3) ON CONFLICT(owner_id,scope) DO UPDATE SET profile=$3,revision=forge_routing_profiles.revision+1,updated_at=now() RETURNING scope,revision,profile',
        [who.id, scope, input]
      )
      return r.rows[0]
    })
  }
}
export async function assertScope(tx: Transaction, owner: string, scope: string) {
  if (scope === 'account') return
  const p = await tx.query('SELECT id FROM forge_projects WHERE id=$1 AND owner_id=$2', [
    scope,
    owner,
  ])
  if (!p.rowCount) throw new ByokError('PROJECT', 'Project not found.', 404)
}
export function requireCapability(
  snapshot: RunSnapshot,
  selection: Selection,
  role: string,
  verified = true
) {
  const bound = snapshot.bindings.find(
    (b) => b.connectionId === selection.connectionId && b.modelId === selection.modelId
  )
  const capability =
    role === 'research'
      ? 'research'
      : ['coding', 'repair', 'review', 'router'].includes(role)
        ? 'structured'
        : 'text'
  if (
    !bound ||
    !bound.profile.capabilities[capability] ||
    (verified && !bound.profile.verified.includes(capability))
  )
    throw new ByokError(
      'CAPABILITY',
      `Test this model's ${capability} capability before assigning it to ${role}.`
    )
  return bound
}
