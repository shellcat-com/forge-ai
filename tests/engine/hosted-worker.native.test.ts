/** Native PostgreSQL + encrypted objects, synthetic identities/policy/template,
 * and intercepted provider HTTP. These tests are NOT live provider, runtime or
 * deployment evidence. No generated source is executed. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { startNativePostgres } from './native-postgres.ts'
import { HostedIdentityBridge } from '../../engine/control/hosted-identity.ts'
import { ControlDatabase, clock, one, number } from '../../engine/control/database.ts'
import { HostedProjects } from '../../engine/control/hosted-projects.ts'
import { HostedSourceWorker } from '../../engine/control/hosted-worker.ts'
import type { HostedSourceWorkerConfig } from '../../engine/control/hosted-worker.ts'
import { HostedProducts } from '../../engine/control/hosted-products.ts'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { PostgresCiphertextTransport } from '../../engine/artifacts/postgres-backend.ts'
import {
  EncryptedObjectBackend,
  EnvironmentObjectKeys,
} from '../../engine/artifacts/encrypted-backend.ts'
import { TemplateCatalog, templateCatalogDigest } from '../../engine/generation/catalog.ts'
import { ProviderRegistry } from '../../engine/providers/registry.ts'
import { CredentialCipher } from '../../engine/providers/credentials.ts'
import { hostedCatalog } from '../../engine/providers/hosted-catalog.ts'
import type * as ProviderDestination from '../../engine/providers/destination.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { commandPolicy, plan as fixturePlan, hash } from './fixtures.ts'
import { byokPolicy } from './byok-fixtures.ts'
import { changeState, enqueue, scopeOf } from '../../engine/control/state.ts'
import type { JobRow } from '../../engine/control/state.ts'
import { enqueueDispatch } from '../../engine/scheduling/outbox.ts'
import { PostgresSchedulerOutbox } from '../../engine/scheduling/outbox.ts'
import type { StepCommand } from '../../engine/scheduling/protocol.ts'

const transport = vi.hoisted(() => vi.fn<typeof fetch>())
vi.mock('../../engine/providers/destination.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderDestination>()),
  // Intercept the production adapter at its transport module. The production
  // composition has no fake adapter or fake-fetch enable switch.
  pinnedProviderFetch: () => transport,
}))
let pg: Awaited<ReturnType<typeof startNativePostgres>>
let api: ControlDatabase, db: ControlDatabase, objects: PostgresCiphertextTransport
let store: ArtifactStore, bridge: HostedIdentityBridge, config: HostedSourceWorkerConfig
const key = 'synthetic-key-never-a-real-credential'
const instruction = 'Build a synthetic test task board with saved items.'
const cipher = new CredentialCipher({
  currentKeyId: async () => 'test',
  resolve: async () => Buffer.alloc(32, 17),
})
const sql = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')
const signal = () => new AbortController().signal
const textFile = (path: string, content: string) => ({
  path,
  mediaType: 'text/plain' as const,
  bytes: new TextEncoder().encode(content),
})
const files = [
  textFile('package.json', '{"dependencies":{"next":"1.0.0"}}'),
  textFile(
    'package-lock.json',
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/next': {
          version: '1.0.0',
          resolved: 'https://synthetic.invalid/next.tgz',
          integrity: 'sha512-AAAA',
        },
      },
    })
  ),
  textFile('tsconfig.json', '{"compilerOptions":{"strict":true}}'),
  textFile('README.md', 'Synthetic catalog. Never executed. Not release qualification.'),
  textFile('.env.example', 'DATABASE_URL=REPLACE_ME'),
  textFile('app/page.tsx', 'export default function Page() { return null }\n'),
]
const manifest = {
  schemaVersion: 1 as const,
  template: { id: 'next-postgres-v1' as const, digest: hash, imageDigest: `sha256:${hash}` },
  stack: 'nextjs-strict-typescript-postgresql' as const,
  releases: { next: '1.0.0', node: '1.0.0', postgres: '1.0.0' },
  lockfileDigest: sha256(files[1].bytes),
  commandPolicyDigest: canonicalHash(commandPolicy),
  requiredChecks: commandPolicy.requiredChecks,
  protectedPaths: files.slice(0, 5).map((f) => f.path),
}
manifest.template.digest = templateCatalogDigest(manifest, files)
// Evidence discriminator is synthetic test input here, not claimed qualification.
const catalog = new TemplateCatalog({ manifest, files, evidence: 'release' })
const provider = hostedCatalog.find((p) => p.id === 'groq')!
const plan = {
  ...fixturePlan,
  briefHash: sha256(instruction),
  templateDigest: manifest.template.digest,
  presetDigest: canonicalHash({}),
}
beforeAll(async () => {
  pg = await startNativePostgres()
  for (const f of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ])
    await pg.admin.query(sql('drizzle/' + f))
  for (const f of [
    '0003_immutable_source_bridge.sql',
    '0004_hosted_identity.sql',
    '0005_hosted_byok.sql',
    '0006_encrypted_objects.sql',
    '0007_preview.sql',
    '0008_scheduler_outbox.sql',
    '0009_hosted_source_jobs.sql',
  ])
    await pg.admin.query(sql('engine/migrations/' + f))
  await pg.admin
    .query(`UPDATE forge_control.control_settings SET environment='hosted',max_job_micros=0,max_running=1;
    INSERT INTO forge_control.hosted_identity_settings(issuer,enabled,max_users) VALUES('https://synthetic.example/api/auth',true,100);
    INSERT INTO forge_control.hosted_generation_limits VALUES(true,10,40,5);
    CREATE ROLE hosted_source_object_writer LOGIN; GRANT forge_object_writer TO hosted_source_object_writer;
    INSERT INTO forge_objects.policy VALUES(true,3600,86400,86400);
    INSERT INTO forge_objects.capacity VALUES(true,67108864,10000,0,0)`)
  api = new ControlDatabase({ ...pg.config, user: 'e1_api' }, 'forge_control_api', 'hosted')
  db = new ControlDatabase({ ...pg.config, user: 'e1_worker' }, 'forge_control_worker', 'hosted')
  await Promise.all([api.check(), db.check()])
  bridge = new HostedIdentityBridge(api, randomBytes(32))
  objects = new PostgresCiphertextTransport(
    { ...pg.config, user: 'hosted_source_object_writer' },
    'forge_object_writer'
  )
  await objects.check()
  store = new ArtifactStore(
    new EncryptedObjectBackend(
      objects,
      new EnvironmentObjectKeys(
        { v1: 'FORGE_OBJECT_KEY_TEST' },
        { FORGE_OBJECT_KEY_TEST: randomBytes(32).toString('hex') }
      ),
      'v1'
    )
  )
}, 30000)
beforeEach(async () => {
  await pg.admin.query('SET search_path=forge_control,public,pg_catalog')
  vi.restoreAllMocks()
  transport.mockReset()
  transport.mockImplementation(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + key)
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe(provider.models[0])
    const input = body.messages
      .map((m: { content: string }) => {
        try {
          return JSON.parse(m.content)
        } catch {
          return {}
        }
      })
      .find((m: { kind?: string }) => m.kind === 'generation-input')
    const payload = input.plan
      ? {
          schemaVersion: 1,
          planDigest: input.planDigest,
          baseManifestDigest: input.baseManifestDigest,
          batchIndex: input.batchIndex,
          finalBatch: true,
          changes: [
            {
              op: 'replace',
              path: 'app/page.tsx',
              expectedSha256: input.files.find((f: { path: string }) => f.path === 'app/page.tsx')
                .sha256,
              content: 'export default function Page() { return <h1>Synthetic task board</h1> }\n',
            },
          ],
        }
      : plan
    return Response.json({
      model: body.model,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    })
  })
  await pg.admin
    .query(`UPDATE forge_control.job_steps SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,finished_at=clock_timestamp() WHERE status IN('running','queued');
    UPDATE forge_control.control_settings SET admission_enabled=true,worker_enabled=true,security_shutdown=false;
    UPDATE forge_control.hosted_generation_days SET jobs=0,calls=0`)
  const policy = {
    ...byokPolicy,
    id: provider.id,
    endpoint: provider.endpoint,
    model: provider.models[0],
    maxOutputTokens: 8192,
    price: {
      ...byokPolicy.price,
      version: 'synthetic-free-v1',
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      freeOnly: true as const,
      entitlementDigest: hash,
      validFrom: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  }
  config = {
    db,
    store,
    catalog,
    registry: new ProviderRegistry([policy], [policy.endpoint]),
    cipher,
    commandPolicy,
    templateGuidance: 'Synthetic test catalog, no actual runtime.',
    scan: vi.fn(async () => {}),
  }
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await objects?.pool.end()
  await api?.close()
  await db?.close()
  await pg?.close()
})
async function seed() {
  const uid = randomUUID(),
    token = randomBytes(32).toString('base64url')
  await pg.admin.query(
    "INSERT INTO public.forge_user(id,name,email,email_verified) VALUES($1,'Synthetic',$2,true)",
    [uid, uid + '@example.invalid']
  )
  await pg.admin.query(
    "INSERT INTO public.forge_session(id,user_id,token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '12 hours')",
    [randomUUID(), uid, token]
  )
  const identity = await bridge.connect(token)
  const credentialId = randomUUID()
  const envelope = await cipher.encrypt(
    {
      workspaceId: identity.workspaceId,
      id: credentialId,
      revision: 1,
      provider: provider.id,
      destination: provider.endpoint,
    },
    key
  )
  await pg.admin.query(
    `INSERT INTO forge_control.provider_credentials(workspace_id,id,revision,provider,destination,envelope_json,deleted) VALUES($1,$2,1,$3,$4,$5,false)`,
    [identity.workspaceId, credentialId, provider.id, provider.endpoint, envelope]
  )
  await pg.admin.query(
    'INSERT INTO forge_control.provider_validations(workspace_id,credential_id,revision,model,free_tier_confirmed) VALUES($1,$2,1,$3,true)',
    [identity.workspaceId, credentialId, provider.models[0]]
  )
  await pg.admin.query(
    'INSERT INTO forge_control.provider_choices(workspace_id,credential_id) VALUES($1,$2)',
    [identity.workspaceId, credentialId]
  )
  const projects = new HostedProjects(api, bridge, catalog, config.registry, {
    id: 'synthetic',
    version: 1,
    value: {},
  })
  const created = await projects.create(
    identity.sessionToken,
    identity.workspaceId,
    identity.csrfToken,
    randomUUID(),
    { name: 'Synthetic', prompt: instruction }
  )
  const projectId = (created.body as { project: { id: string } }).project.id
  const admitted = await projects.admit(
    identity.sessionToken,
    identity.workspaceId,
    identity.csrfToken,
    projectId,
    randomUUID(),
    { instruction, baseRevision: 1, baseSnapshotId: null }
  )
  const jobId = (admitted.body as { jobId: string }).jobId
  const r = (
    await pg.admin.query('SELECT * FROM forge_control.scheduler_dispatches WHERE job_id=$1', [
      jobId,
    ])
  ).rows[0]
  const command: StepCommand = {
    schemaVersion: 1,
    dispatchId: r.id,
    workspaceId: identity.workspaceId,
    jobId,
    expiresAt: r.expires_at.toISOString(),
    sequence: 0,
  }
  return {
    identity,
    parentToken: token,
    projectId,
    jobId,
    credentialId,
    command,
    worker: new HostedSourceWorker({ ...config, enabled: true }),
  }
}
type Seed = Awaited<ReturnType<typeof seed>>
const job = async (f: Seed) =>
  (await pg.admin.query('SELECT * FROM forge_control.jobs WHERE id=$1', [f.jobId]))
    .rows[0] as JobRow
async function planning(f: Seed) {
  await f.worker.execute(f.command, signal())
  f.command = { ...f.command, sequence: 1 }
  return f.worker.execute(f.command, signal())
}
async function approve(f: Seed, record = true) {
  // Synthetic approval via the canonical reducer, not an HTTP/auth acceptance test.
  return api.session(f.identity.sessionToken, f.identity.workspaceId, 'owner', async (c, actor) => {
    const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [f.jobId]),
      at = await clock(c)
    const approval = {
      schemaVersion: 1,
      ...scopeOf(j),
      id: randomUUID(),
      actorId: actor.user_id,
      kind: 'plan',
      decision: 'approve',
      subjectDigest: j.review_digest,
      stateVersion: number(j.state_version),
      createdAt: at,
      expiresAt: j.review_expires_at!.toISOString(),
    }
    const context = {
      ...scopeOf(j),
      actorId: actor.user_id,
      currentRole: 'owner',
      userDisabled: false,
      kind: 'plan',
      now: at,
      stateVersion: number(j.state_version),
      subjectDigest: j.review_digest,
      baseRevision: number(j.base_revision),
      baseSnapshotId: j.base_snapshot_id,
      reviewExpiresAt: j.review_expires_at!.toISOString(),
      cancelRequested: false,
      policyRevoked: false,
      templateDigest: j.template_digest,
      policyDigest: j.policy_digest,
    }
    if (record)
      await c.query(
        `INSERT INTO approvals(id,workspace_id,project_id,job_id,actor_id,kind,subject_digest,state_version,decision,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,'plan',$6,$7,'approve',$8,$9)`,
        [
          approval.id,
          j.workspace_id,
          j.project_id,
          j.id,
          actor.user_id,
          j.review_digest,
          j.state_version,
          approval.expiresAt,
          at,
        ]
      )
    await changeState(
      c,
      j,
      'GENERATING',
      'approval',
      null,
      { approval, subject: j.review_json, context },
      at
    )
    const dispatch = await enqueueDispatch(c, actor, j.id, {
      schemaVersion: 1,
      dispatchId: randomUUID(),
      workspaceId: j.workspace_id,
      jobId: j.id,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    })
    f.command = { ...dispatch, sequence: 0 }
  })
}
it('is disabled by default without claiming work or contacting a provider', async () => {
  const f = await seed()
  await expect(new HostedSourceWorker(config).execute(f.command, signal())).rejects.toThrow(
    'HOSTED_SOURCE_WORKER_DISABLED'
  )
  expect((await job(f)).state).toBe('QUEUED')
  expect(transport).not.toHaveBeenCalled()
})
it('requires an actually checked restricted database login before claiming a job', async () => {
  const f = await seed()
  const check = vi
    .spyOn(db, 'check')
    .mockRejectedValueOnce(new Error('synthetic invalid runtime login'))
  await expect(f.worker.execute(f.command, signal())).rejects.toThrow(
    'synthetic invalid runtime login'
  )
  expect((await job(f)).state).toBe('QUEUED')
  expect(transport).not.toHaveBeenCalled()
  await f.worker.execute(f.command, signal())
  expect(check).toHaveBeenCalledTimes(2)
  await f.worker.execute(f.command, signal())
  expect(check).toHaveBeenCalledTimes(2)
})
it('moves a queued hosted job once and replays the same durable receipt', async () => {
  const f = await seed()
  const first = await f.worker.execute(f.command, signal())
  expect(
    await new HostedSourceWorker({ ...config, enabled: true }).execute(f.command, signal())
  ).toEqual(first)
  expect((await job(f)).state).toBe('PLANNING')
  expect(transport).not.toHaveBeenCalled()
})
it('persists an accounted encrypted plan and review atomically, then replays without a model call', async () => {
  const f = await seed()
  expect((await planning(f)).state).toBe('awaiting-approval')
  expect((await job(f)).state).toBe('AWAITING_PLAN_APPROVAL')
  expect((await f.worker.execute(f.command, signal())).state).toBe('awaiting-approval')
  expect(transport).toHaveBeenCalledTimes(1)
  expect(
    (
      await pg.admin.query('SELECT * FROM forge_control.hosted_source_products WHERE job_id=$1', [
        f.jobId,
      ])
    ).rows
  ).toHaveLength(1)
  expect(
    (
      await pg.admin.query('SELECT state FROM forge_control.provider_attempts WHERE job_id=$1', [
        f.jobId,
      ])
    ).rows[0].state
  ).toBe('completed')
})
it('generates files only after approval, adopts a candidate/diff and stops before isolated validation', async () => {
  const f = await seed()
  await planning(f)
  await approve(f)
  expect((await f.worker.execute(f.command, signal())).state).toBe('continue')
  const j = await job(f)
  expect(j.state).toBe('VALIDATING')
  expect(j.candidate_snapshot_id).not.toBeNull()
  expect(
    (
      await pg.admin.query('SELECT origin FROM forge_control.snapshots WHERE id=$1', [
        j.candidate_snapshot_id,
      ])
    ).rows[0].origin
  ).toBe('hosted')
  expect(transport).toHaveBeenCalledTimes(2)
  expect(config.scan).toHaveBeenCalledTimes(1)
  await expect(f.worker.execute({ ...f.command, sequence: 1 }, signal())).rejects.toThrow(
    'HOSTED_SOURCE_STAGE_UNAVAILABLE'
  )
  expect(
    (
      await pg.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.environments WHERE job_id=$1',
        [f.jobId]
      )
    ).rows[0].n
  ).toBe(0)
})
it('rejects another tenant and a revoked original parent session before dispatch', async () => {
  const a = await seed(),
    b = await seed()
  await expect(
    a.worker.execute({ ...a.command, workspaceId: b.identity.workspaceId }, signal())
  ).rejects.toThrow()
  await pg.admin.query('DELETE FROM public.forge_session WHERE token=$1', [a.parentToken])
  await expect(a.worker.execute(a.command, signal())).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
})
it('never skips a busy command sequence under global concurrent admission', async () => {
  const a = await seed(),
    b = await seed()
  await a.worker.execute(a.command, signal())
  a.command.sequence = 1
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = transport.getMockImplementation()!
  transport.mockImplementation(async (...args) => {
    entered()
    await wait
    return original(...args)
  })
  const running = a.worker.execute(a.command, signal())
  await Promise.race([
    started,
    running.then(() => {
      throw new Error('Worker completed before intercepted transport')
    }),
  ])
  try {
    await expect(b.worker.execute(b.command, signal())).rejects.toThrow('HOSTED_SOURCE_BUSY')
  } finally {
    release()
  }
  await running
  expect(
    (
      await pg.admin.query(
        'SELECT next_sequence FROM forge_control.scheduler_dispatches WHERE id=$1',
        [b.command.dispatchId]
      )
    ).rows[0].next_sequence
  ).toBe(0)
  await b.worker.execute(b.command, signal())
  expect((await job(b)).state).toBe('PLANNING')
})
it('does not repeat an uncertain provider operation after worker restart or lease expiry', async () => {
  const f = await seed()
  transport.mockRejectedValue(new Error('synthetic disconnect after possible acceptance'))
  await expect(planning(f)).rejects.toThrow()
  expect(transport).toHaveBeenCalledTimes(1)
  await pg.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND status='running'",
    [f.jobId]
  )
  await expect(
    new HostedSourceWorker({ ...config, enabled: true }).execute(f.command, signal())
  ).rejects.toThrow('HOSTED_SOURCE_RECONCILIATION_REQUIRED')
  expect(transport).toHaveBeenCalledTimes(1)
  expect(
    (
      await pg.admin.query('SELECT state FROM forge_control.provider_attempts WHERE job_id=$1', [
        f.jobId,
      ])
    ).rows[0].state
  ).toBe('uncertain')
})
it.each(['credential', 'session', 'cancel', 'lease'] as const)(
  'fences %s changes between saved product and settlement',
  async (kind) => {
    const f = await seed(),
      original = HostedProducts.prototype.save
    vi.spyOn(HostedProducts.prototype, 'save').mockImplementation(async function (
      this: HostedProducts,
      ...args
    ) {
      await original.apply(this, args)
      if (kind === 'credential')
        await pg.admin.query(
          'UPDATE forge_control.provider_credentials SET deleted=true,envelope_json=NULL,revision=revision+1 WHERE id=$1',
          [f.credentialId]
        )
      if (kind === 'session')
        await pg.admin.query('DELETE FROM public.forge_session WHERE token=$1', [f.parentToken])
      if (kind === 'cancel')
        await pg.admin.query(
          'UPDATE forge_control.jobs SET cancel_requested_at=clock_timestamp() WHERE id=$1',
          [f.jobId]
        )
      if (kind === 'lease')
        await pg.admin.query(
          "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND status='running'",
          [f.jobId]
        )
    })
    await expect(planning(f)).rejects.toThrow()
    const j = await job(f)
    expect(j.state).toBe('PLANNING')
    expect(j.plan_artifact_id).toBeNull()
    expect(
      (
        await pg.admin.query('SELECT * FROM forge_control.hosted_source_products WHERE job_id=$1', [
          f.jobId,
        ])
      ).rows
    ).toHaveLength(1)
    expect(
      (await pg.admin.query('SELECT * FROM forge_control.job_reviews WHERE job_id=$1', [f.jobId]))
        .rows
    ).toHaveLength(0)
  }
)
it('keeps a failed static scan from adopting a candidate or advancing job state', async () => {
  const f = await seed()
  await planning(f)
  await approve(f)
  const worker = new HostedSourceWorker({
    ...config,
    enabled: true,
    scan: async () => {
      throw new Error('synthetic static rejection')
    },
  })
  await expect(worker.execute(f.command, signal())).rejects.toThrow('synthetic static rejection')
  expect((await job(f)).candidate_snapshot_id).toBeNull()
  expect((await job(f)).state).toBe('GENERATING')
  expect(
    (
      await pg.admin.query(
        "SELECT * FROM forge_control.hosted_source_products WHERE job_id=$1 AND stage='files'",
        [f.jobId]
      )
    ).rows
  ).toHaveLength(1)
})
it('rejects pre-aborted invocations before touching the queue', async () => {
  const f = await seed()
  await expect(f.worker.execute(f.command, AbortSignal.abort())).rejects.toThrow()
  expect((await job(f)).state).toBe('QUEUED')
  expect(transport).not.toHaveBeenCalled()
})
it('refuses a forged generating state with no stored approval', async () => {
  const f = await seed()
  await planning(f)
  await approve(f, false)
  await expect(f.worker.execute(f.command, signal())).rejects.toThrow()
  expect(transport).toHaveBeenCalledTimes(1)
  expect((await job(f)).candidate_snapshot_id).toBeNull()
})
it('rechecks credential revocation inside plan settlement, after all model work has returned', async () => {
  const f = await seed(),
    original = PostgresSchedulerOutbox.prototype.settle
  vi.spyOn(PostgresSchedulerOutbox.prototype, 'settle').mockImplementation(async function (
    this: PostgresSchedulerOutbox,
    ...args
  ) {
    if (args[1].step.stage === 'PLANNING')
      await pg.admin.query(
        'UPDATE forge_control.provider_credentials SET deleted=true,envelope_json=NULL,revision=revision+1 WHERE id=$1',
        [f.credentialId]
      )
    return original.apply(this, args)
  })
  await expect(planning(f)).rejects.toThrow('HOSTED_CREDENTIAL_REVOKED')
  expect((await job(f)).plan_artifact_id).toBeNull()
  expect(
    (
      await pg.admin.query(
        'SELECT status FROM forge_control.scheduler_step_receipts WHERE dispatch_id=$1 AND sequence=1',
        [f.command.dispatchId]
      )
    ).rows[0].status
  ).toBe('started')
  expect(
    (
      await pg.admin.query('SELECT * FROM forge_control.hosted_source_products WHERE job_id=$1', [
        f.jobId,
      ])
    ).rows
  ).toHaveLength(1)
})
it('rechecks cancellation inside candidate settlement and rolls back all candidate metadata', async () => {
  const f = await seed()
  await planning(f)
  await approve(f)
  const original = PostgresSchedulerOutbox.prototype.settle
  vi.spyOn(PostgresSchedulerOutbox.prototype, 'settle').mockImplementation(async function (
    this: PostgresSchedulerOutbox,
    ...args
  ) {
    await pg.admin.query(
      'UPDATE forge_control.jobs SET cancel_requested_at=clock_timestamp() WHERE id=$1',
      [f.jobId]
    )
    return original.apply(this, args)
  })
  await expect(f.worker.execute(f.command, signal())).rejects.toThrow()
  expect((await job(f)).candidate_snapshot_id).toBeNull()
  expect(
    (await pg.admin.query('SELECT * FROM forge_control.snapshots WHERE job_id=$1', [f.jobId])).rows
  ).toHaveLength(0)
  expect(
    (
      await pg.admin.query(
        "SELECT * FROM forge_control.hosted_source_products WHERE job_id=$1 AND stage='files'",
        [f.jobId]
      )
    ).rows
  ).toHaveLength(1)
})
it('continues non-final batches on fresh worker instances with one call per step', async () => {
  const original = transport.getMockImplementation()!
  transport.mockImplementation(async (...args) => {
    const response = await original(...args),
      envelope = await response.json()
    const payload = JSON.parse(envelope.choices[0].message.content)
    if (payload.fileTasks)
      payload.fileTasks.push({ path: 'app/about/page.tsx', instruction: 'Add an about page' })
    else if (payload.batchIndex === 0) payload.finalBatch = false
    else
      payload.changes = [
        {
          op: 'create',
          path: 'app/about/page.tsx',
          content: 'export default function About() { return null }\n',
        },
      ]
    envelope.choices[0].message.content = JSON.stringify(payload)
    return Response.json(envelope)
  })
  const f = await seed()
  await planning(f)
  await approve(f)
  await f.worker.execute(f.command, signal())
  expect((await job(f)).state).toBe('GENERATING')
  expect(transport).toHaveBeenCalledTimes(2)
  const fresh = new HostedSourceWorker({ ...config, enabled: true })
  await fresh.execute(f.command, signal())
  expect(transport).toHaveBeenCalledTimes(2)
  await fresh.execute({ ...f.command, sequence: 1 }, signal())
  expect((await job(f)).state).toBe('VALIDATING')
  expect(transport).toHaveBeenCalledTimes(3)
  expect(
    (
      await pg.admin.query(
        "SELECT batch_index FROM forge_control.hosted_source_products WHERE job_id=$1 AND stage='files' ORDER BY batch_index",
        [f.jobId]
      )
    ).rows
  ).toEqual([{ batch_index: 0 }, { batch_index: 1 }])
})
it('rejects fixture storage, fixture catalog and a changed command policy at construction', () => {
  expect(
    () =>
      new HostedSourceWorker({
        ...config,
        catalog: new TemplateCatalog({ manifest, files, evidence: 'fixture' }),
      })
  ).toThrow('HOSTED_WORKER_CONFIGURATION')
  expect(
    () => new HostedSourceWorker({ ...config, store: { evidence: 'fixture' } as ArtifactStore })
  ).toThrow('HOSTED_WORKER_CONFIGURATION')
  expect(
    () =>
      new HostedSourceWorker({
        ...config,
        commandPolicy: {
          ...commandPolicy,
          resources: { ...commandPolicy.resources, maxCostMicros: 1 },
        },
      })
  ).toThrow('HOSTED_WORKER_POLICY')
})
it('rejects a changed release before seed storage or model dispatch', async () => {
  const f = await seed()
  await f.worker.execute(f.command, signal())
  const alteredFiles = files.map((f) =>
    f.path === 'README.md' ? textFile(f.path, 'A different synthetic release') : f
  )
  const altered = structuredClone(manifest)
  altered.template.digest = templateCatalogDigest(altered, alteredFiles)
  const worker = new HostedSourceWorker({
    ...config,
    enabled: true,
    catalog: new TemplateCatalog({ manifest: altered, files: alteredFiles, evidence: 'release' }),
  })
  await expect(worker.execute({ ...f.command, sequence: 1 }, signal())).rejects.toThrow(
    'HOSTED_SOURCE_RELEASE_CHANGED'
  )
  expect(transport).not.toHaveBeenCalled()
  expect(
    (
      await pg.admin.query('SELECT * FROM forge_control.job_source_contexts WHERE job_id=$1', [
        f.jobId,
      ])
    ).rows
  ).toHaveLength(0)
})
async function syntheticResume(f: Seed) {
  // Deliberately simulate an independent reconciler's decision. The production
  // worker does NOT install this recovery authority or reset its own receipts.
  await pg.admin.query(
    "UPDATE forge_control.job_steps SET status='cancelled',lease_epoch=lease_epoch+1,lease_owner=NULL,lease_expires_at=NULL,finished_at=clock_timestamp() WHERE job_id=$1 AND status='running'",
    [f.jobId]
  )
  await pg.admin.query(
    'UPDATE forge_control.scheduler_dispatches SET closed_at=clock_timestamp() WHERE id=$1',
    [f.command.dispatchId]
  )
  await db.scoped(f.identity.workspaceId, async (c) => {
    await enqueue(c, await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [f.jobId]))
  })
  await api.session(f.identity.sessionToken, f.identity.workspaceId, 'owner', async (c, actor) => {
    f.command = {
      ...(await enqueueDispatch(c, actor, f.jobId, {
        schemaVersion: 1,
        dispatchId: randomUUID(),
        workspaceId: f.identity.workspaceId,
        jobId: f.jobId,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      })),
      sequence: 0,
    }
  })
}
it('adopts a durably saved plan after an independently reconciled step without reissuing the call', async () => {
  const f = await seed(),
    original = PostgresSchedulerOutbox.prototype.settle
  const spy = vi
    .spyOn(PostgresSchedulerOutbox.prototype, 'settle')
    .mockImplementation(async function (this: PostgresSchedulerOutbox, ...args) {
      if (args[1].step.stage === 'PLANNING') throw new Error('synthetic crash after product commit')
      return original.apply(this, args)
    })
  await expect(planning(f)).rejects.toThrow('synthetic crash after product commit')
  spy.mockRestore()
  await syntheticResume(f)
  expect(
    (await new HostedSourceWorker({ ...config, enabled: true }).execute(f.command, signal())).state
  ).toBe('awaiting-approval')
  expect(transport).toHaveBeenCalledTimes(1)
})
it('does not use a new reconciler dispatch to replace a call lacking a saved product', async () => {
  const f = await seed()
  const spy = vi
    .spyOn(HostedProducts.prototype, 'save')
    .mockRejectedValue(new Error('synthetic product persistence crash'))
  await expect(planning(f)).rejects.toThrow()
  spy.mockRestore()
  await syntheticResume(f)
  await expect(f.worker.execute(f.command, signal())).rejects.toThrow(
    'HOSTED_SOURCE_RECONCILIATION_REQUIRED'
  )
  expect(transport).toHaveBeenCalledTimes(1)
})
