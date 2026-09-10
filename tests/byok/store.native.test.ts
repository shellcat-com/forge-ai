import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { startNativePostgres } from '../engine/native-postgres'
import { ConnectionStore } from '../../src/server/byok/store'
import { vault } from '../../src/server/byok/vault'
import { queueByok } from '../../src/server/byok/service'
import { RunExecutor, readRun } from '../../src/server/byok/executor'
import { providerDefaults, singleModelRouting } from '../../src/shared/byok'
import type { ModelResult } from '../../src/shared/byok'
const mock = vi.hoisted(() => ({
  calls: 0,
  generate: async (): Promise<ModelResult> => ({
    text: 'ok',
    usage: { classification: 'measured', inputTokens: 10, outputTokens: 5 },
    sources: [],
  }),
}))
vi.mock('../../src/server/byok/adapters', () => ({
  ModelAdapter: class {
    async generate() {
      mock.calls++
      return mock.generate()
    }
  },
}))
let native: Awaited<ReturnType<typeof startNativePostgres>>,
  database: pg.Pool,
  store: ConnectionStore
const alice = { id: 'byok-alice', local: true },
  bob = { id: 'byok-bob', local: true }
beforeAll(async () => {
  native = await startNativePostgres()
  for (const file of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await native.admin.query(readFileSync('drizzle/' + file, 'utf8'))
  await native.admin.query(
    'CREATE ROLE byok_app LOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO byok_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO byok_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO byok_app'
  )
  database = new pg.Pool({ ...native.config, user: 'byok_app', max: 10 })
  store = new ConnectionStore(
    database,
    vault({
      FORGE_BYOK_ACTIVE_KEY: 'test',
      FORGE_BYOK_KEYRING: JSON.stringify({ test: 'ab'.repeat(32) }),
    })
  )
}, 60000)
afterAll(async () => {
  await database?.end()
  await native?.close()
})
beforeEach(() => {
  vi.unstubAllEnvs()
  mock.calls = 0
  mock.generate = async () => ({
    text: 'ok',
    usage: { classification: 'measured', inputTokens: 10, outputTokens: 5 },
    sources: [],
  })
})
async function connection(who = alice) {
  const c = await store.connect(who, {
    label: 'My connection',
    provider: 'openai',
    ...providerDefaults.openai,
    key: 'synthetic-private-key-12345',
  })
  await store.saveModels(who, c.id, c.revision, [
    {
      id: 'test-model',
      name: 'Model',
      contextWindow: 32768,
      maxOutputTokens: 8192,
      capabilities: { text: true, structured: true, research: true, streaming: true },
      verified: ['text', 'structured', 'research'],
    },
  ])
  return c
}
async function job(who = alice, limits?: Partial<ReturnType<typeof singleModelRouting>['limits']>) {
  const c = await connection(who),
    profile = singleModelRouting({ connectionId: c.id, modelId: 'test-model' })
  profile.limits = { ...profile.limits, ...limits }
  const queued = await queueByok(store, who, {
    prompt: 'Create a useful web application',
    idempotencyKey: randomUUID(),
    routing: profile,
  })
  await native.admin.query("UPDATE forge_jobs SET status='running' WHERE id=$1", [queued.jobId])
  const run = await readRun(store, who, queued.runId)
  return {
    c,
    queued,
    run,
    executor: new RunExecutor(store, who, run),
    selection: profile.assignments.coding,
  }
}
const req = { prompt: 'hello', system: 'test', maxTokens: 1024, stream: false }
async function finish(jobId: string | null) {
  await native.admin.query("UPDATE forge_jobs SET status='complete' WHERE id=$1", [jobId])
}
it('isolates owners in service methods and forced database RLS', async () => {
  const c = await connection()
  await expect(store.transaction(bob, (tx) => store.read(tx, bob.id, c.id))).rejects.toMatchObject({
    code: 'CONNECTION',
  })
  const rows = await store.transaction(bob, (tx) =>
    tx.query('SELECT * FROM forge_connections WHERE id=$1', [c.id])
  )
  expect(rows.rowCount).toBe(0)
  expect(JSON.stringify(await store.list(alice))).not.toContain('synthetic-private-key')
})
it('competing rotations have one winner and tombstones erase ciphertext', async () => {
  const c = await connection()
  const results = await Promise.allSettled([
    store.change(alice, c.id, 1, 'replacement-key-111'),
    store.change(alice, c.id, 1, 'replacement-key-222'),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  await store.change(alice, c.id, 2)
  const row = await native.admin.query(
    'SELECT envelope,secret_ref,deleted FROM forge_connections WHERE id=$1',
    [c.id]
  )
  expect(row.rows[0]).toMatchObject({ envelope: null, secret_ref: null, deleted: true })
})
it('fences expired and revoked hosted sessions even for connection reads', async () => {
  await native.admin.query(
    "INSERT INTO forge_user(id,name,email) VALUES('hosted-user','Test','fixture@example.test')"
  )
  await native.admin.query(
    "INSERT INTO forge_session(id,user_id,token,expires_at) VALUES('hosted-session','hosted-user','synthetic-session-token',now()+interval '1 hour')"
  )
  const who = { id: 'hosted-user', local: false, sessionId: 'hosted-session' }
  const c = await connection(who)
  await native.admin.query("DELETE FROM forge_session WHERE id='hosted-session'")
  await expect(store.change(who, c.id, 1, 'replacement-key-123')).rejects.toMatchObject({
    code: 'SESSION',
  })
})
it('deduplicates concurrent dispatch and replays only a completed saved result', async () => {
  const j = await job()
  let release: () => void = () => {}
  mock.generate = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({ text: 'persisted', usage: { classification: 'unknown' }, sources: [] })
    })
  const first = j.executor.call('coding-0', 'coding', j.selection, req, AbortSignal.timeout(5000))
  while (!mock.calls) await new Promise((r) => setTimeout(r, 10))
  await expect(
    j.executor.call('coding-0', 'coding', j.selection, req, AbortSignal.timeout(5000))
  ).rejects.toMatchObject({ code: 'UNKNOWN' })
  release()
  expect((await first).text).toBe('persisted')
  const replay = await j.executor.call(
    'coding-0',
    'coding',
    j.selection,
    req,
    AbortSignal.timeout(5000)
  )
  expect(replay.text).toBe('persisted')
  expect(mock.calls).toBe(1)
  await finish(j.queued.jobId)
})
it('blocks a queued run after connection rotation before any provider call', async () => {
  const j = await job()
  await store.change(alice, j.c.id, 1, 'replacement-key-123')
  await expect(
    j.executor.call('coding', 'coding', j.selection, req, AbortSignal.timeout(5000))
  ).rejects.toMatchObject({ code: 'REVOKED' })
  expect(mock.calls).toBe(0)
  await finish(j.queued.jobId)
})
it('stops cancelled and stale-source jobs before dispatch', async () => {
  const j = await job()
  await native.admin.query('UPDATE forge_jobs SET cancelled=true WHERE id=$1', [j.queued.jobId])
  await expect(
    j.executor.call('coding', 'coding', j.selection, req, AbortSignal.timeout(5000))
  ).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(mock.calls).toBe(0)
  await finish(j.queued.jobId)
})
it('retains unknown liability and never replays an interrupted request', async () => {
  vi.stubEnv(
    'FORGE_BYOK_PRICES',
    JSON.stringify([
      {
        connectionProvider: 'openai',
        baseUrl: providerDefaults.openai.baseUrl,
        modelId: 'test-model',
        version: 'test',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        inputMicrosPerMillion: 2000000,
        outputMicrosPerMillion: 8000000,
        cachedInputMicrosPerMillion: 1000000,
        cacheWriteMicrosPerMillion: 2000000,
        searchMicrosPerCall: 10000,
        inputTokenCeiling: 32768,
      },
    ])
  )
  const j = await job(alice, { budgetMode: 'dollars', maxCostMicros: 1000000 })
  mock.generate = async () => {
    throw new Error('interrupted')
  }
  await expect(
    j.executor.call('coding', 'coding', j.selection, req, AbortSignal.timeout(5000))
  ).rejects.toMatchObject({ code: 'UNKNOWN' })
  const row = await native.admin.query(
    'SELECT status,reserved_micros,charged_micros FROM forge_model_attempts WHERE run_id=$1',
    [j.run.id]
  )
  expect(row.rows[0].status).toBe('unknown')
  expect(Number(row.rows[0].reserved_micros)).toBeGreaterThan(0)
  expect(row.rows[0].charged_micros).toBeNull()
  await expect(
    j.executor.call('coding', 'coding', j.selection, req, AbortSignal.timeout(5000))
  ).rejects.toMatchObject({ code: 'UNKNOWN' })
  expect(mock.calls).toBe(1)
  await finish(j.queued.jobId)
})
it('enforces call limits across different stages', async () => {
  const j = await job(bob, { maxCalls: 1 })
  await j.executor.call('planning', 'planning', j.selection, req, AbortSignal.timeout(5000))
  await expect(
    j.executor.call('coding', 'coding', j.selection, req, AbortSignal.timeout(5000))
  ).rejects.toMatchObject({ code: 'CALL_LIMIT' })
  expect(mock.calls).toBe(1)
  await finish(j.queued.jobId)
})
it('rejects a retry key reused for different project input', async () => {
  const c = await connection(bob),
    routing = singleModelRouting({ connectionId: c.id, modelId: 'test-model' }),
    idempotencyKey = randomUUID()
  const first = await queueByok(store, bob, {
    prompt: 'Create one web application',
    routing,
    idempotencyKey,
  })
  expect(
    await queueByok(store, bob, { prompt: 'Create one web application', routing, idempotencyKey })
  ).toEqual(first)
  await expect(
    queueByok(store, bob, { prompt: 'Create a different application', routing, idempotencyKey })
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY' })
  await finish(first.jobId)
})

it('Auto routing rejects models outside saved eligible lists', async () => {
  const { RoutedGeneration } = await import('../../src/server/byok/orchestration')
  const who = { id: 'router-owner', local: true },
    j = await job(who)
  const profile = j.run.snapshot.routing
  profile.mode = 'auto'
  profile.router = j.selection
  for (const role of ['planning', 'coding', 'review', 'repair'] as const)
    profile.candidates[role] = [j.selection]
  await native.admin.query('UPDATE forge_model_runs SET snapshot=$2 WHERE id=$1', [
    j.run.id,
    j.run.snapshot,
  ])
  mock.generate = async () => ({
    text: JSON.stringify({
      ...profile.assignments,
      coding: { connectionId: randomUUID(), modelId: 'unapproved' },
    }),
    usage: { classification: 'unknown' },
    sources: [],
  })
  const routed = new RoutedGeneration(store, j.run, async () => {}, AbortSignal.timeout(5000))
  await expect(routed.prepare('Build a test app')).rejects.toMatchObject({ code: 'ROUTING' })
  expect(mock.calls).toBe(1)
  const result = await native.admin.query('SELECT resolved FROM forge_model_runs WHERE id=$1', [
    j.run.id,
  ])
  expect(result.rows[0].resolved).toBeNull()
  await finish(j.queued.jobId)
})
it('worker recovery replays complete stages and fences interrupted requests', async () => {
  const { recoverModelJobs } = await import('../../src/server/byok/recovery')
  const j = await job({ id: 'recovery-owner', local: true })
  await j.executor.call('planning', 'planning', j.selection, req, AbortSignal.timeout(5000))
  await recoverModelJobs(store)
  expect(
    (await native.admin.query('SELECT status FROM forge_jobs WHERE id=$1', [j.queued.jobId]))
      .rows[0].status
  ).toBe('queued')
  await native.admin.query("UPDATE forge_jobs SET status='running' WHERE id=$1", [j.queued.jobId])
  await j.executor.call('planning', 'planning', j.selection, req, AbortSignal.timeout(5000))
  expect(mock.calls).toBe(1)
  await native.admin.query("UPDATE forge_model_attempts SET status='dispatched' WHERE run_id=$1", [
    j.run.id,
  ])
  await recoverModelJobs(store)
  expect(
    (await native.admin.query('SELECT status FROM forge_jobs WHERE id=$1', [j.queued.jobId]))
      .rows[0].status
  ).toBe('failed')
  expect(
    (
      await native.admin.query('SELECT status FROM forge_model_attempts WHERE run_id=$1', [
        j.run.id,
      ])
    ).rows[0].status
  ).toBe('unknown')
})
it('a shared internal budget is reserved atomically across owners', async () => {
  vi.stubEnv(
    'FORGE_BYOK_PRICES',
    JSON.stringify([
      {
        connectionProvider: 'openai',
        baseUrl: providerDefaults.openai.baseUrl,
        modelId: 'test-model',
        version: 'test',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        inputMicrosPerMillion: 2000000,
        outputMicrosPerMillion: 8000000,
        cachedInputMicrosPerMillion: 1000000,
        cacheWriteMicrosPerMillion: 2000000,
        searchMicrosPerCall: 10000,
        inputTokenCeiling: 32768,
      },
    ])
  )
  vi.stubEnv('FORGE_BYOK_TEST_BUDGET_MICROS', '73728')
  const a = await job(
    { id: 'budget-one', local: true },
    { budgetMode: 'dollars', maxCostMicros: 1000000 }
  )
  const b = await job(
    { id: 'budget-two', local: true },
    { budgetMode: 'dollars', maxCostMicros: 1000000 }
  )
  mock.generate = async () => ({
    text: 'fixture',
    usage: { classification: 'unknown' },
    sources: [],
  })
  const attempts = await Promise.allSettled(
    [a, b].map((j) =>
      j.executor.call('coding', 'coding', j.selection, req, AbortSignal.timeout(5000))
    )
  )
  expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(mock.calls).toBe(1)
  expect(
    (
      await native.admin.query(
        "SELECT liability_micros FROM forge_model_budget WHERE scope='internal-test'"
      )
    ).rows[0].liability_micros
  ).toBe('73728')
  await finish(a.queued.jobId)
  await finish(b.queued.jobId)
})

it('manual task selections drive research, planning, source, review and repair artifacts', async () => {
  const { RoutedGeneration } = await import('../../src/server/byok/orchestration')
  const who = { id: 'multi-stage-owner', local: true }
  const research = await connection(who),
    coding = await connection(who),
    review = await connection(who)
  const select = (id: string) => ({ connectionId: id, modelId: 'test-model' })
  const routing = singleModelRouting(select(coding.id))
  routing.assignments.research = select(research.id)
  routing.assignments.review = select(review.id)
  routing.assignments.repair = select(review.id)
  const queued = await queueByok(store, who, {
    prompt: 'A test app',
    idempotencyKey: randomUUID(),
    routing,
  })
  await native.admin.query("UPDATE forge_jobs SET status='running' WHERE id=$1", [queued.jobId])
  const run = await readRun(store, who, queued.runId)
  const texts = [
    'Source-linked research',
    'Implementation plan',
    JSON.stringify({
      summary: 'Initial app',
      operations: [
        {
          type: 'write',
          path: 'app/page.tsx',
          content: 'export default function Page(){return <main>Initial app</main>}',
        },
      ],
    }),
    JSON.stringify({ approved: false, issues: ['Add a heading'] }),
    JSON.stringify({
      summary: 'Heading added',
      operations: [
        {
          type: 'write',
          path: 'app/page.tsx',
          content: 'export default function Page(){return <main><h1>Repaired app</h1></main>}',
        },
      ],
    }),
    JSON.stringify({ approved: true, issues: [] }),
  ]
  mock.generate = async () => ({
    text: texts.shift()!,
    usage: { classification: 'measured', inputTokens: 10, outputTokens: 5 },
    sources:
      mock.calls === 1
        ? [{ url: 'https://www.typescriptlang.org/docs/', title: 'TypeScript' }]
        : [],
  })
  const routed = new RoutedGeneration(store, run, async () => {}, AbortSignal.timeout(5000))
  expect(await routed.prepare('A test app')).toBe('Implementation plan')
  const initial = await routed.files(
    'A test app',
    { 'app/globals.css': 'body { margin: 0 }' },
    'coding'
  )
  expect((await routed.review('A test app', initial.files, 0)).approved).toBe(false)
  const repaired = await routed.files('Add a heading', initial.files, 'repair', 1)
  expect(repaired.files['app/page.tsx']).toContain('Repaired app')
  expect((await routed.review('A test app', repaired.files, 1)).approved).toBe(true)
  const attempts = await native.admin.query(
    'SELECT task,connection_id FROM forge_model_attempts WHERE run_id=$1 ORDER BY dispatched_at',
    [run.id]
  )
  expect(attempts.rows).toEqual([
    { task: 'research', connection_id: research.id },
    { task: 'planning', connection_id: coding.id },
    { task: 'coding', connection_id: coding.id },
    { task: 'review', connection_id: review.id },
    { task: 'repair', connection_id: review.id },
    { task: 'review', connection_id: review.id },
  ])
  expect(mock.calls).toBe(6)
  await routed.finish('complete')
  await finish(queued.jobId)
})
it('a valid Auto proposal is recorded before planning and consumes the shared call limit', async () => {
  const { RoutedGeneration } = await import('../../src/server/byok/orchestration')
  const who = { id: 'valid-router-owner', local: true },
    j = await job(who, { maxCalls: 2 })
  const profile = j.run.snapshot.routing
  profile.mode = 'auto'
  profile.router = j.selection
  for (const role of ['planning', 'coding', 'review', 'repair'] as const)
    profile.candidates[role] = [j.selection]
  await native.admin.query('UPDATE forge_model_runs SET snapshot=$2 WHERE id=$1', [
    j.run.id,
    j.run.snapshot,
  ])
  mock.generate = async () => ({
    text: mock.calls === 1 ? JSON.stringify(profile.assignments) : 'Plan',
    usage: { classification: 'unknown' },
    sources: [],
  })
  const routed = new RoutedGeneration(store, j.run, async () => {}, AbortSignal.timeout(5000))
  expect(await routed.prepare('Test app')).toBe('Plan')
  expect((await readRun(store, who, j.run.id)).resolved).toEqual(profile.assignments)
  await expect(routed.files('Build', {}, 'coding')).rejects.toMatchObject({ code: 'CALL_LIMIT' })
  expect(mock.calls).toBe(2)
  await finish(j.queued.jobId)
})
it('only an explicitly saved fallback can follow a known rejection', async () => {
  const { RoutedGeneration } = await import('../../src/server/byok/orchestration')
  const { ByokError } = await import('../../src/server/byok/transport')
  for (const enabled of [false, true]) {
    const who = { id: 'fallback-' + enabled, local: true },
      j = await job(who),
      c = await connection(who)
    const alternate = { connectionId: c.id, modelId: 'test-model' }
    if (enabled) j.run.snapshot.routing.fallbacks.planning = [alternate]
    j.run.snapshot.bindings.push({
      ...alternate,
      revision: 1,
      profile: j.run.snapshot.bindings[0].profile,
    })
    await native.admin.query('UPDATE forge_model_runs SET snapshot=$2 WHERE id=$1', [
      j.run.id,
      j.run.snapshot,
    ])
    let count = 0
    mock.generate = async () => {
      if (++count === 1) throw new ByokError('RATE_LIMIT', 'Fixture limit', 429, true)
      return { text: 'Fallback plan', usage: { classification: 'unknown' }, sources: [] }
    }
    const routed = new RoutedGeneration(store, j.run, async () => {}, AbortSignal.timeout(5000))
    if (enabled) expect(await routed.prepare('Test')).toBe('Fallback plan')
    else await expect(routed.prepare('Test')).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(count).toBe(enabled ? 2 : 1)
    await finish(j.queued.jobId)
  }
})
