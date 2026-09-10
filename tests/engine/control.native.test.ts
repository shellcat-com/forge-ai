import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { fork, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { readControlConfig } from '../../engine/control/config.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { startNativePostgres } from './native-postgres.ts'
import { FixtureIdentityAdapter, SessionService } from '../../engine/control/identity.ts'
import { ControlService } from '../../engine/control/service.ts'
import { createControlServer } from '../../engine/control/http.ts'
import { SimulatedWorkerCrash, ControlWorker } from '../../engine/control/worker.ts'
import { FixtureStageAdapter } from '../../engine/control/fixture-stage.ts'
import { ControlReconciler, FixtureCleanupAdapter } from '../../engine/control/reconciler.ts'
let db: Awaited<ReturnType<typeof startNativePostgres>>,
  identity: FixtureIdentityAdapter,
  sessions: SessionService,
  service: ControlService
let server: ReturnType<typeof createControlServer>,
  origin: string,
  worker: ControlWorker,
  reconciler: ControlReconciler
const options = { enabled: true, origin: 'http://127.0.0.1:0', pollMs: 20, keepaliveMs: 50 }
beforeAll(async () => {
  const build = spawnSync('npx', ['tsc', '-p', 'tsconfig.control.json'], {
    encoding: 'utf8',
    timeout: 30000,
  })
  if (build.status !== 0) throw new Error(build.stdout + build.stderr)
  db = await startNativePostgres()
  identity = await FixtureIdentityAdapter.create()
  sessions = new SessionService(db.api, identity, randomBytes(32), options.origin)
  service = new ControlService(db.api, sessions, true)
  server = createControlServer(service, options)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  options.origin = origin
  sessions.origin = origin
  worker = new ControlWorker(db.worker, new FixtureStageAdapter())
  reconciler = new ControlReconciler(db.maintenance, new FixtureCleanupAdapter())
}, 30000)
afterAll(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  await db?.close()
})
beforeEach(async () => {
  await db.admin.query(`DO $$ DECLARE names text; BEGIN
    SELECT string_agg(format('forge_control.%I',tablename),',') INTO names FROM pg_tables WHERE schemaname='forge_control' AND tablename NOT IN('schema_migrations','control_settings');
    EXECUTE 'TRUNCATE TABLE '||names||' CASCADE'; END $$`)
  await db.admin.query(
    'UPDATE forge_control.control_settings SET admission_enabled=true,worker_enabled=true,security_shutdown=false,max_queued=50,max_running=10,max_previews=20,max_pending_reviews=5'
  )
})
interface Actor {
  id: string
  workspace: string
  subject: string
  token: string
  csrf: string
  cookie: string
}
async function actor(role = 'owner'): Promise<Actor> {
  const id = randomUUID(),
    workspace = randomUUID(),
    subject = `fixture-${id}`
  await db.admin.query(
    `INSERT INTO forge_control.users(id,oidc_issuer,oidc_subject) VALUES($1,$2,$3);`,
    [id, identity.issuer, subject]
  )
  await db.admin.query('INSERT INTO forge_control.workspaces(id,name) VALUES($1,$2)', [
    workspace,
    'Synthetic E1 workspace',
  ])
  await db.admin.query(
    'INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',
    [workspace, id, role]
  )
  await db.admin.query(
    `INSERT INTO forge_control.workspace_quotas(workspace_id,period_start,limit_micros,max_active_jobs,max_previews) VALUES($1,date_trunc('day',now()),1000,10,2)`,
    [workspace]
  )
  const b = sessions.bootstrap(),
    login = await sessions.login(b.cookie, randomUUID(), {
      schemaVersion: 1,
      returnPath: '/#/projects',
      bootstrapNonce: b.nonce,
    })
  const code = await identity.issueCode(login.authorizationUrl, subject),
    result = await sessions.callback(b.cookie, code.state, code.code)
  return {
    id,
    workspace,
    subject,
    token: result.token,
    csrf: result.csrfToken,
    cookie: `__Host-forge-control=${result.token}`,
  }
}
const projectBody = {
  schemaVersion: 1,
  name: 'Synthetic task board',
  brief: 'Build a synthetic task board for E1 testing only.',
  presetId: 'editorial-product',
  presetVersion: 1,
  templateId: 'next-postgres-v1',
}
async function project(a: Actor) {
  const r = await service.createProject(a.token, a.workspace, a.csrf, randomUUID(), projectBody)
  return (r.body.project as { id: string }).id
}
const jobBody = {
  schemaVersion: 1,
  kind: 'generate',
  baseSnapshotId: null,
  baseRevision: 1,
  instruction: 'Build a synthetic task board for E1 testing only.',
  modelPolicyId: 'fixture-v1',
  maxCostMicros: 10,
}
async function job(a: Actor, p?: string) {
  const projectId = p ?? (await project(a))
  const r = await service.admit(a.token, projectId, a.csrf, randomUUID(), jobBody)
  return { id: (r.body.job as { id: string }).id, projectId }
}
async function state(a: Actor, j: string) {
  return (await service.getJob(a.token, j)).job
}
async function approve(a: Actor, j: string) {
  const current = await state(a, j)
  const kind =
    current.state === 'AWAITING_PLAN_APPROVAL'
      ? 'plan'
      : current.state === 'AWAITING_EXECUTION_APPROVAL'
        ? 'execution'
        : 'promotion'
  return service.approve(a.token, j, a.csrf, randomUUID(), {
    schemaVersion: 1,
    kind,
    decision: 'approve',
    subjectDigest: current.reviewDigest,
    stateVersion: current.stateVersion,
  })
}
async function reach(a: Actor, j: string, target: string, w = worker) {
  for (let i = 0; i < 40; i++) {
    const current = await state(a, j)
    if (current.state === target) return current
    if (current.state.startsWith('AWAITING_')) await approve(a, j)
    else await w.runOnce()
  }
  throw new Error(`Did not reach ${target}: ${JSON.stringify(await state(a, j))}`)
}
async function request(
  a: Actor | undefined,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(a ? { Cookie: a.cookie, 'X-CSRF-Token': a.csrf } : {}),
      ...(method !== 'GET'
        ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
}
it('applies additive E1 SQL with safe runtime roles', async () => {
  expect(db.version).toContain('PostgreSQL')
  expect(
    (
      await db.admin.query('SELECT version FROM forge_control.schema_migrations ORDER BY version')
    ).rows.map((r) => r.version)
  ).toEqual([1, 2])
})
it('persists projects, completes only fixture stages and atomically promotes source', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PROMOTION')
  const before = await service.getProject(a.token, j.projectId)
  expect(before.project.headSnapshotId).toBeNull()
  await approve(a, j.id)
  expect((await state(a, j.id)).state).toBe('SUCCEEDED')
  const after = await service.getProject(a.token, j.projectId)
  expect(after.project.revision).toBe(2)
  expect(after.project.headSnapshotId).toBeTruthy()
  expect(
    (
      await db.admin.query(
        'SELECT status,released_micros FROM forge_control.usage_reservations WHERE job_id=$1',
        [j.id]
      )
    ).rows[0]
  ).toMatchObject({ status: 'settled', released_micros: '10' })
  const events = await service.events(a.token, j.id, undefined)
  expect(events.events.some((e) => e.type === 'check.result' && e.data.origin === 'fixture')).toBe(
    true
  )
}, 30000)
it('uses the API session cookie, enforces CSRF/Origin and returns durable projects', async () => {
  const a = await actor()
  expect(
    (await request(a, `/api/v1/workspaces/${a.workspace}/projects`, 'POST', projectBody)).status
  ).toBe(201)
  expect(
    (
      await request(a, `/api/v1/workspaces/${a.workspace}/projects`, 'POST', projectBody, {
        'X-CSRF-Token': 'bad',
      })
    ).status
  ).toBe(403)
  expect(
    (await request(a, '/api/v1/session', 'GET', undefined, { Origin: 'https://attacker.invalid' }))
      .status
  ).toBe(403)
  expect((await request(undefined, '/api/v1/session')).status).toBe(401)
  expect((await request(a, '/api/v1/capabilities')).status).toBe(200)
})

