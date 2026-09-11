import { z } from 'zod'
import { CredentialCipher, CredentialConnections } from '../../../engine/providers/credentials'
import type { CredentialAuth } from '../../../engine/providers/credentials'
import { PostgresCredentialRepository } from '../../../engine/providers/credentials-postgres'
import { CredentialConnectionAuthorizer } from '../../../engine/control/credential-authorization'
import {
  checkHostedModel,
  hostedCatalog,
  hostedConnectionPolicy,
  ConnectionCheckError,
} from '../../../engine/providers/hosted-catalog'
import { sha256 } from '../../../engine/contracts/canonical'
import { hostedActor } from './hosted'
import { AccessError } from '../auth/access'
import { smallJson } from '../http/local'
import { safeError } from '../../../engine/control/contracts'
import { apiError } from '../auth/access'

export function connectionError(error: unknown) {
  if (error instanceof AccessError) return apiError(error)
  if (error instanceof Error && error.message === 'CREDENTIAL_OPERATION_DENIED')
    return apiError(
      new AccessError(
        422,
        'The key could not be updated. Reload, check your input, and sign in again if needed.'
      )
    )
  const safe = safeError(error)
  const message =
    safe.status === 401
      ? 'Sign in again before changing model connections.'
      : safe.status === 403
        ? 'This account cannot manage these connections.'
        : safe.status === 404
          ? 'Connection not found.'
          : safe.status === 429
            ? 'The connection limit was reached. Wait before retrying.'
            : safe.status === 422
              ? 'Check the connection details and try again.'
              : 'Connections are unavailable. Retry after the installation is configured.'
  return apiError(new AccessError(safe.status, message))
}

