import pg from 'pg'
import type { PoolClient, PoolConfig } from 'pg'
import { artifactRefSchema } from './store.ts'
import type { ArtifactRef } from './store.ts'
import { objectEnvelopeSchema, parseObjectKey } from './encrypted-backend.ts'
import type { ObjectEnvelope, VersionedCiphertextTransport } from './encrypted-backend.ts'
import { uuid } from '../contracts/primitives.ts'

type ObjectRole = 'forge_object_reader' | 'forge_object_writer' | 'forge_object_maintenance'

/** Separate object login, same database as E1 for atomic adoption/retirement.
 * pg.Pool is connection reuse only; no data or queue lives in this process.
 * This is a trusted internal service port: key-derived RLS context is NOT caller
 * authentication. A user request must first authorize the current E1 principal
 * and read a DB-owned ArtifactRef through ArtifactStore. Never expose raw keys.
 * This class never applies schema, configures retention, or supplies credentials. */
export class PostgresCiphertextTransport implements VersionedCiphertextTransport {
  readonly evidence = 'durable' as const
  readonly pool: pg.Pool
  constructor(
    config: PoolConfig,
    readonly role: ObjectRole
  ) {
    if (!['forge_object_reader', 'forge_object_writer', 'forge_object_maintenance'].includes(role))
      throw new Error('Invalid object role')
    this.pool = new pg.Pool({
      max: 2,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 5000,
      ...config,
    })
    this.pool.on('error', () => {
      /* Redact driver connection details. */
    })
  }
  async check() {
    const c = await this.pool.connect()
    let broken = false,
      failed = false
    try {
      const unsafe = await c.query(
        `SELECT 1 FROM pg_roles r WHERE
       (r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER')) AND
       (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR
        r.rolname IN('forge_object_guard','forge_control_guard','forge_control_api','forge_control_worker','forge_control_maintenance') OR
        (r.rolname IN('forge_object_reader','forge_object_writer','forge_object_maintenance') AND r.rolname<>$1) OR
        EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
          WHERE n.nspname IN('forge_objects','forge_control') AND t.relowner=r.oid) OR
        EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN('forge_objects','forge_control') AND n.nspowner=r.oid)) LIMIT 1`,
        [this.role]
      )
      if (unsafe.rowCount) throw new Error('Unsafe storage login')
      await c.query(`SET ROLE ${this.role}`)
      if (this.role === 'forge_object_maintenance')
        await c.query("SELECT 1 FROM forge_objects.candidates('') LIMIT 0")
      else await c.query('SELECT object_key FROM forge_objects.versions LIMIT 0')
    } catch {
      failed = true
    } finally {
      try {
        await c.query('RESET ROLE')
      } catch {
        broken = true
      }
      c.release(broken)
    }
    if (failed || broken) throw new Error('Storage role or schema check failed')
  }
  private async tx<T>(key: string | null, fn: (c: PoolClient) => Promise<T>) {
    const scope = key === null ? null : parseObjectKey(key)
    const c = await this.pool.connect()
    let broken = false
    try {
      await c.query('BEGIN')
      await c.query(`SET LOCAL ROLE ${this.role}`)
      await c.query(
        "SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'"
      )
      await c.query(
        "SELECT set_config('forge.object_workspace',$1,true),set_config('forge.object_project',$2,true)",
        [scope?.workspaceId ?? '', scope?.projectId ?? '']
      )
      const result = await fn(c)
      await c.query('COMMIT')
      return result
    } catch {
      try {
        await c.query('ROLLBACK')
      } catch {
        broken = true
      }
      throw new Error('Object operation unavailable')
    } finally {
      c.release(broken)
    }
  }
  async create(key: string, version: string, input: ObjectEnvelope) {
    if (this.role !== 'forge_object_writer') throw new Error('Object write unavailable')
    const s = parseObjectKey(key),
      e = objectEnvelopeSchema.parse(input)
    uuid.parse(version)
    await this.tx(key, (c) =>
      c.query(
        `INSERT INTO forge_objects.versions
     (object_key,workspace_id,project_id,job_id,object_id,version,key_id,nonce,tag,ciphertext)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          key,
          s.workspaceId,
          s.projectId,
          s.jobId,
          s.id,
          version,
          e.keyId,
          e.nonce,
          e.tag,
          Buffer.from(e.ciphertext),
        ]
      )
    )
  }
  async read(key: string, version: string) {
    uuid.parse(version)
    return this.tx(key, async (c) => {
      const {
        rows: [row],
      } = await c.query(
        `SELECT key_id,nonce,tag,ciphertext FROM forge_objects.versions
       WHERE object_key=$1 AND version=$2 AND state='available'`,
        [key, version]
      )
      if (!row) throw new Error('Object unavailable')
      return objectEnvelopeSchema.parse({
        schemaVersion: 1,
        keyId: row.key_id,
        nonce: row.nonce,
        tag: row.tag,
        ciphertext: row.ciphertext,
      })
    })
  }
  async retire(key: string, version: string) {
    if (this.role !== 'forge_object_maintenance') throw new Error('Object retirement unavailable')
    uuid.parse(version)
    return this.tx(
      key,
      async (c) =>
        (await c.query('SELECT forge_objects.retire($1,$2) AS done', [key, version])).rows[0]
          .done as boolean
    )
  }
  async purge(key: string, version: string) {
    if (this.role !== 'forge_object_maintenance') throw new Error('Object purge unavailable')
    uuid.parse(version)
    return this.tx(
      key,
      async (c) =>
        (await c.query('SELECT forge_objects.purge($1,$2) AS done', [key, version])).rows[0]
          .done as boolean
    )
  }
  /** Bounded sweep; caller persists cursor and schedules next run in external
   * maintenance. Failed operations leave durable state for a later retry. */
  async sweep(after = '') {
    if (this.role !== 'forge_object_maintenance') throw new Error('Object sweep unavailable')
    if (after) parseObjectKey(after)
    const rows = await this.tx(
      null,
      async (c) =>
        (
          await c.query<{ object_key: string; version: string; state: string }>(
            'SELECT * FROM forge_objects.candidates($1)',
            [after]
          )
        ).rows
    )
    let retired = 0,
      purged = 0,
      retained = 0,
      failed = 0
    for (const r of rows) {
      try {
        if (r.state === 'available') {
          if (await this.retire(r.object_key, r.version)) retired++
          else retained++
        } else {
          if (await this.purge(r.object_key, r.version)) purged++
          else retained++
        }
      } catch {
        failed++
      }
    }
    return {
      scanned: rows.length,
      retired,
      purged,
      retained,
      failed,
      next: rows.length === 100 ? rows.at(-1)!.object_key : null,
    }
  }
  close() {
    return this.pool.end()
  }
}

/** Call inside the SAME ControlDatabase worker transaction as artifact INSERT,
 * after lease/scope validation. Keep lock until insert + state commit. Never call
 * using a separate object connection. Does not authorize a job or validate bytes.
 * Integration remains disabled until Task 01 wires this into source adoption. */
export async function lockObjectForAdoption(c: PoolClient, input: ArtifactRef) {
  const ref = artifactRefSchema.parse(input)
  const s = parseObjectKey(ref.storageKey)
  if (
    s.workspaceId !== ref.workspaceId ||
    s.projectId !== ref.projectId ||
    s.jobId !== ref.jobId ||
    s.id !== ref.id
  )
    throw new Error('Object adoption scope mismatch')
  await c.query('SELECT forge_objects.adopt($1,$2,$3,$4)', [
    ref.storageKey,
    ref.storageVersion,
    ref.workspaceId,
    ref.projectId,
  ])
}