it('denies cross-tenant reads/writes and viewer mutations, including pooled context reuse', async () => {
  const a = await actor(),
    b = await actor(),
    viewer = await actor('viewer'),
    p = await project(a),
    j = await job(a, p)
  await expect(service.getProject(b.token, p)).rejects.toMatchObject({ code: 'P0404' })
  await expect(service.getJob(b.token, j.id)).rejects.toMatchObject({ code: 'P0404' })
  await expect(service.events(b.token, j.id, undefined)).rejects.toMatchObject({ code: 'P0404' })
  await expect(
    service.createProject(viewer.token, viewer.workspace, viewer.csrf, randomUUID(), projectBody)
  ).rejects.toMatchObject({ code: 'P0403' })
  await db.api.session(a.token, a.workspace, 'viewer', async (c) =>
    expect(
      (await c.query('SELECT * FROM projects')).rows.every((r) => r.workspace_id === a.workspace)
    ).toBe(true)
  )
  await db.api.session(b.token, b.workspace, 'viewer', async (c) =>
    expect((await c.query('SELECT * FROM projects')).rows).toHaveLength(0)
  )
  await db.api.tx(async (c) =>
    expect((await c.query('SELECT * FROM projects')).rows).toHaveLength(0)
  )
  await expect(
    db.api.tx(async (c) => {
      await c.query("UPDATE memberships SET role='owner'")
    })
  ).rejects.toMatchObject({ code: '42501' })
})
it('deduplicates concurrent requests, rejects different content and allows exactly one active project job', async () => {
  const a = await actor(),
    p = await project(a),
    key = randomUUID()
  const results = await Promise.all(
    Array.from({ length: 6 }, () => service.admit(a.token, p, a.csrf, key, jobBody))
  )
  expect(new Set(results.map((r) => (r.body.job as { id: string }).id)).size).toBe(1)
  await expect(
    service.admit(a.token, p, a.csrf, key, {
      ...jobBody,
      instruction: 'A different synthetic application instruction.',
    })
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  const rows = (
    await db.admin.query(
      'SELECT count(*)::int AS n FROM forge_control.usage_reservations WHERE project_id=$1',
      [p]
    )
  ).rows
  expect(rows[0].n).toBe(1)
  const duplicate = await Promise.allSettled([
    service.admit(a.token, p, a.csrf, randomUUID(), jobBody),
    service.admit(a.token, p, a.csrf, randomUUID(), jobBody),
  ])
  expect(duplicate.every((r) => r.status === 'rejected')).toBe(true)
})
it('serializes concurrent quota admission across projects without overspending', async () => {
  const a = await actor(),
    p1 = await project(a),
    p2 = await project(a)
  await db.admin.query(
    'UPDATE forge_control.workspace_quotas SET limit_micros=10 WHERE workspace_id=$1',
    [a.workspace]
  )
  const results = await Promise.allSettled([
    service.admit(a.token, p1, a.csrf, randomUUID(), jobBody),
    service.admit(a.token, p2, a.csrf, randomUUID(), jobBody),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(
    (
      await db.admin.query(
        'SELECT reserved_micros FROM forge_control.workspace_quotas WHERE workspace_id=$1',
        [a.workspace]
      )
    ).rows[0].reserved_micros
  ).toBe('10')
})
it('enforces optimistic revisions and blocks editing a project with a nonterminal job', async () => {
  const a = await actor(),
    p = await project(a)
  await service.patchProject(a.token, p, a.csrf, randomUUID(), 1, {
    schemaVersion: 1,
    name: 'Updated synthetic title',
  })
  await expect(
    service.patchProject(a.token, p, a.csrf, randomUUID(), 1, { schemaVersion: 1, name: 'stale' })
  ).rejects.toMatchObject({ status: 412 })
  await service.admit(a.token, p, a.csrf, randomUUID(), { ...jobBody, baseRevision: 2 })
  await expect(
    service.patchProject(a.token, p, a.csrf, randomUUID(), 2, { schemaVersion: 1, name: 'busy' })
  ).rejects.toMatchObject({ status: 409 })
})
it('fences an expired worker, then reclaims the durable step with a higher epoch', async () => {
  const a = await actor(),
    j = await job(a)
  const first = await worker.claim()
  expect(first!.job_id).toBe(j.id)
  await db.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [first!.id]
  )
  await expect(worker.heartbeat(first!)).rejects.toMatchObject({ code: 'LEASE_LOST' })
  await expect(worker.complete(first!, null)).rejects.toMatchObject({ code: 'LEASE_LOST' })
  await reconciler.runOnce()
  const replacement = new ControlWorker(db.worker, new FixtureStageAdapter()),
    next = await replacement.claim()
  expect(next!.id).toBe(first!.id)
  expect(Number(next!.lease_epoch)).toBeGreaterThan(Number(first!.lease_epoch))
  await replacement.complete(next!, null)
  await expect(replacement.complete(next!, null)).rejects.toMatchObject({ code: 'LEASE_LOST' })
  expect((await state(a, j.id)).state).toBe('PLANNING')
})
it('keeps cancellation pending and reservations held until fixture cleanup is confirmed', async () => {
  const a = await actor(),
    j = await job(a)
  await service.cancel(a.token, j.id, a.csrf, randomUUID())
  const unavailable = new ControlReconciler(db.maintenance, new FixtureCleanupAdapter(false))
  await unavailable.runOnce()
  expect((await state(a, j.id)).state).toBe('CANCELLING')
  expect(
    (
      await db.admin.query(
        'SELECT released_micros FROM forge_control.usage_reservations WHERE job_id=$1',
        [j.id]
      )
    ).rows[0].released_micros
  ).toBe('0')
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('CANCELLED')
  expect((await service.cancel(a.token, j.id, a.csrf, randomUUID())).status).toBe(200)
})

it('recovers saved provider output after worker restart without a second call or charge', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'PLANNING')
  const crash = new ControlWorker(db.worker, new FixtureStageAdapter(), {
    afterResult: async () => {
      throw new SimulatedWorkerCrash('after saved fixture output')
    },
  })
  await expect(crash.runOnce()).rejects.toBeInstanceOf(SimulatedWorkerCrash)
  await db.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND status='running'",
    [j.id]
  )
  await reconciler.runOnce()
  const replacement = new ControlWorker(db.worker, {
    origin: 'fixture',
    run: async () => {
      throw new Error('Provider must not be called twice')
    },
  })
  await replacement.runOnce()
  expect((await state(a, j.id)).state).toBe('AWAITING_PLAN_APPROVAL')
  expect(
    (await db.admin.query('SELECT provider_calls FROM forge_control.jobs WHERE id=$1', [j.id]))
      .rows[0].provider_calls
  ).toBe(1)
  expect(
    (
      await db.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.usage_ledger WHERE job_id=$1',
        [j.id]
      )
    ).rows[0].n
  ).toBe(1)
})
it('keeps an ambiguous provider charge reserved after actual worker process death; resolves it once', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'PLANNING')
  const child = fork(fileURLToPath(new URL('./fixture-worker-child.mjs', import.meta.url)), [], {
    env: { ...process.env, FORGE_E1_TEST_SOCKET: db.config.host },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Child dispatch timeout')), 5000)
      child.once('message', () => {
        clearTimeout(timeout)
        resolve()
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code !== null && code !== 0) reject(new Error('Child failed before dispatch'))
      })
    })
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
    await db.admin.query(
      "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND status='running'",
      [j.id]
    )
    await reconciler.runOnce()
    expect((await state(a, j.id)).state).toBe('FAILED')
    const reservation = (
      await db.admin.query(
        'SELECT status,released_micros FROM forge_control.usage_reservations WHERE job_id=$1',
        [j.id]
      )
    ).rows[0]
    expect(reservation).toMatchObject({ status: 'uncertain', released_micros: '9' })
    const op = (
      await db.admin.query(
        'SELECT operation_id FROM forge_control.provider_attempts WHERE job_id=$1',
        [j.id]
      )
    ).rows[0].operation_id
    await reconciler.resolveUncertain(a.workspace, j.id, op, 1)
    await reconciler.resolveUncertain(a.workspace, j.id, op, 1)
    expect(
      (
        await db.admin.query(
          'SELECT count(*)::int AS n FROM forge_control.usage_ledger WHERE job_id=$1',
          [j.id]
        )
      ).rows[0].n
    ).toBe(1)
    expect(
      (
        await db.admin.query(
          'SELECT reserved_micros,spent_micros FROM forge_control.workspace_quotas WHERE workspace_id=$1',
          [a.workspace]
        )
      ).rows[0]
    ).toEqual({ reserved_micros: '0', spent_micros: '1' })
  } finally {
    child.kill('SIGKILL')
  }
}, 15000)
it('does not repeat a committed stage when the worker dies before acknowledgment', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'PLANNING')
  const crash = new ControlWorker(db.worker, new FixtureStageAdapter(), {
    afterCommit: async () => {
      throw new SimulatedWorkerCrash('lost acknowledgment')
    },
  })
  await expect(crash.runOnce()).rejects.toBeInstanceOf(SimulatedWorkerCrash)
  expect((await state(a, j.id)).state).toBe('AWAITING_PLAN_APPROVAL')
  await reconciler.runOnce()
  expect(await new ControlWorker(db.worker, new FixtureStageAdapter()).runOnce()).toBe(false)
  expect(
    (await db.admin.query('SELECT provider_calls FROM forge_control.jobs WHERE id=$1', [j.id]))
      .rows[0].provider_calls
  ).toBe(1)
})
it('serializes promotion and cancellation; no cancelled job changes the source head', async () => {
  for (let i = 0; i < 3; i++) {
    const a = await actor(),
      j = await job(a)
    await reach(a, j.id, 'AWAITING_PROMOTION')
    const current = await state(a, j.id)
    const results = await Promise.allSettled([
      service.approve(a.token, j.id, a.csrf, randomUUID(), {
        schemaVersion: 1,
        kind: 'promotion',
        decision: 'approve',
        subjectDigest: current.reviewDigest,
        stateVersion: current.stateVersion,
      }),
      service.cancel(a.token, j.id, a.csrf, randomUUID()),
    ])
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    await reconciler.runOnce()
    const final = await state(a, j.id),
      p = await service.getProject(a.token, j.projectId)
    if (final.state === 'SUCCEEDED') {
      expect(p.project.headSnapshotId).toBe(final.candidateSnapshotId)
      expect(p.project.revision).toBe(2)
    } else {
      expect(final.state).toBe('CANCELLED')
      expect(p.project.headSnapshotId).toBeNull()
      expect(p.project.revision).toBe(1)
    }
  }
}, 30000)
it('a repaired candidate cannot reuse the previous execution approval', async () => {
  const a = await actor(),
    j = await job(a),
    repairer = new ControlWorker(db.worker, new FixtureStageAdapter({ repairOnce: true }))
  await reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL', repairer)
  const old = await state(a, j.id)
  await approve(a, j.id)
  await reach(a, j.id, 'REPAIRING', repairer)
  await reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL', repairer)
  await expect(
    service.approve(a.token, j.id, a.csrf, randomUUID(), {
      schemaVersion: 1,
      kind: 'execution',
      decision: 'approve',
      subjectDigest: old.reviewDigest,
      stateVersion: old.stateVersion,
    })
  ).rejects.toMatchObject({ code: 'STALE_APPROVAL' })
  const current = await state(a, j.id)
  expect(current.candidateSnapshotId).not.toBe(old.candidateSnapshotId)
  expect(current.reviewDigest).not.toBe(old.reviewDigest)
})
it('expires active work through cleanup and never revives it on worker restart', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'PLANNING')
  await db.admin.query(
    "UPDATE forge_control.jobs SET active_started_at=now()-interval '2 seconds',active_deadline_at=now()-interval '1 second',active_remaining_ms=1000 WHERE id=$1",
    [j.id]
  )
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('EXPIRED')
  expect(await worker.runOnce()).toBe(false)
})
it('rechecks membership and policy revocation before approval and further dispatch', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  const current = await state(a, j.id)
  await db.admin.query(
    'DELETE FROM forge_control.memberships WHERE workspace_id=$1 AND user_id=$2',
    [a.workspace, a.id]
  )
  await expect(
    service.approve(a.token, j.id, a.csrf, randomUUID(), {
      schemaVersion: 1,
      kind: 'plan',
      decision: 'approve',
      subjectDigest: current.reviewDigest,
      stateVersion: current.stateVersion,
    })
  ).rejects.toMatchObject({ code: 'P0404' })
  await reconciler.runOnce()
  expect(
    (await db.admin.query('SELECT state FROM forge_control.jobs WHERE id=$1', [j.id])).rows[0].state
  ).toBe('FAILED')
})
it('requires reset acknowledgment and restores source into a new reviewed history record', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PROMOTION')
  await approve(a, j.id)
  const prior = (await service.getProject(a.token, j.projectId)).project
  await expect(
    service.restore(a.token, prior.headSnapshotId!, a.csrf, randomUUID(), {
      schemaVersion: 1,
      expectedProjectRevision: 2,
      maxCostMicros: 0,
    })
  ).rejects.toThrow()
  const restoration = await service.restore(a.token, prior.headSnapshotId!, a.csrf, randomUUID(), {
    schemaVersion: 1,
    expectedProjectRevision: 2,
    maxCostMicros: 0,
    resetPreviewDataAcknowledged: true,
  })
  const id = (restoration.body.job as { id: string }).id
  await reach(a, id, 'AWAITING_PROMOTION')
  await approve(a, id)
  const next = (await service.getProject(a.token, j.projectId)).project
  expect(next.revision).toBe(3)
  expect(next.headSnapshotId).not.toBe(prior.headSnapshotId)
  expect(
    (
      await db.admin.query('SELECT parent_id FROM forge_control.snapshots WHERE id=$1', [
        next.headSnapshotId,
      ])
    ).rows[0].parent_id
  ).toBe(prior.headSnapshotId)
}, 30000)
async function readStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  until: (text: string, done: boolean) => boolean
) {
  let text = ''
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Stream read timeout')), 2500)
      }),
    ]).finally(() => clearTimeout(timer))
    text += new TextDecoder().decode(result.value)
    if (until(text, !!result.done)) return text
    if (result.done) throw new Error('Stream closed early')
  }
  throw new Error('Stream condition timeout')
}
it('replays SSE after disconnect without cancelling the job and closes on membership revocation', async () => {
  const a = await actor(),
    j = await job(a)
  const first = await request(a, `/api/v1/jobs/${j.id}/events`)
  expect(first.status).toBe(200)
  const reader = first.body!.getReader()
  await readStream(reader, (t) => t.includes(`id: ${j.id}:1`))
  await reader.cancel()
  expect((await state(a, j.id)).state).toBe('QUEUED')
  await worker.runOnce()
  const replay = await request(a, `/api/v1/jobs/${j.id}/events`, 'GET', undefined, {
      'Last-Event-ID': `${j.id}:1`,
    }),
    next = replay.body!.getReader()
  const text = await readStream(next, (t) => t.includes(`id: ${j.id}:2`))
  expect(text).not.toContain(`id: ${j.id}:1\n`)
  await db.admin.query(
    'DELETE FROM forge_control.memberships WHERE workspace_id=$1 AND user_id=$2',
    [a.workspace, a.id]
  )
  await readStream(next, (_t, done) => done)
})
it('rejects foreign/future SSE cursors and closes terminal replay after flushing facts', async () => {
  const a = await actor(),
    j = await job(a)
  expect(
    (
      await request(a, `/api/v1/jobs/${j.id}/events`, 'GET', undefined, {
        'Last-Event-ID': `${j.id}:999`,
      })
    ).status
  ).toBe(422)
  expect(
    (
      await request(a, `/api/v1/jobs/${j.id}/events`, 'GET', undefined, {
        'Last-Event-ID': `${randomUUID()}:1`,
      })
    ).status
  ).toBe(422)
  await service.cancel(a.token, j.id, a.csrf, randomUUID())
  await reconciler.runOnce()
  const response = await request(a, `/api/v1/jobs/${j.id}/events`),
    text = await response.text()
  expect(text).toContain('event: job.terminal')
  expect(text).toContain('CANCELLED')
})

