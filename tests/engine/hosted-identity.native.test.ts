import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { startNativePostgres } from './native-postgres.ts'
import { HostedIdentityBridge } from '../../engine/control/hosted-identity.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { CredentialConnections, CredentialCipher } from '../../engine/providers/credentials.ts'
import { PostgresCredentialRepository } from '../../engine/providers/credentials-postgres.ts'
import { CredentialConnectionAuthorizer } from '../../engine/control/credential-authorization.ts'
import { hostedConnectionPolicy } from '../../engine/providers/hosted-catalog.ts'

let db: Awaited<ReturnType<typeof startNativePostgres>>
let bridge: HostedIdentityBridge
const issuer = 'https://forge.example.invalid/api/auth'
const sql = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
beforeAll(async () => {
  db = await startNativePostgres()
  for (const file of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ])
    await db.admin.query(sql(`drizzle/${file}`))
  for (const file of [
    '0003_immutable_source_bridge.sql',
    '0004_hosted_identity.sql',
    '0005_hosted_byok.sql',
  ])
    await db.admin.query(sql(`engine/migrations/${file}`))
  await db.admin.query(
    'INSERT INTO forge_control.hosted_identity_settings(issuer,enabled,max_users) VALUES($1,true,100)',
    [issuer]
  )
  bridge = new HostedIdentityBridge(db.api, randomBytes(32))
}, 30000)
afterAll(async () => {
  await db?.close()
})