export async function connectionContext(request: Request, mutation: boolean) {
  const identity = await hostedActor(request, mutation)
  const authority = new CredentialConnectionAuthorizer(
    identity.control.db,
    identity.control.bridge,
    identity.origin
  )
  const credentialAuth: CredentialAuth = {
    sessionToken: identity.sessionToken,
    workspaceId: identity.workspaceId,
    csrfToken: identity.csrfToken,
    origin: identity.origin,
    transport: 'authenticated-tls',
  }
  const cipher = new CredentialCipher({
    async currentKeyId() {
      return process.env.FORGE_CREDENTIAL_KEY_ID ?? 'v1'
    },
    async resolve(id: string) {
      const keys = z
        .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
        .parse(JSON.parse(process.env.FORGE_CREDENTIAL_KEYS_JSON ?? '{}'))
      if (!keys[id]) throw new Error('CREDENTIAL_KEY_UNAVAILABLE')
      return Buffer.from(keys[id], 'hex')
    },
  })
  const repository = new PostgresCredentialRepository(identity.control.db, authority)
  const connections = new CredentialConnections(
    authority,
    repository,
    cipher,
    hostedConnectionPolicy,
    identity.origin
  )
  return { identity, authority, credentialAuth, cipher, repository, connections }
}
export async function listConnections(request: Request) {
  const { identity } = await connectionContext(request, false)
  const connections = await identity.control.db.session(
    identity.sessionToken,
    identity.workspaceId,
    'owner',
    async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.id,c.provider,c.revision,c.deleted,c.updated_at,v.model,v.checked_at,
      (s.credential_id=c.id) AS selected FROM provider_credentials c
      LEFT JOIN provider_validations v ON v.workspace_id=c.workspace_id AND v.credential_id=c.id AND v.revision=c.revision
      LEFT JOIN provider_choices s ON s.workspace_id=c.workspace_id
      WHERE c.workspace_id=$1 AND NOT c.deleted ORDER BY c.updated_at DESC`,
        [identity.workspaceId]
      )
      return rows.map((row) => ({
        id: row.id as string,
        provider: row.provider as string,
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at).toISOString(),
        model: row.model as string | null,
        checkedAt: row.checked_at ? new Date(row.checked_at).toISOString() : null,
        selected: row.selected === true,
      }))
    }
  )
  return {
    providers: hostedCatalog.map(({ id, name, models, keyUrl }) => ({ id, name, models, keyUrl })),
    connections,
  }
}
export async function mutateConnection(
  request: Request,
  operation: 'connect' | 'rotate' | 'delete',
  id?: string
) {
  const { connections, credentialAuth, authority } = await connectionContext(request, true)
  await authority.authorize({
    sessionToken: credentialAuth.sessionToken,
    workspaceId: credentialAuth.workspaceId,
    csrfToken: credentialAuth.csrfToken,
    origin: credentialAuth.origin,
    operation,
  })
  return connections.mutate(credentialAuth, operation, async () => {
    const input = await smallJson(request, 16000)
    return id
      ? { ...z.record(z.string(), z.unknown()).parse(input), id: z.uuid().parse(id) }
      : input
  })
}
export async function validateConnection(request: Request, id: string) {
  const { identity, authority, credentialAuth, repository, cipher } = await connectionContext(
    request,
    true
  )
  const authInput = {
    sessionToken: credentialAuth.sessionToken,
    workspaceId: credentialAuth.workspaceId,
    csrfToken: credentialAuth.csrfToken,
    origin: credentialAuth.origin,
    operation: 'rotate' as const,
  }
  await authority.authorize(authInput)
  const input = z
    .strictObject({
      model: z.string().min(1).max(200),
      expectedRevision: z.number().int().positive(),
      freeTierConfirmed: z.literal(true),
    })
    .parse(await smallJson(request, 2000))
  const record = await repository.read(identity.workspaceId, z.uuid().parse(id), credentialAuth)
  if (!record || record.deleted || !record.envelope || record.revision !== input.expectedRevision)
    throw new AccessError(409, 'This connection changed. Reload and retry.')
  await authority.withAuthorization(authInput, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO request_rates(key_hash,window_start,attempts) VALUES($1,clock_timestamp(),1)
      ON CONFLICT(key_hash) DO UPDATE SET
       attempts=CASE WHEN request_rates.window_start<clock_timestamp()-interval '1 minute' THEN 1 ELSE request_rates.attempts+1 END,
       window_start=CASE WHEN request_rates.window_start<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE request_rates.window_start END
      RETURNING attempts`,
      [sha256(`connection-check:${identity.workspaceId}`)]
    )
    if (rows[0].attempts > 5)
      throw new AccessError(429, 'Too many connection checks. Wait one minute and retry.')
  })
  const key = await cipher.decrypt(
    {
      workspaceId: record.workspaceId,
      id: record.id,
      revision: record.revision,
      provider: record.provider,
      destination: record.destination,
    },
    record.envelope
  )
  let checked: Awaited<ReturnType<typeof checkHostedModel>>
  try {
    checked = await checkHostedModel(
      {
        provider: record.provider,
        model: input.model,
        key,
        freeTierConfirmed: input.freeTierConfirmed,
      },
      request.signal
    )
  } catch (error) {
    const messages = {
      KEY_REJECTED: 'The provider rejected this key. Replace it and retry.',
      PROVIDER_LIMIT: 'The provider rate limit was reached. Wait and retry.',
      MODEL_UNAVAILABLE: 'This model is not available for this connection.',
      PROVIDER_UNAVAILABLE: 'The provider could not be checked. Retry later.',
      FREE_TIER_REQUIRED: 'A supported free-tier model and account are required.',
    }
    throw new AccessError(
      422,
      messages[error instanceof ConnectionCheckError ? error.code : 'PROVIDER_UNAVAILABLE']
    )
  }
  await authority.withAuthorization(authInput, async (tx) => {
    const { rows } = await tx.query(
      'SELECT revision,deleted FROM provider_credentials WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
      [identity.workspaceId, id]
    )
    if (!rows[0] || rows[0].deleted || Number(rows[0].revision) !== record.revision)
      throw new AccessError(409, 'This connection changed. Reload and retry.')
    await tx.query(
      `INSERT INTO provider_validations(workspace_id,credential_id,revision,model,free_tier_confirmed) VALUES($1,$2,$3,$4,true)
      ON CONFLICT(workspace_id,credential_id) DO UPDATE SET revision=EXCLUDED.revision,model=EXCLUDED.model,free_tier_confirmed=true,checked_at=clock_timestamp()`,
      [identity.workspaceId, id, record.revision, input.model]
    )
    await tx.query(
      `INSERT INTO provider_choices(workspace_id,credential_id) VALUES($1,$2)
      ON CONFLICT(workspace_id) DO UPDATE SET credential_id=EXCLUDED.credential_id`,
      [identity.workspaceId, id]
    )
  })
  return checked
}