it('starts default-off without database access and rejects live or unsafe fixture settings', () => {
  expect(readControlConfig({})).toEqual({ enabled: false })
  const disabled = spawnSync(process.execPath, ['dist-engine/control/index.js', 'api'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 3000,
  })
  expect(disabled.status).toBe(0)
  expect(disabled.stdout).toContain('No listener, database or worker started')
  const env = {
    FORGE_CONTROL_ENABLED: 'true',
    FORGE_CONTROL_MODE: 'fixture',
    FORGE_CONTROL_ORIGIN: origin,
    FORGE_CONTROL_DATABASE_URL: 'postgresql://fixture:fake@localhost/control',
    FORGE_CONTROL_SESSION_KEY: 'a'.repeat(64),
    FORGE_CONTROL_PORT: '5055',
  }
  expect(readControlConfig(env)).toMatchObject({
    enabled: true,
    admission: false,
    workers: false,
    execution: false,
    preview: false,
  })
  for (const change of [
    { FORGE_CONTROL_MODE: 'live' },
    { FORGE_CONTROL_SESSION_KEY: '' },
    { FORGE_CONTROL_EXECUTION: 'true' },
    { FORGE_CONTROL_PREVIEW: 'true' },
    { FORGE_CONTROL_DATABASE_URL: 'postgresql://fixture:fake@remote.invalid/control' },
    { FORGE_CONTROL_ORIGIN: 'https://remote.invalid' },
  ])
    expect(() => readControlConfig({ ...env, ...change })).toThrow()
})
it('implements one-use bootstrap login and a signed fixture callback with secure opaque cookies', async () => {
  const a = await actor()
  const bootstrap = await request(undefined, '/api/v1/auth/bootstrap'),
    b = await bootstrap.json()
  const cookie = bootstrap.headers.get('set-cookie')!
  expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax')
  expect(cookie).not.toContain('Domain=')
  const headers = { Cookie: cookie.split(';')[0], 'Idempotency-Key': randomUUID() }
  const input = { schemaVersion: 1, returnPath: '/#/projects', bootstrapNonce: b.bootstrapNonce }
  const login = await request(undefined, '/api/v1/auth/login', 'POST', input, headers),
    body = await login.json()
  expect(login.status).toBe(200)
  expect(
    await (await request(undefined, '/api/v1/auth/login', 'POST', input, headers)).json()
  ).toEqual(body)
  const code = await identity.issueCode(body.authorizationUrl, a.subject)
  const callback = `/api/v1/auth/callback?state=${code.state}&code=${code.code}`
  const response = await request(undefined, callback, 'GET', undefined, headers)
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/#/projects')
  expect(response.headers.get('set-cookie')).toContain('__Host-forge-control=')
  expect(response.headers.get('set-cookie')).toContain('Max-Age=43200')
  expect((await request(undefined, callback, 'GET', undefined, headers)).status).toBe(401)
})
it('rejects wrong state/bootstrap, issuer, audience, nonce, PKCE and non-invited fixture identities', async () => {
  const a = await actor()
  for (const overrides of [
    { iss: 'https://wrong.invalid' },
    { aud: 'wrong-audience' },
    { nonce: 'wrong-nonce' },
  ]) {
    const b = sessions.bootstrap(),
      login = await sessions.login(b.cookie, randomUUID(), {
        schemaVersion: 1,
        returnPath: '/',
        bootstrapNonce: b.nonce,
      })
    const code = await identity.issueCode(login.authorizationUrl, a.subject, overrides)
    await expect(sessions.callback(b.cookie, code.state, code.code)).rejects.toMatchObject({
      code: 'INVALID_AUTH_TRANSACTION',
    })
  }
  const b = sessions.bootstrap(),
    login = await sessions.login(b.cookie, randomUUID(), {
      schemaVersion: 1,
      returnPath: '/',
      bootstrapNonce: b.nonce,
    }),
    code = await identity.issueCode(login.authorizationUrl, a.subject)
  await expect(
    sessions.callback(sessions.bootstrap().cookie, code.state, code.code)
  ).rejects.toMatchObject({ code: 'INVALID_AUTH_TRANSACTION' })
  await expect(
    sessions.callback(b.cookie, sessions.bootstrap().cookie, code.code)
  ).rejects.toMatchObject({ code: 'INVALID_AUTH_TRANSACTION' })
  await expect(
    identity.exchange(
      code.code,
      'wrong-verifier',
      sha256('nonce'),
      origin + '/api/v1/auth/callback'
    )
  ).rejects.toMatchObject({ code: 'INVALID_AUTH_TRANSACTION' })
  const next = await sessions.login(b.cookie, randomUUID(), {
      schemaVersion: 1,
      returnPath: '/',
      bootstrapNonce: b.nonce,
    }),
    uninvited = await identity.issueCode(next.authorizationUrl, 'not-invited')
  await expect(sessions.callback(b.cookie, uninvited.state, uninvited.code)).rejects.toMatchObject({
    code: 'P0403',
  })
  expect(
    (await db.admin.query('SELECT count(*)::int AS n FROM forge_control.sessions')).rows[0].n
  ).toBe(1)
})
it('expires server sessions absolutely and revokes SSE on idempotent logout', async () => {
  const a = await actor(),
    j = await job(a),
    response = await request(a, `/api/v1/jobs/${j.id}/events`),
    reader = response.body!.getReader()
  await readStream(reader, (t) => t.includes('event: job.state'))
  const key = randomUUID()
  expect(
    (
      await request(
        a,
        '/api/v1/auth/logout',
        'POST',
        { schemaVersion: 1 },
        { 'Idempotency-Key': key }
      )
    ).status
  ).toBe(204)
  expect(
    (
      await request(
        a,
        '/api/v1/auth/logout',
        'POST',
        { schemaVersion: 1 },
        { 'Idempotency-Key': key }
      )
    ).status
  ).toBe(204)
  await readStream(reader, (_t, done) => done)
  expect((await request(a, '/api/v1/session')).status).toBe(401)
  const b = await actor()
  await db.admin.query(
    "UPDATE forge_control.sessions SET created_at=now()-interval '13 hours',expires_at=now()-interval '1 hour' WHERE user_id=$1",
    [b.id]
  )
  expect((await request(b, '/api/v1/session')).status).toBe(401)
})
it('replays identical explicit promotion requests after success without a second approval', async () => {
  const a = await actor(),
    j = await job(a),
    current = await reach(a, j.id, 'AWAITING_PROMOTION')
  const key = randomUUID(),
    body = {
      schemaVersion: 1,
      snapshotId: current.candidateSnapshotId,
      verificationDigest: (current.review as { verificationDigest: string }).verificationDigest,
      stateVersion: current.stateVersion,
      expectedProjectRevision: 1,
    }
  const first = await service.promote(a.token, j.id, a.csrf, key, body)
  expect(await service.promote(a.token, j.id, a.csrf, key, body)).toEqual(first)
  await expect(
    service.promote(a.token, j.id, a.csrf, key, { ...body, verificationDigest: '0'.repeat(64) })
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  expect(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM forge_control.approvals WHERE job_id=$1 AND kind='promotion'",
        [j.id]
      )
    ).rows[0].n
  ).toBe(1)
})
it('returns a structured 410 for an expired SSE cursor with the current state URL', async () => {
  const a = await actor(),
    j = await job(a)
  await worker.runOnce()
  await db.admin.query('UPDATE forge_control.jobs SET earliest_event_seq=3 WHERE id=$1', [j.id])
  const response = await request(a, `/api/v1/jobs/${j.id}/events`, 'GET', undefined, {
    'Last-Event-ID': `${j.id}:1`,
  })
  expect(response.status).toBe(410)
  expect((await response.json()).error.details).toEqual({
    earliestSeq: 3,
    stateUrl: `/api/v1/jobs/${j.id}`,
    replayRequired: true,
  })
})
it('serializes policy revocation with approval and fences dispatch after a durable shutdown', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await db.admin.query(
    "INSERT INTO forge_control.revoked_policies(digest,reason) SELECT policy_digest,'synthetic revocation test' FROM forge_control.jobs WHERE id=$1",
    [j.id]
  )
  await expect(approve(a, j.id)).rejects.toMatchObject({ code: 'STALE_APPROVAL' })
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('FAILED')
  const b = await actor(),
    p = await project(b)
  await db.admin.query('UPDATE forge_control.control_settings SET admission_enabled=false')
  await expect(service.admit(b.token, p, b.csrf, randomUUID(), jobBody)).rejects.toMatchObject({
    code: 'P0503',
  })
  await db.admin.query('UPDATE forge_control.control_settings SET admission_enabled=true')
  const admitted = await service.admit(b.token, p, b.csrf, randomUUID(), {
      ...jobBody,
      maxCostMicros: 0,
    }),
    k = { id: (admitted.body.job as { id: string }).id },
    lease = await worker.claim()
  await db.admin.query('UPDATE forge_control.control_settings SET security_shutdown=true')
  await expect(worker.complete(lease!, null)).rejects.toMatchObject({ code: 'DISPATCH_FENCED' })
  expect(await worker.claim()).toBeNull()
  await reconciler.runOnce()
  expect((await state(b, k.id)).state).toBe('FAILED')
})
it('claims each step once across workers and extends only the current heartbeat', async () => {
  const a = await actor()
  await job(a)
  const other = new ControlWorker(db.worker, new FixtureStageAdapter())
  const claims = await Promise.all([worker.claim(), other.claim()])
  expect(claims.filter(Boolean)).toHaveLength(1)
  const index = claims.findIndex(Boolean),
    lease = claims[index]!,
    owner = index === 0 ? worker : other
  await owner.heartbeat(lease)
  const current = (
    await db.admin.query('SELECT lease_expires_at FROM forge_control.job_steps WHERE id=$1', [
      lease.id,
    ])
  ).rows[0]
  expect(current.lease_expires_at.getTime()).toBeGreaterThanOrEqual(
    lease.lease_expires_at.getTime()
  )
  await expect((index === 0 ? other : worker).heartbeat(lease)).rejects.toMatchObject({
    code: 'LEASE_LOST',
  })
})
it('ignores a late duplicate cleanup confirmation after a replacement worker claims', async () => {
  const a = await actor(),
    j = await job(a),
    lease = await worker.claim()
  await db.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [lease!.id]
  )
  let entered!: () => void, confirm!: () => void
  const atCleanup = new Promise<void>((r) => {
      entered = r
    }),
    gate = new Promise<void>((r) => {
      confirm = r
    })
  const slow = new ControlReconciler(db.maintenance, {
    origin: 'fixture',
    confirm: async () => {
      entered()
      await gate
      return true
    },
  })
  const pending = slow.runOnce()
  await atCleanup
  await reconciler.runOnce()
  const replacement = new ControlWorker(db.worker, new FixtureStageAdapter()),
    next = await replacement.claim()
  confirm()
  await pending
  await replacement.complete(next!, null)
  expect((await state(a, j.id)).state).toBe('PLANNING')
})
it('tombstones a deleted project, fences its active job and retains source/audit history', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL')
  const key = randomUUID(),
    result = await service.deleteProject(a.token, j.projectId, a.csrf, key, 1)
  expect(await service.deleteProject(a.token, j.projectId, a.csrf, key, 1)).toEqual(result)
  await expect(service.getProject(a.token, j.projectId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('CANCELLED')
  expect(
    (
      await db.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.snapshots WHERE project_id=$1',
        [j.projectId]
      )
    ).rows[0].n
  ).toBe(1)
})
it('rejects excessive request bodies, duplicate session cookies and unsupported project stacks', async () => {
  const a = await actor(),
    path = `/api/v1/workspaces/${a.workspace}/projects`
  expect(
    (await request(a, path, 'POST', { ...projectBody, brief: 'x'.repeat(70000) })).status
  ).toBe(413)
  expect(
    (await request(a, '/api/v1/session', 'GET', undefined, { Cookie: `${a.cookie}; ${a.cookie}` }))
      .status
  ).toBe(400)
  expect(
    (await request(a, path, 'POST', { ...projectBody, templateId: 'vite-react' })).status
  ).toBe(422)
})

