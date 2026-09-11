/** Real restricted PostgreSQL roles and auth parent checks; synthetic accounts,
 * keys and allowance evidence. No external model, email or sandbox request. */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { startNativePostgres } from './native-postgres.ts'
import { HostedIdentityBridge } from '../../engine/control/hosted-identity.ts'
import { ControlDatabase } from '../../engine/control/database.ts'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { PostgresCiphertextTransport } from '../../engine/artifacts/postgres-backend.ts'
import {
  EncryptedObjectBackend,
  EnvironmentObjectKeys,
} from '../../engine/artifacts/encrypted-backend.ts'
import { HostedProducts } from '../../engine/control/hosted-products.ts'
import type { HostedGenerationContext } from '../../engine/generation/hosted-stage.ts'
import { plan as syntheticPlan } from './fixtures.ts'
import { HostedProjects } from '../../engine/control/hosted-projects.ts'
import { ProviderRegistry } from '../../engine/providers/registry.ts'
import type { TemplateCatalog } from '../../engine/generation/catalog.ts'
import { HostedGenerationGate } from '../../engine/control/hosted-generation-gate.ts'
import { ControlWorker, operationId } from '../../engine/control/worker.ts'
import { FixtureStageAdapter } from '../../engine/control/fixture-stage.ts'
import { PostgresCallAccounting } from '../../engine/providers/accounting-postgres.ts'
import { CredentialCipher } from '../../engine/providers/credentials.ts'
import { callTerms } from '../../engine/providers/accounting.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { hostedCatalog } from '../../engine/providers/hosted-catalog.ts'
import { byokPolicy, byokRequest } from './byok-fixtures.ts'