async function parent(verified = true) {
  const id = randomUUID(),
    sessionId = randomUUID(),
    token = randomBytes(32).toString('base64url')
  await db.admin.query(
    'INSERT INTO public.forge_user(id,name,email,email_verified) VALUES($1,$2,$3,$4)',
    [id, 'Synthetic owner', `${id}@example.invalid`, verified]
  )
  await db.admin.query(
    "INSERT INTO public.forge_session(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [sessionId, id, token]
  )
  return { id, sessionId, token }
}
it('enrolls a verified immutable account once under concurrent requests, with a private owner workspace', async () => {
  const a = await parent()
  const results = await Promise.all(Array.from({ length: 6 }, () => bridge.connect(a.token)))
  expect(new Set(results.map((r) => r.userId)).size).toBe(1)
  expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1)
  expect(new Set(results.map((r) => r.sessionToken)).size).toBe(1)
  const { rows } = await db.admin.query(
    'SELECT oidc_issuer,oidc_subject FROM forge_control.users WHERE id=$1',
    [results[0].userId]
  )
  expect(rows).toEqual([{ oidc_issuer: issuer, oidc_subject: a.id }])
  await db.api.session(results[0].sessionToken, results[0].workspaceId, 'owner', async (tx, p) => {
    expect(p.user_id).toBe(results[0].userId)
    expect((await tx.query('SELECT id FROM workspaces')).rows).toEqual([
      { id: results[0].workspaceId },
    ])
  })
})
it('rejects unknown, unverified and disabled parent accounts before allocating any workspace', async () => {
  await expect(bridge.connect(randomBytes(32).toString('base64url'))).rejects.toThrow()
  const a = await parent(false)
  await expect(bridge.connect(a.token)).rejects.toThrow('UNAUTHENTICATED')
  await db.admin.query(
    'UPDATE public.forge_user SET email_verified=true,disabled_at=now() WHERE id=$1',
    [a.id]
  )
  await expect(bridge.connect(a.token)).rejects.toThrow('UNAUTHENTICATED')
  expect(
    (
      await db.admin.query('SELECT 1 FROM forge_control.hosted_identities WHERE auth_user_id=$1', [
        a.id,
      ])
    ).rowCount
  ).toBe(0)
})
it('isolates two account workspaces and does not expose parent or child bearer tokens in persisted mappings', async () => {
  const a = await parent(),
    b = await parent()
  const x = await bridge.connect(a.token),
    y = await bridge.connect(b.token)
  await expect(
    db.api.session(x.sessionToken, y.workspaceId, 'owner', async () => true)
  ).rejects.toThrow('NOT_FOUND')
  const rows = await db.admin.query(
    'SELECT * FROM forge_control.hosted_sessions WHERE user_id=$1',
    [x.userId]
  )
  const text = JSON.stringify(rows.rows)
  expect(text).not.toContain(a.token)
  expect(text).not.toContain(x.sessionToken)
  expect(rows.rows[0].session_hash).toBe(sha256(x.sessionToken))
})
it.each(['delete', 'expire', 'disable', 'unverify'] as const)(
  'immediately denies child sessions after parent %s',
  async (operation) => {
    const a = await parent(),
      child = await bridge.connect(a.token)
    if (operation === 'delete')
      await db.admin.query('DELETE FROM public.forge_session WHERE id=$1', [a.sessionId])
    if (operation === 'expire')
      await db.admin.query(
        "UPDATE public.forge_session SET expires_at=now()-interval '1 second' WHERE id=$1",
        [a.sessionId]
      )
    if (operation === 'disable')
      await db.admin.query('UPDATE public.forge_user SET disabled_at=now() WHERE id=$1', [a.id])
    if (operation === 'unverify')
      await db.admin.query('UPDATE public.forge_user SET email_verified=false WHERE id=$1', [a.id])
    await expect(
      db.api.session(child.sessionToken, child.workspaceId, 'owner', async () => true)
    ).rejects.toThrow('UNAUTHENTICATED')
    await expect(bridge.connect(a.token)).rejects.toThrow('UNAUTHENTICATED')
  }
)
it('does not refresh session age by enrolling later or re-enrolling, and rejects a forged unlinked child', async () => {
  const a = await parent()
  await db.admin.query(
    "UPDATE public.forge_session SET created_at=now()-interval '1 hour',expires_at=now()+interval '1 hour' WHERE id=$1",
    [a.sessionId]
  )
  const child = await bridge.connect(a.token)
  const rows = await db.admin.query(
    "SELECT created_at<now()-interval '59 minutes' AS stale,expires_at FROM forge_control.sessions WHERE id_hash=$1",
    [sha256(child.sessionToken)]
  )
  expect(rows.rows[0].stale).toBe(true)
  await bridge.connect(a.token)
  expect(
    (
      await db.admin.query('SELECT expires_at FROM forge_control.sessions WHERE id_hash=$1', [
        sha256(child.sessionToken),
      ])
    ).rows[0].expires_at
  ).toEqual(rows.rows[0].expires_at)
  const forged = randomBytes(32).toString('base64url')
  await db.api.tx((tx) =>
    tx.query(
      "INSERT INTO sessions(id_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [sha256(forged), child.userId, sha256(forged)]
    )
  )
  await expect(
    db.api.session(forged, child.workspaceId, 'owner', async () => true)
  ).rejects.toThrow('UNAUTHENTICATED')
})
it('does not restore revoked owner membership or re-enable disabled workspaces', async () => {
  const a = await parent(),
    child = await bridge.connect(a.token)
  await db.admin.query('DELETE FROM forge_control.memberships WHERE user_id=$1', [child.userId])
  await expect(bridge.connect(a.token)).rejects.toThrow('FORBIDDEN')
  const b = await parent(),
    other = await bridge.connect(b.token)
  await db.admin.query('UPDATE forge_control.workspaces SET disabled_at=now() WHERE id=$1', [
    other.workspaceId,
  ])
  await expect(bridge.connect(b.token)).rejects.toThrow('FORBIDDEN')
})
it('preserves a revoked child instead of silently minting another one', async () => {
  const a = await parent(),
    child = await bridge.connect(a.token)
  await db.api.tx((tx) =>
    tx.query('SELECT logout_session($1,$2)', [sha256(child.sessionToken), sha256(child.csrfToken)])
  )
  await expect(bridge.connect(a.token)).rejects.toThrow('UNAUTHENTICATED')
})
it('fences workers on account suspension and never grants API access to auth data or identity enrollment tables', async () => {
  const a = await parent(),
    child = await bridge.connect(a.token)
  const allowed = () =>
    db.worker.scoped(
      child.workspaceId,
      async (tx) =>
        (
          await tx.query('SELECT allowed FROM worker_actor($1,$2)', [
            child.workspaceId,
            child.userId,
          ])
        ).rows[0].allowed
    )
  expect(await allowed()).toBe(true)
  await db.admin.query('UPDATE public.forge_user SET disabled_at=now() WHERE id=$1', [a.id])
  expect(await allowed()).toBe(false)
  for (const table of [
    'public.forge_user',
    'public.forge_session',
    'hosted_identities',
    'hosted_sessions',
  ])
    await expect(db.api.tx((tx) => tx.query(`SELECT * FROM ${table}`))).rejects.toThrow(
      'permission denied'
    )
  await expect(
    db.worker.tx((tx) =>
      tx.query('SELECT * FROM bridge_hosted_session($1,$2,$3)', [
        a.token,
        sha256(a.token),
        sha256(a.token),
      ])
    )
  ).rejects.toThrow('permission denied')
})
it('stores tenant-bound encrypted keys and invalidates model selection on rotation and deletion', async () => {
  const a = await parent(),
    identity = await bridge.connect(a.token)
  const authority = new CredentialConnectionAuthorizer(
    db.api,
    bridge,
    'https://forge.example.invalid'
  )
  const repository = new PostgresCredentialRepository(db.api, authority)
  const encryption = randomBytes(32)
  const cipher = new CredentialCipher({
    async currentKeyId() {
      return 'test'
    },
    async resolve() {
      return encryption
    },
  })
  const connections = new CredentialConnections(
    authority,
    repository,
    cipher,
    hostedConnectionPolicy,
    'https://forge.example.invalid'
  )
  const auth = {
    ...identity,
    origin: 'https://forge.example.invalid',
    transport: 'authenticated-tls' as const,
  }
  const key = `synthetic-${randomBytes(20).toString('hex')}`
  const connected = await connections.mutate(auth, 'connect', async () => ({
    provider: 'groq',
    key,
  }))
  const record = await repository.read(identity.workspaceId, connected.id, auth)
  expect(record?.envelope).toBeTruthy()
  expect(JSON.stringify(record)).not.toContain(key)
  expect(
    await cipher.decrypt(
      {
        workspaceId: record!.workspaceId,
        id: record!.id,
        revision: record!.revision,
        provider: record!.provider,
        destination: record!.destination,
      },
      record!.envelope!
    )
  ).toBe(key)
  await db.api.session(identity.sessionToken, identity.workspaceId, 'owner', async (tx) => {
    await tx.query(
      "INSERT INTO provider_validations(workspace_id,credential_id,revision,model,free_tier_confirmed) VALUES($1,$2,1,'openai/gpt-oss-20b',true)",
      [identity.workspaceId, connected.id]
    )
    await tx.query('INSERT INTO provider_choices VALUES($1,$2)', [
      identity.workspaceId,
      connected.id,
    ])
  })
  await connections.mutate(auth, 'rotate', async () => ({
    id: connected.id,
    expectedRevision: 1,
    key: `replacement-${randomBytes(20).toString('hex')}`,
  }))
  expect(
    (
      await db.admin.query('SELECT 1 FROM forge_control.provider_choices WHERE workspace_id=$1', [
        identity.workspaceId,
      ])
    ).rowCount
  ).toBe(0)
  expect(
    (
      await db.admin.query(
        'SELECT 1 FROM forge_control.provider_validations WHERE workspace_id=$1',
        [identity.workspaceId]
      )
    ).rowCount
  ).toBe(0)
  await expect(
    connections.mutate(auth, 'rotate', async () => ({ id: connected.id, expectedRevision: 1, key }))
  ).rejects.toThrow()
  await connections.mutate(auth, 'delete', async () => ({ id: connected.id, expectedRevision: 2 }))
  expect(await repository.read(identity.workspaceId, connected.id, auth)).toMatchObject({
    deleted: true,
    envelope: null,
    revision: 3,
  })
  const b = await parent(),
    other = await bridge.connect(b.token)
  await expect(connections.status({ ...auth, ...other }, connected.id)).rejects.toThrow()
  await db.admin.query('DELETE FROM public.forge_session WHERE id=$1', [a.sessionId])
  await expect(
    connections.mutate(auth, 'connect', async () => ({ provider: 'groq', key }))
  ).rejects.toThrow()
})
it('never makes an old Better Auth session fresh enough to manage credentials', async () => {
  const a = await parent()
  await db.admin.query(
    "UPDATE public.forge_session SET created_at=now()-interval '1 hour',expires_at=now()+interval '1 hour' WHERE id=$1",
    [a.sessionId]
  )
  const identity = await bridge.connect(a.token)
  const authority = new CredentialConnectionAuthorizer(
    db.api,
    bridge,
    'https://forge.example.invalid'
  )
  await expect(
    authority.authorize({
      sessionToken: identity.sessionToken,
      workspaceId: identity.workspaceId,
      csrfToken: identity.csrfToken,
      origin: 'https://forge.example.invalid',
      operation: 'connect',
    })
  ).rejects.toThrow('REAUTHENTICATION_REQUIRED')
})
it('enforces the installation enrollment cap atomically and fails closed while disabled', async () => {
  const count = Number(
    (await db.admin.query('SELECT count(*) FROM forge_control.hosted_identities')).rows[0].count
  )
  await db.admin.query('UPDATE forge_control.hosted_identity_settings SET max_users=$1', [
    count + 1,
  ])
  const parents = await Promise.all([parent(), parent()])
  const results = await Promise.allSettled(parents.map((a) => bridge.connect(a.token)))
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  const active = results.find((r) => r.status === 'fulfilled')!
  if (active.status !== 'fulfilled') throw new Error('test setup')
  await db.admin.query('UPDATE forge_control.hosted_identity_settings SET enabled=false')
  await expect(
    db.api.session(active.value.sessionToken, active.value.workspaceId, 'owner', async () => true)
  ).rejects.toThrow('UNAUTHENTICATED')
})