it('bounds global queue, pending reviews and simulated preview capacity', async () => {
  const a = await actor(),
    j = await job(a),
    p = await project(a)
  await db.admin.query(
    'UPDATE forge_control.control_settings SET max_queued=1,max_pending_reviews=1'
  )
  await expect(service.admit(a.token, p, a.csrf, randomUUID(), jobBody)).rejects.toMatchObject({
    code: 'P0429',
  })
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  const next = await job(a, p)
  await reach(a, next.id, 'PLANNING')
  await worker.runOnce()
  await reconciler.runOnce()
  expect((await state(a, next.id)).state).toBe('FAILED')
  await db.admin.query(
    'UPDATE forge_control.control_settings SET max_pending_reviews=5,max_previews=0'
  )
  await reach(a, j.id, 'PREPARING_PREVIEW')
  await worker.runOnce()
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('FAILED')
  expect(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM forge_control.environments WHERE kind='preview' AND state<>'destroyed'"
      )
    ).rows[0].n
  ).toBe(0)
})
it('times out an uncooperative fixture adapter and retains its uncertain liability', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'PLANNING')
  const stuck = new ControlWorker(
    db.worker,
    { origin: 'fixture', run: () => new Promise(() => {}) },
    { attemptTimeoutMs: 20 }
  )
  await stuck.runOnce()
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('FAILED')
  expect(
    (
      await db.admin.query(
        'SELECT status,released_micros FROM forge_control.usage_reservations WHERE job_id=$1',
        [j.id]
      )
    ).rows[0]
  ).toMatchObject({ status: 'uncertain', released_micros: '9' })
})
it('enforces additive origin, liability, review immutability and runtime privilege constraints', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await expect(
    db.admin.query("UPDATE forge_control.projects SET origin='live' WHERE id=$1", [j.projectId])
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    db.admin.query(
      'UPDATE forge_control.usage_reservations SET released_micros=reserved_micros+1 WHERE job_id=$1',
      [j.id]
    )
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    db.admin.query('DELETE FROM forge_control.job_reviews WHERE job_id=$1', [j.id])
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    db.admin.query(
      'UPDATE forge_control.provider_attempts SET amount_micros=maximum_micros+1 WHERE job_id=$1',
      [j.id]
    )
  ).rejects.toMatchObject({ code: '23514' })
  await expect(db.api.tx((c) => c.query('SELECT * FROM maintenance_jobs()'))).rejects.toMatchObject(
    { code: '42501' }
  )
  await expect(
    db.api.tx((c) => c.query('UPDATE control_settings SET security_shutdown=false'))
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    db.worker.tx((c) => c.query('SELECT * FROM authorize_session($1)', [sha256(a.token)]))
  ).rejects.toMatchObject({ code: '42501' })
})
it.each([
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'VALIDATING',
  'PROVISIONING',
  'VERIFYING',
  'PREPARING_PREVIEW',
  'AWAITING_PROMOTION',
])('cancels %s without promoting source or allowing further dispatch', async (target) => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, target)
  await service.cancel(a.token, j.id, a.csrf, randomUUID())
  await reconciler.runOnce()
  expect((await state(a, j.id)).state).toBe('CANCELLED')
  expect((await service.getProject(a.token, j.projectId)).project.headSnapshotId).toBeNull()
  expect(await worker.runOnce()).toBe(false)
  expect(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM forge_control.environments WHERE job_id=$1 AND state<>'destroyed'",
        [j.id]
      )
    ).rows[0].n
  ).toBe(0)
})