let db: Awaited<ReturnType<typeof startNativePostgres>>
let objectWriter: PostgresCiphertextTransport
let store: ArtifactStore
let api: ControlDatabase
let worker: ControlDatabase
let bridge: HostedIdentityBridge
const workerId = randomUUID()
let accounting: PostgresCallAccounting
const sql = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
beforeAll(async () => {
  db = await startNativePostgres()
  for (const f of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ])
    await db.admin.query(sql(`drizzle/${f}`))
  for (const f of [
    '0003_immutable_source_bridge.sql',
    '0004_hosted_identity.sql',
    '0005_hosted_byok.sql',
    '0006_encrypted_objects.sql',
    '0007_preview.sql',
    '0008_scheduler_outbox.sql',
    '0009_hosted_source_jobs.sql',
  ])
    await db.admin.query(sql(`engine/migrations/${f}`))
  await db.admin.query(
    "UPDATE forge_control.control_settings SET environment='hosted'; INSERT INTO forge_control.hosted_identity_settings(issuer,enabled,max_users) VALUES('https://fixture.example/api/auth',true,100); INSERT INTO forge_control.hosted_generation_limits VALUES(true,10,40,5)"
  )
  await db.admin
    .query(`CREATE ROLE hosted_object_writer LOGIN; GRANT forge_object_writer TO hosted_object_writer;
    INSERT INTO forge_objects.policy VALUES(true,3600,86400,86400);
    INSERT INTO forge_objects.capacity(singleton,max_bytes,max_objects) VALUES(true,67108864,10000)`)
  objectWriter = new PostgresCiphertextTransport(
    { ...db.config, user: 'hosted_object_writer' },
    'forge_object_writer'
  )
  await objectWriter.check()
  store = new ArtifactStore(
    new EncryptedObjectBackend(
      objectWriter,
      new EnvironmentObjectKeys(
        { v1: 'FORGE_OBJECT_KEY_TEST' },
        { FORGE_OBJECT_KEY_TEST: randomBytes(32).toString('hex') }
      ),
      'v1'
    )
  )
  bridge = new HostedIdentityBridge(db.api, randomBytes(32))
  worker = new ControlDatabase(
    { ...db.config, user: 'e1_worker' },
    'forge_control_worker',
    'hosted'
  )
  api = new ControlDatabase({ ...db.config, user: 'e1_api' }, 'forge_control_api', 'hosted')
  accounting = new PostgresCallAccounting(worker, new HostedGenerationGate(worker, workerId))
}, 30000)
beforeEach(async () => {
  await db.admin.query(
    'UPDATE forge_control.control_settings SET worker_enabled=true,security_shutdown=false; UPDATE forge_control.hosted_generation_days SET calls=0,jobs=0; UPDATE forge_control.hosted_generation_limits SET max_daily_calls=40,max_daily_jobs=10,max_projects_per_workspace=5'
  )
})
afterAll(async () => {
  await objectWriter?.pool.end()
  await api?.close()
  await worker?.close()
  await db?.close()
})
async function seed(active = true) {
  await db.admin.query('SET search_path=forge_control,public,pg_catalog')
  const uid = randomUUID(),
    sessionId = randomUUID(),
    token = randomBytes(32).toString('base64url')
  await db.admin.query(
    "INSERT INTO public.forge_user(id,name,email,email_verified) VALUES($1,'Synthetic',$2,true)",
    [uid, uid + '@example.invalid']
  )
  await db.admin.query(
    "INSERT INTO public.forge_session(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [sessionId, uid, token]
  )
  const identity = await bridge.connect(token)
  const projectId = randomUUID(),
    jobId = randomUUID(),
    stepId = randomUUID(),
    credentialId = randomUUID()
  const p = hostedCatalog.find((p) => p.id === 'groq')!
  const policy = {
    ...byokPolicy,
    id: p.id,
    endpoint: p.endpoint,
    model: p.models[0],
    price: {
      ...byokPolicy.price,
      version: 'synthetic-free-v1',
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      freeOnly: true as const,
      entitlementDigest: 'a'.repeat(64),
      validFrom: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  }
  const cipher = new CredentialCipher({
    currentKeyId: async () => 'test',
    resolve: async () => Buffer.alloc(32, 7),
  })
  const envelope = await cipher.encrypt(
    {
      workspaceId: identity.workspaceId,
      id: credentialId,
      revision: 1,
      provider: p.id,
      destination: p.endpoint,
    },
    'synthetic-test-key-value'
  )
  const values = [identity.workspaceId, credentialId, p.id, p.endpoint, envelope]
  await db.admin.query(
    'INSERT INTO forge_control.provider_credentials(workspace_id,id,revision,provider,destination,envelope_json,deleted) VALUES($1,$2,1,$3,$4,$5,false)',
    values
  )
  await db.admin.query(
    'INSERT INTO forge_control.provider_validations(workspace_id,credential_id,revision,model,free_tier_confirmed) VALUES($1,$2,1,$3,true)',
    [identity.workspaceId, credentialId, p.models[0]]
  )
  await db.admin.query(
    'INSERT INTO forge_control.provider_choices(workspace_id,credential_id) VALUES($1,$2)',
    [identity.workspaceId, credentialId]
  )
  if (active) {
    await db.admin.query(
      "INSERT INTO forge_control.projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest,origin) VALUES($1,$2,'Synthetic','Synthetic hosted source gate project','fixture',1,'next-postgres-v1',$3,'hosted')",
      [projectId, identity.workspaceId, 'a'.repeat(64)]
    )
    await db.admin.query(
      `INSERT INTO forge_control.jobs(id,workspace_id,project_id,created_by,kind,base_revision,request_json,state,policy_digest,template_digest,prompt_version,model_policy_json,cost_limit_micros,active_remaining_ms,active_started_at,active_deadline_at,origin)
    VALUES($1,$2,$3,$4,'generate',1,'{"schemaVersion":1}','PLANNING',$5,$5,'synthetic-v1','{"schemaVersion":1}',0,1200000,clock_timestamp(),clock_timestamp()+interval '10 minutes','hosted')`,
      [jobId, identity.workspaceId, projectId, identity.userId, 'a'.repeat(64)]
    )
    await db.admin.query(
      `INSERT INTO forge_control.hosted_job_bindings(workspace_id,project_id,job_id,parent_session_hash,credential_id,credential_revision,provider,model,provider_policy_json,provider_policy_digest,preset_json,instruction_digest)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'{}',$10)`,
      [
        identity.workspaceId,
        projectId,
        jobId,
        sha256(identity.sessionToken),
        credentialId,
        p.id,
        p.models[0],
        policy,
        canonicalHash(policy),
        sha256('Synthetic instruction'),
      ]
    )
    await db.admin.query(
      `INSERT INTO forge_control.job_steps(id,workspace_id,project_id,job_id,stage,attempt,status,available_at,lease_owner,lease_epoch,lease_expires_at,input_digest)
    VALUES($1,$2,$3,$4,'PLANNING',1,'running',now(),$5,1,clock_timestamp()+interval '60 seconds',$6)`,
      [stepId, identity.workspaceId, projectId, jobId, workerId, 'a'.repeat(64)]
    )
    await db.admin.query(
      `INSERT INTO forge_control.workspace_quotas(workspace_id,period_start,limit_micros,reserved_micros,max_active_jobs,max_previews) VALUES($1,date_trunc('day',now()),0,0,1,1)
    ON CONFLICT DO NOTHING`,
      [identity.workspaceId]
    )
    await db.admin.query(
      `INSERT INTO forge_control.usage_reservations(id,workspace_id,project_id,job_id,reserved_micros,status,expires_at,period_start) VALUES($1,$2,$3,$4,0,'open',now()+interval '7 days',date_trunc('day',now()))`,
      [randomUUID(), identity.workspaceId, projectId, jobId]
    )
  }
  const binding = {
    workspaceId: identity.workspaceId,
    projectId,
    jobId,
    stepId,
    leaseEpoch: 1,
    credentialId,
    credentialRevision: 1,
    repairNumber: 0,
  }
  const request = {
    ...byokRequest(),
    requestId: operationId(jobId, stepId, 1),
    model: policy.model,
    deadlineAt: new Date(Date.now() + 40000).toISOString(),
  }
  return { uid, sessionId, identity, binding, policy, terms: callTerms(request, policy, binding) }
}
const calls = async () =>
  Number(
    (
      await db.admin.query(
        'SELECT coalesce(sum(calls),0) AS n FROM forge_control.hosted_generation_days'
      )
    ).rows[0].n
  )
it('reserves one durable free call and never recharges duplicate reservation/dispatch', async () => {
  const f = await seed()
  const r = await accounting.reserve(f.terms)
  expect(r.created).toBe(true)
  expect(await calls()).toBe(1)
  expect((await accounting.reserve(f.terms)).created).toBe(false)
  expect(await accounting.dispatch(r.receipt)).toBe(true)
  expect(await accounting.dispatch(r.receipt)).toBe(false)
  await accounting.settle(r.receipt, { classification: 'uncertain', usageDigest: 'a'.repeat(64) })
  expect(await accounting.dispatch(r.receipt)).toBe(false)
  expect(await calls()).toBe(1)
})
it('enforces shared daily capacity across different owner workspaces atomically', async () => {
  const a = await seed(),
    b = await seed()
  await db.admin.query('UPDATE forge_control.hosted_generation_limits SET max_daily_calls=1')
  const r = await Promise.allSettled([accounting.reserve(a.terms), accounting.reserve(b.terms)])
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(await calls()).toBe(1)
})
it.each(['logout', 'suspension', 'verification', 'membership'] as const)(
  'fences exact parent %s before consuming allowance',
  async (kind) => {
    const f = await seed()
    if (kind === 'logout')
      await db.admin.query('DELETE FROM public.forge_session WHERE id=$1', [f.sessionId])
    if (kind === 'suspension')
      await db.admin.query('UPDATE public.forge_user SET disabled_at=now() WHERE id=$1', [f.uid])
    if (kind === 'verification')
      await db.admin.query('UPDATE public.forge_user SET email_verified=false WHERE id=$1', [f.uid])
    if (kind === 'membership')
      await db.admin.query("UPDATE forge_control.memberships SET role='viewer' WHERE user_id=$1", [
        f.identity.userId,
      ])
    await expect(accounting.reserve(f.terms)).rejects.toThrow()
    expect(await calls()).toBe(0)
  }
)
it('rejects key removal between reservation and actual dispatch', async () => {
  const f = await seed()
  const r = await accounting.reserve(f.terms)
  await db.admin.query(
    'UPDATE forge_control.provider_credentials SET revision=2,deleted=true,envelope_json=NULL WHERE id=$1',
    [f.binding.credentialId]
  )
  await expect(accounting.dispatch(r.receipt)).rejects.toThrow('HOSTED_CREDENTIAL_REVOKED')
  expect(await calls()).toBe(1)
})
it.each(['cancel', 'lease', 'revision', 'disabled'] as const)(
  'fences %s without advancing the provider counter',
  async (kind) => {
    const f = await seed()
    if (kind === 'cancel')
      await db.admin.query('UPDATE forge_control.jobs SET cancel_requested_at=now() WHERE id=$1', [
        f.binding.jobId,
      ])
    if (kind === 'lease')
      await db.admin.query('UPDATE forge_control.job_steps SET lease_epoch=2 WHERE id=$1', [
        f.binding.stepId,
      ])
    if (kind === 'revision')
      await db.admin.query('UPDATE forge_control.projects SET revision=2 WHERE id=$1', [
        f.binding.projectId,
      ])
    if (kind === 'disabled')
      await db.admin.query('UPDATE forge_control.control_settings SET worker_enabled=false')
    await expect(accounting.reserve(f.terms)).rejects.toThrow()
    expect(await calls()).toBe(0)
  }
)
it('rejects another operation identity on the same job step', async () => {
  const f = await seed()
  await expect(accounting.reserve({ ...f.terms, requestId: randomUUID() })).rejects.toThrow(
    'HOSTED_PROVIDER_BINDING'
  )
  expect(await calls()).toBe(0)
})
it('keeps fixture workers out of a hosted control database', async () => {
  expect(() => new ControlWorker(worker, new FixtureStageAdapter())).toThrow(
    'Fixture worker cannot run hosted jobs'
  )
  await expect(new ControlWorker(db.worker, new FixtureStageAdapter()).claim()).rejects.toThrow(
    'Fixture worker cannot run hosted jobs'
  )
})
it('does not grant runtime identities permission to raise configured quotas', async () => {
  await expect(
    worker.tx((c) =>
      c.query(
        'UPDATE hosted_generation_limits SET max_daily_calls=40,max_daily_jobs=10,max_projects_per_workspace=5'
      )
    )
  ).rejects.toThrow()
})

// Admission uses the real registry and SQL roles. The catalog is a deliberately
// structural test double: these tests never claim a release template was built.
async function admissionFixture() {
  const f = await seed(false)
  await db.admin.query('UPDATE forge_control.control_settings SET max_job_micros=0')
  const catalog = {
    evidence: 'release',
    manifest: { template: { digest: 'a'.repeat(64) }, commandPolicyDigest: 'b'.repeat(64) },
  } as unknown as TemplateCatalog
  const projects = new HostedProjects(
    api,
    bridge,
    catalog,
    new ProviderRegistry([f.policy], [f.policy.endpoint]),
    { id: 'fixture', version: 1, value: {} }
  )
  const create = (key = randomUUID()) =>
    projects.create(f.identity.sessionToken, f.identity.workspaceId, f.identity.csrfToken, key, {
      name: 'Personal page',
      prompt: 'Make a simple personal website with a contact section.',
    })
  const draft = await create()
  const projectId = (draft.body as { project: { id: string } }).project.id
  const admit = (key = randomUUID(), overrides = {}) =>
    projects.admit(
      f.identity.sessionToken,
      f.identity.workspaceId,
      f.identity.csrfToken,
      projectId,
      key,
      {
        instruction: 'Make a simple personal website with a contact section.',
        baseRevision: 1,
        baseSnapshotId: null,
        ...overrides,
      }
    )
  return { ...f, projects, create, projectId, admit }
}
it('saves drafts without a key and rolls failed admission back without losing the prompt', async () => {
  const f = await admissionFixture()
  await db.admin.query('DELETE FROM forge_control.provider_choices WHERE workspace_id=$1', [
    f.identity.workspaceId,
  ])
  await expect(f.admit()).rejects.toThrow('MODEL_CONNECTION_REQUIRED')
  expect(
    (await f.projects.list(f.identity.sessionToken, f.identity.workspaceId)).find(
      (p) => p.id === f.projectId
    )?.brief
  ).toContain('simple personal website')
  expect(
    (await db.admin.query('SELECT jobs FROM forge_control.hosted_generation_days')).rows.every(
      (r) => r.jobs === 0
    )
  ).toBe(true)
  expect(
    (
      await db.admin.query('SELECT 1 FROM forge_control.scheduler_dispatches WHERE project_id=$1', [
        f.projectId,
      ])
    ).rowCount
  ).toBe(0)
})
it('commits one job, key binding, allowance and outbox intent for a replayed admission', async () => {
  const f = await admissionFixture(),
    key = randomUUID()
  const a = await f.admit(key),
    b = await f.admit(key)
  expect(b).toEqual(a)
  const jobId = (a.body as { jobId: string }).jobId
  expect(
    (
      await db.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.jobs WHERE project_id=$1',
        [f.projectId]
      )
    ).rows[0].n
  ).toBe(1)
  expect(
    (
      await db.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.scheduler_dispatches WHERE job_id=$1',
        [jobId]
      )
    ).rows[0].n
  ).toBe(1)
  expect(
    (
      await db.admin.query(
        'SELECT credential_id FROM forge_control.hosted_job_bindings WHERE job_id=$1',
        [jobId]
      )
    ).rows[0].credential_id
  ).toBe(f.binding.credentialId)
  expect(
    (await db.admin.query('SELECT sum(jobs)::int AS n FROM forge_control.hosted_generation_days'))
      .rows[0].n
  ).toBe(1)
  await expect(f.admit()).rejects.toThrow('ACTIVE_JOB_EXISTS')
})
it('does not let another account or invalid CSRF admit an owner project', async () => {
  const f = await admissionFixture(),
    other = await seed()
  await expect(
    f.projects.admit(
      other.identity.sessionToken,
      other.identity.workspaceId,
      other.identity.csrfToken,
      f.projectId,
      randomUUID(),
      {
        instruction: 'Create a basic personal site with a contact section.',
        baseRevision: 1,
        baseSnapshotId: null,
      }
    )
  ).rejects.toThrow()
  await expect(
    f.projects.create(
      f.identity.sessionToken,
      f.identity.workspaceId,
      randomBytes(32).toString('base64url'),
      randomUUID(),
      { name: 'Invalid', prompt: 'Create a simple personal site with a contact section.' }
    )
  ).rejects.toThrow('CSRF_INVALID')
})
it('enforces revision, project capacity, model freshness and global job capacity before dispatch', async () => {
  const f = await admissionFixture()
  await expect(f.admit(randomUUID(), { baseRevision: 2 })).rejects.toThrow('REVISION_MISMATCH')
  await db.admin.query(
    'UPDATE forge_control.hosted_generation_limits SET max_projects_per_workspace=1'
  )
  await expect(f.create()).rejects.toThrow('PROJECT_CAPACITY_UNAVAILABLE')
  await db.admin.query(
    "UPDATE forge_control.provider_validations SET checked_at=now()-interval '2 days' WHERE workspace_id=$1",
    [f.identity.workspaceId]
  )
  await expect(f.admit()).rejects.toThrow('MODEL_CONNECTION_REQUIRED')
  await db.admin.query(
    'UPDATE forge_control.provider_validations SET checked_at=now() WHERE workspace_id=$1',
    [f.identity.workspaceId]
  )
  await db.admin.query(
    "INSERT INTO forge_control.hosted_generation_days(day,jobs) VALUES((clock_timestamp() AT TIME ZONE 'UTC')::date,10) ON CONFLICT(day) DO UPDATE SET jobs=10"
  )
  await expect(f.admit()).rejects.toThrow('FREE_CAPACITY_UNAVAILABLE')
})
it('worker row-lock permission cannot mutate credential identity or encrypted material', async () => {
  const f = await seed()
  await expect(
    worker.scoped(f.identity.workspaceId, (c) =>
      c.query('UPDATE provider_credentials SET id=id WHERE id=$1', [f.binding.credentialId])
    )
  ).rejects.toThrow()
  await expect(
    worker.scoped(f.identity.workspaceId, (c) =>
      c.query('UPDATE provider_credentials SET envelope_json=NULL WHERE id=$1', [
        f.binding.credentialId,
      ])
    )
  ).rejects.toThrow()
})

