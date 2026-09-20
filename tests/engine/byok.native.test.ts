/** Native PostgreSQL, synthetic tenants/sessions/budgets and dispatch gate. Applies
 * Task04 SQL PROPOSAL to disposable E1 DB, not an integrated/live migration. */
import { beforeAll, afterAll, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID, randomBytes } from 'node:crypto'
import { startNativePostgres } from './native-postgres.ts'
import { byokBinding, byokPolicy, byokRequest } from './byok-fixtures.ts'
import { callTerms } from '../../engine/providers/accounting.ts'
import { PostgresCallAccounting } from '../../engine/providers/accounting-postgres.ts'
import { PostgresCredentialRepository } from '../../engine/providers/credentials-postgres.ts'
import type { CredentialTransactionAuthority } from '../../engine/providers/credentials-postgres.ts'
import { CredentialCipher, CredentialConnections } from '../../engine/providers/credentials.ts'
import type { CredentialAuth } from '../../engine/providers/credentials.ts'
import { ProviderRegistry } from '../../engine/providers/registry.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { one } from '../../engine/control/database.ts'

let db: Awaited<ReturnType<typeof startNativePostgres>>, accounting: PostgresCallAccounting
beforeAll(async () => {
  db = await startNativePostgres()
  await db.admin.query(
    readFileSync(new URL('../../engine/providers/proposals/0005-byok.sql', import.meta.url), 'utf8')
  )
  accounting = new PostgresCallAccounting(db.worker, {
    async lockAndAuthorize(c, t) {
      // Explicit fixture gate. Production additionally needs reviewed global budgets,
      // approved immutable job policy and transactional credential revision checks.
      const j = await one<{ cancel_requested_at: Date | null; state: string }>(
        c,
        'SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE',
        [t.jobId, t.workspaceId, t.projectId]
      )
      const s = await one<{ lease_epoch: string; lease_expires_at: Date; status: string }>(
        c,
        'SELECT * FROM job_steps WHERE id=$1 AND job_id=$2 FOR UPDATE',
        [t.stepId, t.jobId]
      )
      if (
        j.cancel_requested_at ||
        j.state !== 'PLANNING' ||
        Number(s.lease_epoch) !== t.leaseEpoch ||
        s.lease_expires_at.getTime() <= Date.now() ||
        s.status !== 'running'
      )
        throw new Error('FENCED')
    },
  })
}, 30000)
afterAll(async () => {
  await db?.close()
})
async function seed(budget = 100000) {
  const binding = byokBinding(),
    user = randomUUID(),
    token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url')
  await db.admin.query(
    "INSERT INTO forge_control.users(id,oidc_issuer,oidc_subject) VALUES($1::uuid,'https://fixture.test',$1::text)",
    [user]
  )
  await db.admin.query(
    "INSERT INTO forge_control.workspaces(id,name) VALUES($1,'BYOK synthetic workspace')",
    [binding.workspaceId]
  )
  await db.admin.query(
    "INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [binding.workspaceId, user]
  )
  await db.admin.query(
    "INSERT INTO forge_control.sessions(id_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [sha256(token), user, sha256(csrf)]
  )
  await db.admin.query(
    `INSERT INTO forge_control.projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest)
    VALUES($1,$2,'BYOK synthetic','A synthetic task board for native tests','fixture',1,'next-postgres-v1',$3)`,
    [binding.projectId, binding.workspaceId, 'a'.repeat(64)]
  )
  await db.admin.query(
    `INSERT INTO forge_control.jobs(id,workspace_id,project_id,created_by,kind,base_revision,request_json,state,policy_digest,template_digest,prompt_version,model_policy_json,cost_limit_micros,active_remaining_ms)
    VALUES($1,$2,$3,$4,'generate',1,'{"schemaVersion":1}','PLANNING',$5,$5,'fixture','{"schemaVersion":1}',$6,1200000)`,
    [binding.jobId, binding.workspaceId, binding.projectId, user, 'a'.repeat(64), budget]
  )
  await db.admin.query(
    `INSERT INTO forge_control.job_steps(id,workspace_id,project_id,job_id,stage,attempt,status,available_at,lease_owner,lease_epoch,lease_expires_at,input_digest)
    VALUES($1,$2,$3,$4,'PLANNING',1,'running',now(),$5,1,now()+interval '5 minutes',$6)`,
    [
      binding.stepId,
      binding.workspaceId,
      binding.projectId,
      binding.jobId,
      randomUUID(),
      'a'.repeat(64),
    ]
  )
  await db.admin.query(
    `INSERT INTO forge_control.workspace_quotas(workspace_id,period_start,limit_micros,reserved_micros,max_active_jobs,max_previews)
    VALUES($1,date_trunc('day',now()),$2,$2,10,2)`,
    [binding.workspaceId, budget]
  )
  await db.admin.query(
    `INSERT INTO forge_control.usage_reservations(id,workspace_id,project_id,job_id,reserved_micros,status,expires_at,period_start)
    VALUES($1,$2,$3,$4,$5,'open',now()+interval '7 days',date_trunc('day',now()))`,
    [randomUUID(), binding.workspaceId, binding.projectId, binding.jobId, budget]
  )
  return {
    binding,
    user,
    auth: {
      sessionToken: token,
      csrfToken: csrf,
      workspaceId: binding.workspaceId,
      origin: 'https://forge.example.test',
      transport: 'authenticated-tls',
    } as CredentialAuth,
  }
}
it('serializes concurrent call subreservations under the admitted job/workspace cap', async () => {
  const { binding } = await seed(50000)
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      accounting.reserve(callTerms(byokRequest(), byokPolicy, binding))
    )
  )
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(
    (
      await db.admin.query('SELECT provider_calls FROM forge_control.jobs WHERE id=$1', [
        binding.jobId,
      ])
    ).rows[0].provider_calls
  ).toBe(1)
  const rows = (
    await db.admin.query(
      'SELECT maximum_micros,state FROM forge_control.provider_attempts WHERE job_id=$1',
      [binding.jobId]
    )
  ).rows
  expect(rows).toHaveLength(1)
  expect(rows[0].state).toBe('reserved')
})
it('deduplicates reserve and dispatch under races, retains unknown charges and settles once after lease loss', async () => {
  const { binding } = await seed(),
    terms = callTerms(byokRequest(), byokPolicy, binding)
  const results = await Promise.all(Array.from({ length: 6 }, () => accounting.reserve(terms)))
  expect(results.filter((r) => r.created)).toHaveLength(1)
  const receipt = results[0].receipt
  expect(
    (await Promise.all(Array.from({ length: 6 }, () => accounting.dispatch(receipt)))).filter(
      Boolean
    )
  ).toHaveLength(1)
  await accounting.settle(receipt, { classification: 'uncertain', usageDigest: 'b'.repeat(64) })
  expect(
    (
      await db.admin.query(
        'SELECT reserved_micros,spent_micros FROM forge_control.workspace_quotas WHERE workspace_id=$1',
        [binding.workspaceId]
      )
    ).rows[0]
  ).toMatchObject({ reserved_micros: '100000', spent_micros: '0' })
  await db.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=now()-interval '1 second',lease_epoch=2 WHERE id=$1",
    [binding.stepId]
  )
  await expect(accounting.dispatch(receipt)).rejects.toThrow('FENCED')
  const measured = {
    classification: 'measured' as const,
    inputTokens: 10,
    outputTokens: 20,
    amountMicros: 180,
    usageDigest: 'c'.repeat(64),
  }
  await Promise.all(Array.from({ length: 6 }, () => accounting.settle(receipt, measured)))
  expect(
    (
      await db.admin.query('SELECT count(*) FROM forge_control.usage_ledger WHERE job_id=$1', [
        binding.jobId,
      ])
    ).rows[0].count
  ).toBe('1')
  expect(
    (
      await db.admin.query(
        'SELECT reserved_micros,spent_micros FROM forge_control.workspace_quotas WHERE workspace_id=$1',
        [binding.workspaceId]
      )
    ).rows[0]
  ).toMatchObject({ reserved_micros: '99820', spent_micros: '180' })
  await expect(
    accounting.settle(receipt, { ...measured, usageDigest: 'd'.repeat(64) })
  ).rejects.toThrow('CONFLICT')
  await expect(
    accounting.settle({ ...receipt, workspaceId: randomUUID() }, measured)
  ).rejects.toThrow()
})
it('retains unknown maximum on cancellation and denies changed terms, excessive repairs/calls and stale epochs', async () => {
  const { binding } = await seed(1000000),
    t = callTerms(byokRequest(), byokPolicy, binding),
    { receipt } = await accounting.reserve(t)
  await expect(accounting.reserve({ ...t, requestDigest: 'f'.repeat(64) })).rejects.toThrow(
    'CONFLICT'
  )
  await expect(
    accounting.reserve({ ...t, requestId: randomUUID(), leaseEpoch: 2 })
  ).rejects.toThrow('FENCED')
  await expect(
    accounting.reserve({ ...t, requestId: randomUUID(), stage: 'repair', repairNumber: 3 })
  ).rejects.toThrow()
  await accounting.dispatch(receipt)
  await accounting.settle(receipt, { classification: 'uncertain', usageDigest: 'e'.repeat(64) })
  for (let i = 1; i < 12; i++) await accounting.reserve({ ...t, requestId: randomUUID() })
  await expect(accounting.reserve({ ...t, requestId: randomUUID() })).rejects.toThrow('CAP')
  await db.admin.query('UPDATE forge_control.jobs SET cancel_requested_at=now() WHERE id=$1', [
    binding.jobId,
  ])
  await expect(accounting.dispatch(receipt)).rejects.toThrow('FENCED')
  expect(
    (
      await db.admin.query(
        'SELECT state FROM forge_control.provider_attempts WHERE operation_id=$1',
        [receipt.requestId]
      )
    ).rows[0].state
  ).toBe('uncertain')
  expect(
    (
      await db.admin.query('SELECT count(*) FROM forge_control.usage_ledger WHERE job_id=$1', [
        binding.jobId,
      ])
    ).rows[0].count
  ).toBe('0')
})
it('stores only authenticated ciphertext under forced RLS; concurrent rotation, deletion and revoked session CAS', async () => {
  const a = await seed(),
    b = await seed(),
    key = randomBytes(32)
  const authority: CredentialTransactionAuthority = {
    withAuthorization: async (request, action) =>
      db.api.session(request.sessionToken, request.workspaceId, 'owner', async (c, p) => {
        if (sha256(request.csrfToken) !== p.csrf_hash) throw new Error('CSRF')
        return action(c, { userId: p.user_id, workspaceId: request.workspaceId, role: 'owner' })
      }),
  }
  const repo = new PostgresCredentialRepository(db.api, authority),
    cipher = new CredentialCipher({
      currentKeyId: async () => 'synthetic-v1',
      resolve: async () => key,
    })
  const make = (auth: CredentialAuth) =>
    new CredentialConnections(
      { authorize: (request) => authority.withAuthorization(request, async (_c, p) => p) },
      repo,
      cipher,
      new ProviderRegistry([byokPolicy], [byokPolicy.endpoint]),
      auth.origin
    )
  const service = make(a.auth),
    secret = 'synthetic-native-provider-key'
  const connected = await service.mutate(a.auth, 'connect', async () => ({
    provider: 'openai',
    key: secret,
  }))
  expect(
    JSON.stringify((await db.admin.query('SELECT * FROM forge_control.provider_credentials')).rows)
  ).not.toContain(secret)
  await expect(make(b.auth).status(b.auth, connected.id)).rejects.toThrow('DENIED')
  expect(
    await db.worker.scoped(
      b.binding.workspaceId,
      async (c) =>
        (await c.query('SELECT * FROM provider_credentials WHERE id=$1', [connected.id])).rows
    )
  ).toEqual([])
  const rotations = await Promise.allSettled(
    [1, 2].map((i) =>
      service.mutate(a.auth, 'rotate', async () => ({
        id: connected.id,
        expectedRevision: 1,
        key: `synthetic-native-rotation-${i}`,
      }))
    )
  )
  expect(rotations.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  await service.mutate(a.auth, 'delete', async () => ({ id: connected.id, expectedRevision: 2 }))
  expect(
    (
      await db.admin.query(
        'SELECT envelope_json,deleted FROM forge_control.provider_credentials WHERE id=$1',
        [connected.id]
      )
    ).rows[0]
  ).toEqual({ envelope_json: null, deleted: true })
  const next = await service.mutate(a.auth, 'connect', async () => ({
    provider: 'openai',
    key: secret,
  }))
  const row = (await repo.read(a.binding.workspaceId, next.id, a.auth))!
  await db.admin.query('UPDATE forge_control.sessions SET revoked_at=now() WHERE id_hash=$1', [
    sha256(a.auth.sessionToken),
  ])
  await expect(
    repo.compareAndSwap({ ...row, revision: 2, deleted: true, envelope: null }, 1, a.auth)
  ).rejects.toThrow()
})

it('preserves one legacy fixture attempt per step while allowing multiple numbered calls', async () => {
  const { binding } = await seed(1000000)
  const legacy = () => db.worker.scoped(binding.workspaceId, c => c.query(
    `INSERT INTO provider_attempts(workspace_id,project_id,job_id,step_id,operation_id,input_digest,maximum_micros,state)
      VALUES($1,$2,$3,$4,$5,$6,0,'dispatched')`,
    [binding.workspaceId,binding.projectId,binding.jobId,binding.stepId,randomUUID(),'a'.repeat(64)]))
  await legacy()
  await expect(legacy()).rejects.toMatchObject({ code: '23505' })
  await accounting.reserve(callTerms(byokRequest(),byokPolicy,binding))
  await accounting.reserve(callTerms(byokRequest(),byokPolicy,binding))
  expect((await db.admin.query('SELECT count(*) FROM forge_control.provider_attempts WHERE job_id=$1',[binding.jobId])).rows[0].count).toBe('3')
})