it('logout revokes stored fixture preview credentials across the user’s workspaces', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PROMOTION')
  const tokenHash = sha256(randomUUID())
  await db.admin.query(
    "INSERT INTO forge_control.preview_tickets(token_hash,workspace_id,project_id,preview_id,user_id,purpose,expires_at) SELECT $1,workspace_id,project_id,id,$2,'session',now()+interval '10 minutes' FROM forge_control.previews WHERE project_id=$3",
    [tokenHash, a.id, j.projectId]
  )
  await sessions.logout(a.token, a.csrf)
  expect(
    (
      await db.admin.query(
        'SELECT revoked_at FROM forge_control.preview_tickets WHERE token_hash=$1',
        [tokenHash]
      )
    ).rows[0].revoked_at
  ).toBeInstanceOf(Date)
})

it('replays a restore admission after its promotion changed the current head', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PROMOTION')
  await approve(a, j.id)
  const snapshot = (await service.getProject(a.token, j.projectId)).project.headSnapshotId!,
    key = randomUUID()
  const body = {
    schemaVersion: 1,
    expectedProjectRevision: 2,
    maxCostMicros: 0,
    resetPreviewDataAcknowledged: true,
  }
  const first = await service.restore(a.token, snapshot, a.csrf, key, body),
    restored = (first.body.job as { id: string }).id
  await reach(a, restored, 'AWAITING_PROMOTION')
  await approve(a, restored)
  expect(await service.restore(a.token, snapshot, a.csrf, key, body)).toEqual(first)
})