async function productFixture() {
  const f = await seed(),
    scope = {
      workspaceId: f.binding.workspaceId,
      projectId: f.binding.projectId,
      jobId: f.binding.jobId,
    }
  // Inert base metadata: the save gate only checks its stored identity. Source
  // validation itself has separate byte/catalog tests; no source is executed.
  const baseRef = await store.putJson(scope, 'source-manifest', { schemaVersion: 1 })
  await worker.scoped(scope.workspaceId, async (c) => {
    await c.query('SELECT forge_objects.adopt($1,$2,$3,$4)', [
      baseRef.storageKey,
      baseRef.storageVersion,
      scope.workspaceId,
      scope.projectId,
    ])
    await c.query(
      "INSERT INTO artifacts(id,workspace_id,project_id,job_id,kind,object_key,object_version,sha256,bytes,status) VALUES($1,$2,$3,$4,'source-manifest',$5,$6,$7,$8,'available')",
      [
        baseRef.id,
        scope.workspaceId,
        scope.projectId,
        scope.jobId,
        baseRef.storageKey,
        baseRef.storageVersion,
        baseRef.sha256,
        baseRef.bytes,
      ]
    )
    await c.query(
      'INSERT INTO job_source_contexts(workspace_id,project_id,job_id,base_manifest_artifact_id) VALUES($1,$2,$3,$4)',
      [scope.workspaceId, scope.projectId, scope.jobId, baseRef.id]
    )
  })
  const context = {
    binding: {
      ...scope,
      credentialId: f.binding.credentialId,
      credentialRevision: 1,
      repairNumber: 0,
      provider: f.policy.id,
      model: f.policy.model,
      providerPolicyDigest: canonicalHash(f.policy),
      promptVersion: 'synthetic-v1',
    },
    stepId: f.binding.stepId,
    leaseEpoch: 1,
    operationId: f.terms.requestId,
    deadlineAt: f.terms.deadlineAt,
    instruction: 'Synthetic instruction',
    brief: 'Synthetic instruction',
    preset: {},
    templateGuidance: 'Synthetic',
    base: { manifestArtifact: baseRef },
  } as HostedGenerationContext
  const request = {
    ...byokRequest(),
    requestId: context.operationId,
    model: f.policy.model,
    deadlineAt: context.deadlineAt,
    context: [{ role: 'user' as const, content: JSON.stringify({ kind: 'generation-input' }) }],
  }
  const terms = callTerms(request, f.policy, f.binding),
    r = await accounting.reserve(terms)
  await accounting.dispatch(r.receipt)
  await accounting.settle(r.receipt, {
    classification: 'measured',
    inputTokens: 1,
    outputTokens: 1,
    amountMicros: 0,
    usageDigest: 'b'.repeat(64),
  })
  const ref = await store.putJson(scope, 'plan', syntheticPlan)
  const products = new HostedProducts(new HostedGenerationGate(worker, workerId), store)
  const save = () => products.save(context, request, ref, new AbortController().signal)
  return { ...f, context, request, ref, products, save, scope }
}
it('adopts an encrypted accounted product once and recovers it without another model call', async () => {
  const f = await productFixture()
  await f.save()
  await f.save()
  expect(
    await f.products.plan({ ...f.scope, stepId: f.context.stepId, leaseEpoch: 1 }, f.ref.id)
  ).toEqual(syntheticPlan)
  expect(
    (
      await db.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.hosted_source_products WHERE job_id=$1',
        [f.scope.jobId]
      )
    ).rows[0].n
  ).toBe(1)
  expect(
    (
      await db.admin.query('SELECT status FROM forge_control.job_steps WHERE id=$1', [
        f.context.stepId,
      ])
    ).rows[0].status
  ).toBe('running')
  const row = (
    await db.admin.query('SELECT ciphertext FROM forge_objects.versions WHERE object_key=$1', [
      f.ref.storageKey,
    ])
  ).rows[0]
  expect(Buffer.from(row.ciphertext).includes(Buffer.from(syntheticPlan.briefHash))).toBe(false)
  expect(await calls()).toBe(1)
})
it.each(['logout', 'cancel', 'request', 'version'] as const)(
  'preserves only an orphan when product adoption loses its %s binding',
  async (kind) => {
    const f = await productFixture()
    if (kind === 'logout')
      await db.admin.query('DELETE FROM public.forge_session WHERE id=$1', [f.sessionId])
    if (kind === 'cancel')
      await db.admin.query('UPDATE forge_control.jobs SET cancel_requested_at=now() WHERE id=$1', [
        f.scope.jobId,
      ])
    if (kind === 'request') f.request.context[0].content += ' changed'
    if (kind === 'version') f.ref.storageVersion = randomUUID()
    await expect(f.save()).rejects.toThrow()
    expect(
      (
        await db.admin.query('SELECT 1 FROM forge_control.hosted_source_products WHERE job_id=$1', [
          f.scope.jobId,
        ])
      ).rowCount
    ).toBe(0)
    expect(
      (await db.admin.query('SELECT 1 FROM forge_control.artifacts WHERE id=$1', [f.ref.id]))
        .rowCount
    ).toBe(0)
    expect(
      (
        await db.admin.query('SELECT 1 FROM forge_objects.versions WHERE object_key=$1', [
          f.ref.storageKey,
        ])
      ).rowCount
    ).toBe(1)
  }
)
it('rejects product metadata from another owner and rechecks logout before read', async () => {
  const f = await productFixture(),
    other = await seed()
  await f.save()
  const claim = {
    workspaceId: other.binding.workspaceId,
    projectId: other.binding.projectId,
    jobId: other.binding.jobId,
    stepId: other.binding.stepId,
    leaseEpoch: 1,
  }
  await expect(f.products.plan(claim, f.ref.id)).rejects.toThrow()
  await db.admin.query('DELETE FROM public.forge_session WHERE id=$1', [f.sessionId])
  await expect(
    f.products.plan({ ...f.scope, stepId: f.context.stepId, leaseEpoch: 1 }, f.ref.id)
  ).rejects.toThrow()
})
