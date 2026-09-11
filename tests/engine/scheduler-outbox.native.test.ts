import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { startNativePostgres } from './native-postgres.ts'
import { ControlService } from '../../engine/control/service.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import type { Tx } from '../../engine/control/database.ts'
import { changeState } from '../../engine/control/state.ts'
import { enqueueDispatch, PostgresSchedulerOutbox } from '../../engine/scheduling/outbox.ts'
import type { StepClaim } from '../../engine/scheduling/outbox.ts'
import type { Dispatch, StepCommand, StepResult } from '../../engine/scheduling/protocol.ts'
import { deliverOutboxIntent } from '../../engine/scheduling/outbox-delivery.ts'

// Real disposable PostgreSQL, synthetic identities/jobs/allowances, no network or
// generated-code execution. 0008 is tested independently; 0007 is owner-reserved.
let db: Awaited<ReturnType<typeof startNativePostgres>>
let service: ControlService<{ checkCsrf(hash: string, token: string): void }>
let outbox: PostgresSchedulerOutbox
const reserveDelivery = vi.fn(async () => {}) // EXPLICIT allowance fixture only.
beforeAll(async () => {
  db = await startNativePostgres()
  for (const path of [
    'drizzle/0001_initial.sql',
    'drizzle/0002_runtime_version.sql',
    'drizzle/0003_unified.sql',
    'drizzle/0005_public_auth.sql',
    'engine/migrations/0003_immutable_source_bridge.sql',
    'engine/migrations/0004_hosted_identity.sql',
  ])
    await db.admin.query(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))
  await db.admin.query(
    await readFile(
      new URL('../../engine/migrations/0008_scheduler_outbox.sql', import.meta.url),
      'utf8'
    )
  )
  service = new ControlService(
    db.api,
    {
      checkCsrf(hash, token) {
        if (hash !== sha256(token)) throw new Error('CSRF')
      },
    },
    true
  )
  outbox = new PostgresSchedulerOutbox(db.worker, { reserveDelivery })
}, 30000)
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  await db.admin.query(`DO $$ DECLARE names text; BEGIN
    SELECT string_agg(format('forge_control.%I',tablename),',') INTO names FROM pg_tables
    WHERE schemaname='forge_control' AND tablename NOT IN('schema_migrations','control_settings');
    EXECUTE 'TRUNCATE TABLE '||names||' CASCADE'; END $$`)
  await db.admin.query(
    'UPDATE forge_control.control_settings SET admission_enabled=true,worker_enabled=true,security_shutdown=false,max_running=10'
  )
  reserveDelivery.mockClear()
})
async function fixture() {
  const user = randomUUID(),
    workspace = randomUUID(),
    token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url')
  await db.admin.query(
    "INSERT INTO forge_control.users(id,oidc_issuer,oidc_subject) VALUES($1::uuid,'synthetic-outbox',$1::text)",
    [user]
  )
  await db.admin.query(
    "INSERT INTO forge_control.workspaces(id,name) VALUES($1,'Synthetic scheduler workspace')",
    [workspace]
  )
  await db.admin.query(
    "INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [workspace, user]
  )
  await db.admin.query(
    "INSERT INTO forge_control.sessions(id_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [sha256(token), user, sha256(csrf)]
  )
  await db.admin.query(
    "INSERT INTO forge_control.workspace_quotas(workspace_id,period_start,limit_micros,max_active_jobs,max_previews) VALUES($1,date_trunc('day',now()),1000,10,2)",
    [workspace]
  )
  const p = await service.createProject(token, workspace, csrf, randomUUID(), {
    schemaVersion: 1,
    name: 'Synthetic dispatch project',
    brief: 'A synthetic app to exercise durable dispatch.',
    presetId: 'editorial-product',
    presetVersion: 1,
    templateId: 'next-postgres-v1',
  })
  const project = (p.body.project as { id: string }).id
  const result = await service.admit(token, project, csrf, randomUUID(), {
    schemaVersion: 1,
    kind: 'generate',
    baseSnapshotId: null,
    baseRevision: 1,
    instruction: 'A synthetic app to exercise durable dispatch.',
    modelPolicyId: 'fixture-v1',
    maxCostMicros: 10,
  })
  const job = (result.body.job as { id: string }).id
  const dispatch: Dispatch = {
    schemaVersion: 1,
    dispatchId: randomUUID(),
    workspaceId: workspace,
    jobId: job,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  }
  const enqueue = (d = dispatch) =>
    db.api.session(token, workspace, 'editor', (c, p) => enqueueDispatch(c, p, job, d))
  return {
    user,
    workspace,
    token,
    csrf,
    project,
    job,
    dispatch,
    enqueue,
    command: { ...dispatch, sequence: 0 } satisfies StepCommand,
  }
}
async function admitted() {
  const a = await fixture()
  await a.enqueue()
  return a
}
const finish = async (c: Tx, _j: unknown, s: StepClaim['step']) => {
  await c.query(
    "UPDATE job_steps SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,finished_at=clock_timestamp() WHERE id=$1",
    [s.id]
  )
}
const continuation: StepResult = { schemaVersion: 1, state: 'continue', retryAfterSeconds: 5 }
async function claim(command: StepCommand) {
  const b = await outbox.begin(command)
  if (b.kind !== 'claimed') throw new Error('Expected synthetic step claim')
  return b.claim
}
it('enforces tenant RLS and restricts runtime mutation privileges', async () => {
  const a = await admitted()
  const { rows } = await db.admin.query(
    "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN('scheduler_dispatches','scheduler_step_receipts','scheduler_delivery_receipts')"
  )
  expect(rows).toHaveLength(3)
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true)
  await expect(
    db.api.session(a.token, a.workspace, 'editor', (c) =>
      c.query('UPDATE scheduler_dispatches SET expires_at=clock_timestamp() WHERE id=$1', [
        a.dispatch.dispatchId,
      ])
    )
  ).rejects.toThrow()
})
it('inserts immutable metadata in the caller transaction and rolls back atomically', async () => {
  const a = await fixture()
  await expect(
    db.api.session(a.token, a.workspace, 'editor', async (c, p) => {
      await enqueueDispatch(c, p, a.job, a.dispatch)
      throw new Error('synthetic admission rollback')
    })
  ).rejects.toThrow('synthetic admission rollback')
  expect(
    (await db.admin.query('SELECT count(*)::int AS n FROM forge_control.scheduler_dispatches'))
      .rows[0].n
  ).toBe(0)
  expect(await a.enqueue()).toEqual(a.dispatch)
  await expect(
    db.worker.scoped(a.workspace, (c) =>
      c.query('UPDATE scheduler_dispatches SET job_id=$2 WHERE id=$1', [
        a.dispatch.dispatchId,
        randomUUID(),
      ])
    )
  ).rejects.toThrow()
})
it('deduplicates concurrent exact intents and rejects metadata or replacement-id conflicts', async () => {
  const a = await fixture()
  expect(await Promise.all([a.enqueue(), a.enqueue()])).toEqual([a.dispatch, a.dispatch])
  await expect(
    a.enqueue({ ...a.dispatch, expiresAt: new Date(Date.now() + 100000).toISOString() })
  ).rejects.toThrow('CONFLICT')
  await expect(a.enqueue({ ...a.dispatch, dispatchId: randomUUID() })).rejects.toThrow()
})
it('rejects another tenant, forged actor and out-of-scope reads', async () => {
  const a = await admitted(),
    b = await fixture()
  await expect(
    db.api.session(b.token, b.workspace, 'editor', (c, p) =>
      enqueueDispatch(c, p, a.job, a.dispatch)
    )
  ).rejects.toThrow()
  await expect(
    db.api.session(a.token, a.workspace, 'editor', (c, p) =>
      enqueueDispatch(c, { ...p, user_id: b.user }, a.job, {
        ...a.dispatch,
        dispatchId: randomUUID(),
      })
    )
  ).rejects.toThrow('FENCED')
  await expect(outbox.begin({ ...a.command, workspaceId: b.workspace })).rejects.toThrow()
  expect(
    (await db.worker.scoped(b.workspace, (c) => c.query('SELECT id FROM scheduler_dispatches')))
      .rows
  ).toEqual([])
})
it('fails closed without a verified allowance gate', async () => {
  const a = await admitted()
  await expect(new PostgresSchedulerOutbox(db.worker).claimDelivery(a.dispatch)).rejects.toThrow(
    'CAPACITY_UNVERIFIED'
  )
  expect(reserveDelivery).not.toHaveBeenCalled()
})
it('claims one delivery under concurrency and records immutable acknowledgements', async () => {
  const a = await admitted()
  const attempts = await Promise.all([
    outbox.claimDelivery(a.dispatch),
    outbox.claimDelivery(a.dispatch),
  ])
  const claimed = attempts.find((v) => v !== null)!
  expect(attempts.filter(Boolean)).toHaveLength(1)
  expect(reserveDelivery).toHaveBeenCalledTimes(1)
  await outbox.recordDelivery(claimed, 'acknowledged')
  await outbox.recordDelivery(claimed, 'acknowledged')
  expect(await outbox.claimDelivery(a.dispatch)).toBeNull()
  await expect(outbox.recordDelivery(claimed, 'unknown')).rejects.toThrow('CONFLICT')
})
it('rolls back a claim when capacity reservation fails', async () => {
  const a = await admitted()
  const blocked = new PostgresSchedulerOutbox(db.worker, {
    reserveDelivery: async () => {
      throw new Error('no verified free capacity')
    },
  })
  await expect(blocked.claimDelivery(a.dispatch)).rejects.toThrow('no verified free capacity')
  expect(
    (await db.admin.query('SELECT delivery_epoch FROM forge_control.scheduler_dispatches')).rows[0]
      .delivery_epoch
  ).toBe(0)
})
it('retains uncertain delivery on restart, fences stale results and caps same-ID retries', async () => {
  const a = await admitted()
  const first = (await outbox.claimDelivery(a.dispatch))!
  await db.admin.query(
    "UPDATE forge_control.scheduler_dispatches SET delivery_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [a.dispatch.dispatchId]
  )
  const restarted = new PostgresSchedulerOutbox(db.worker, { reserveDelivery })
  const second = (await restarted.claimDelivery(a.dispatch))!
  expect(second.dispatch).toEqual(first.dispatch)
  expect(second.epoch).toBe(2)
  await expect(outbox.recordDelivery(first, 'acknowledged')).rejects.toThrow('CONFLICT')
  await restarted.recordDelivery(second, 'unknown')
  const third = (await restarted.claimDelivery(a.dispatch))!
  await restarted.recordDelivery(third, 'unknown')
  expect(await restarted.claimDelivery(a.dispatch)).toBeNull()
  expect(
    (
      await db.admin.query(
        'SELECT outcome FROM forge_control.scheduler_delivery_receipts ORDER BY epoch'
      )
    ).rows.map((r) => r.outcome)
  ).toEqual(['unknown', 'unknown', 'unknown'])
})
it.each(['session', 'account', 'membership', 'shutdown', 'policy'])(
  'rechecks %s revocation before dispatch or step execution',
  async (kind) => {
    const a = await admitted()
    if (kind === 'session')
      await db.admin.query(
        'UPDATE forge_control.sessions SET revoked_at=clock_timestamp() WHERE id_hash=$1',
        [sha256(a.token)]
      )
    if (kind === 'account')
      await db.admin.query(
        'UPDATE forge_control.users SET disabled_at=clock_timestamp() WHERE id=$1',
        [a.user]
      )
    if (kind === 'membership')
      await db.admin.query("UPDATE forge_control.memberships SET role='viewer' WHERE user_id=$1", [
        a.user,
      ])
    if (kind === 'shutdown')
      await db.admin.query('UPDATE forge_control.control_settings SET security_shutdown=true')
    if (kind === 'policy')
      await db.admin.query(
        "INSERT INTO forge_control.revoked_policies(digest,reason) SELECT policy_digest,'synthetic test' FROM forge_control.jobs WHERE id=$1",
        [a.job]
      )
    await expect(outbox.claimDelivery(a.dispatch)).rejects.toThrow()
    await expect(outbox.begin(a.command)).rejects.toThrow()
  }
)
it('claims only the admitted job once, never a global arbitrary queued job', async () => {
  const a = await admitted(),
    b = await admitted()
  const results = await Promise.all([outbox.begin(b.command), outbox.begin(b.command)])
  expect(results.map((r) => r.kind).sort()).toEqual(['claimed', 'unresolved'])
  const selected = results.find((r) => r.kind === 'claimed')!
  if (selected.kind === 'claimed') expect(selected.claim.step.job_id).toBe(b.job)
  expect(
    (await db.admin.query('SELECT status FROM forge_control.job_steps WHERE job_id=$1', [a.job]))
      .rows[0].status
  ).toBe('queued')
})
it('enforces one global active claim across different tenants under concurrent admission', async () => {
  const a = await admitted(),
    b = await admitted()
  const results = await Promise.all([outbox.begin(a.command), outbox.begin(b.command)])
  expect(results.map((r) => r.kind).sort()).toEqual(['busy', 'claimed'])
})
it('rejects out-of-order or changed job commands', async () => {
  const a = await admitted()
  await expect(outbox.begin({ ...a.command, sequence: 1 })).rejects.toThrow('CONFLICT')
  await expect(outbox.begin({ ...a.command, jobId: randomUUID() })).rejects.toThrow('CONFLICT')
})
it('does not repeat a started step after worker restart or expired lease', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  await db.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [c.step.id]
  )
  expect(await new PostgresSchedulerOutbox(db.worker).begin(a.command)).toEqual({
    kind: 'unresolved',
  })
  await expect(outbox.settle(a.command, c, continuation, finish)).rejects.toThrow()
  expect(
    (await db.admin.query('SELECT count(*)::int AS n FROM forge_control.scheduler_step_receipts'))
      .rows[0].n
  ).toBe(1)
})
it('commits stage changes and outcome atomically and replays without invoking the stage twice', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  const failing = vi.fn(async (tx: Tx, j: unknown, s: StepClaim['step']) => {
    await finish(tx, j, s)
    throw new Error('synthetic crash before commit')
  })
  await expect(outbox.settle(a.command, c, continuation, failing)).rejects.toThrow(
    'synthetic crash'
  )
  expect(
    (await db.admin.query('SELECT status FROM forge_control.job_steps WHERE id=$1', [c.step.id]))
      .rows[0].status
  ).toBe('running')
  const applying = vi.fn(finish)
  expect(await outbox.settle(a.command, c, continuation, applying)).toEqual(continuation)
  expect(await outbox.settle(a.command, c, continuation, applying)).toEqual(continuation)
  expect(applying).toHaveBeenCalledTimes(1)
  expect(await outbox.begin(a.command)).toEqual({ kind: 'replay', result: continuation })
  await expect(
    outbox.settle(
      a.command,
      c,
      { schemaVersion: 1, state: 'blocked', retryAfterSeconds: 0 },
      applying
    )
  ).rejects.toThrow('CONFLICT')
})
it('requires completed E1 lease state before committing a scheduler outcome', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  await expect(outbox.settle(a.command, c, continuation, async () => {})).rejects.toThrow()
  expect(
    (await db.admin.query('SELECT status FROM forge_control.scheduler_step_receipts')).rows[0]
      .status
  ).toBe('started')
})
it('allows transport evidence after workflow completion but never another effect', async () => {
  const a = await admitted(),
    delivery = (await outbox.claimDelivery(a.dispatch))!,
    c = await claim(a.command)
  const result: StepResult = { schemaVersion: 1, state: 'blocked', retryAfterSeconds: 0 }
  await outbox.settle(a.command, c, result, async (tx, job, step) => {
    await finish(tx, job, step)
    await changeState(tx, job, 'FAILED', 'failure')
  })
  await outbox.recordDelivery(delivery, 'acknowledged')
  expect(await outbox.begin(a.command)).toEqual({ kind: 'replay', result })
  await expect(outbox.begin({ ...a.command, sequence: 1 })).rejects.toThrow('FENCED')
})
it('does not return a stored outcome after the original session is revoked', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  await outbox.settle(a.command, c, continuation, finish)
  await db.admin.query(
    'UPDATE forge_control.sessions SET revoked_at=clock_timestamp() WHERE id_hash=$1',
    [sha256(a.token)]
  )
  await expect(outbox.begin(a.command)).rejects.toThrow()
})
it('fences cancellation before outcome promotion and preserves the unresolved receipt', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  await service.cancel(a.token, a.job, a.csrf, randomUUID())
  const applying = vi.fn(finish)
  await expect(outbox.settle(a.command, c, continuation, applying)).rejects.toThrow('FENCED')
  expect(applying).not.toHaveBeenCalled()
})
it('rejects result payloads with missing keys or embedded source/secrets at the database boundary', async () => {
  const a = await admitted()
  await claim(a.command)
  for (const result of [
    { schemaVersion: 1 },
    { ...continuation, source: 'untrusted payload' },
    { ...continuation, retryAfterSeconds: 5.5 },
  ])
    await expect(
      db.worker.scoped(a.workspace, (c) =>
        c.query(
          "UPDATE scheduler_step_receipts SET status='settled',result_json=$1,settled_at=clock_timestamp()",
          [result]
        )
      )
    ).rejects.toThrow()
})
it.each(['logout', 'disabled', 'unverified', 'enrollment'])(
  'revalidates exact Better Auth parent after %s',
  async (kind) => {
    const a = await fixture(),
      parent = randomUUID(),
      authUser = randomUUID()
    await db.admin.query(
      "INSERT INTO public.forge_user(id,name,email,email_verified) VALUES($1,'Synthetic parent',$2,true)",
      [authUser, `${authUser}@example.invalid`]
    )
    await db.admin.query(
      "INSERT INTO public.forge_session(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour'),($4,$2,$5,now()+interval '1 hour')",
      [parent, authUser, randomUUID(), randomUUID(), randomUUID()]
    )
    await db.admin.query(
      "INSERT INTO forge_control.hosted_identity_settings(issuer,enabled) VALUES('https://forge.example.com/api/auth',true)"
    )
    await db.admin.query(
      'INSERT INTO forge_control.hosted_identities(user_id,auth_user_id,workspace_id) VALUES($1,$2,$3)',
      [a.user, authUser, a.workspace]
    )
    await db.admin.query(
      'INSERT INTO forge_control.hosted_sessions(session_hash,auth_session_id,user_id) VALUES($1,$2,$3)',
      [sha256(a.token), parent, a.user]
    )
    await a.enqueue()
    if (kind === 'logout')
      await db.admin.query('DELETE FROM public.forge_session WHERE id=$1', [parent])
    if (kind === 'disabled')
      await db.admin.query(
        'UPDATE public.forge_user SET disabled_at=clock_timestamp() WHERE id=$1',
        [authUser]
      )
    if (kind === 'unverified')
      await db.admin.query('UPDATE public.forge_user SET email_verified=false WHERE id=$1', [
        authUser,
      ])
    if (kind === 'enrollment')
      await db.admin.query('UPDATE forge_control.hosted_identity_settings SET enabled=false')
    await expect(outbox.begin(a.command)).rejects.toThrow()
    await expect(outbox.claimDelivery(a.dispatch)).rejects.toThrow()
  }
)
it('discovers stranded intents without releasing leases, quotas or uncertainty', async () => {
  const a = await admitted(),
    b = await admitted()
  const pending = await claim(a.command)
  await db.admin.query(
    "UPDATE forge_control.job_steps SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [pending.step.id]
  )
  const rows = await db.maintenance.tx((c) =>
    c.query('SELECT * FROM scheduler_reconciliation_candidates(25)')
  )
  expect(new Set(rows.rows.map((r) => r.dispatch_id))).toEqual(
    new Set([a.dispatch.dispatchId, b.dispatch.dispatchId])
  )
  expect(Object.keys(rows.rows[0]).sort()).toEqual([
    'dispatch_id',
    'expires_at',
    'job_id',
    'workspace_id',
  ])
  await expect(
    db.api.session(a.token, a.workspace, 'editor', (c) =>
      c.query('SELECT * FROM scheduler_reconciliation_candidates(25)')
    )
  ).rejects.toThrow()
  await expect(
    db.maintenance.tx((c) => c.query('SELECT * FROM scheduler_reconciliation_candidates(26)'))
  ).rejects.toThrow()
  expect(
    (await db.admin.query('SELECT status FROM forge_control.scheduler_step_receipts')).rows[0]
      .status
  ).toBe('started')
})
it('delivers outside transactions with exact metadata and persists its acknowledgement', async () => {
  const a = await admitted()
  const config = {
    enabled: true,
    schedulerOrigin: 'https://scheduler.example.com',
    triggerSecret: '33'.repeat(32),
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const req = input as Request
    expect(await req.clone().json()).toEqual(a.dispatch)
    // A separate connection can lock the intent while the transport is in flight.
    await db.worker.scoped(a.workspace, (c) =>
      c.query('SELECT id FROM scheduler_dispatches WHERE id=$1 FOR UPDATE NOWAIT', [
        a.dispatch.dispatchId,
      ])
    )
    return Response.json({ schemaVersion: 1, dispatchId: a.dispatch.dispatchId }, { status: 202 })
  })
  expect(await deliverOutboxIntent(outbox, a.dispatch, config, { fetch })).toBe('recorded')
  expect(await deliverOutboxIntent(outbox, a.dispatch, config, { fetch })).toBe('idle')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not call HTTP when disabled or retry after acknowledgement persistence fails', async () => {
  const a = await admitted(),
    fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ schemaVersion: 1, dispatchId: a.dispatch.dispatchId }, { status: 202 })
    )
  const config = {
    enabled: false,
    schedulerOrigin: 'https://scheduler.example.com',
    triggerSecret: '33'.repeat(32),
  }
  expect(await deliverOutboxIntent(outbox, a.dispatch, config, { fetch })).toBe('disabled')
  expect(fetch).not.toHaveBeenCalled()
  const failing = new PostgresSchedulerOutbox(db.worker, { reserveDelivery })
  vi.spyOn(failing, 'recordDelivery').mockRejectedValue(new Error('synthetic database disconnect'))
  expect(
    await deliverOutboxIntent(failing, a.dispatch, { ...config, enabled: true }, { fetch })
  ).toBe('unresolved')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(
    (await db.admin.query('SELECT delivery_status FROM forge_control.scheduler_dispatches')).rows[0]
      .delivery_status
  ).toBe('claimed')
})
it('serializes cancellation racing atomic stage completion without promoting cancelled work', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  const [settled, cancelled] = await Promise.allSettled([
    outbox.settle(a.command, c, continuation, finish),
    service.cancel(a.token, a.job, a.csrf, randomUUID()),
  ])
  expect(cancelled.status).toBe('fulfilled')
  const row = (
    await db.admin.query(
      `SELECT r.status AS receipt,s.status AS step,j.cancel_requested_at
    FROM forge_control.scheduler_step_receipts r JOIN forge_control.job_steps s ON s.id=r.step_id
    JOIN forge_control.jobs j ON j.id=r.job_id WHERE r.dispatch_id=$1`,
      [a.dispatch.dispatchId]
    )
  ).rows[0]
  expect(row.cancel_requested_at).not.toBeNull()
  if (settled.status === 'fulfilled')
    expect([row.receipt, row.step]).toEqual(['settled', 'succeeded'])
  else expect([row.receipt, row.step]).toEqual(['started', 'cancelled'])
  await expect(outbox.begin({ ...a.command, sequence: 1 })).rejects.toThrow()
})
it('does not let a scheduler hint invent successful or approved E1 state', async () => {
  const a = await admitted(),
    c = await claim(a.command)
  for (const state of ['complete', 'awaiting-approval', 'cancelled', 'blocked'] as const)
    await expect(
      outbox.settle(a.command, c, { schemaVersion: 1, state, retryAfterSeconds: 0 }, finish)
    ).rejects.toThrow('CONFLICT')
  expect(
    (await db.admin.query('SELECT status FROM forge_control.scheduler_step_receipts')).rows[0]
      .status
  ).toBe('started')
})