it('flushes terminal events while a live SSE connection is polling', async () => {
  const a = await actor(),
    j = await job(a),
    stream = await request(a, `/api/v1/jobs/${j.id}/events`),
    reader = stream.body!.getReader()
  await readStream(reader, (t) => t.includes('event: job.state'))
  await service.cancel(a.token, j.id, a.csrf, randomUUID())
  await reconciler.runOnce()
  const text = await readStream(reader, (_t, done) => done)
  expect(text).toContain('event: job.terminal')
})

it('revokes a completed job’s fake preview before cleanup and retries a partitioned teardown', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PROMOTION')
  await approve(a, j.id)
  await db.admin.query(
    "INSERT INTO forge_control.revoked_policies(digest,reason) SELECT policy_digest,'synthetic completed-preview test' FROM forge_control.jobs WHERE id=$1",
    [j.id]
  )
  await new ControlReconciler(db.maintenance, new FixtureCleanupAdapter(false)).runOnce()
  expect(
    (
      await db.admin.query('SELECT state FROM forge_control.previews WHERE project_id=$1', [
        j.projectId,
      ])
    ).rows[0].state
  ).toBe('STOPPING')
  await reconciler.runOnce()
  expect(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM forge_control.environments WHERE job_id=$1 AND state<>'destroyed'",
        [j.id]
      )
    ).rows[0].n
  ).toBe(0)
  expect((await state(a, j.id)).state).toBe('SUCCEEDED')
})
