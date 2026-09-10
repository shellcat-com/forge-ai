import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { createPreviewHarness } from '../harness/preview.ts'
let h: Awaited<ReturnType<typeof createPreviewHarness>>
beforeAll(async () => {
  h = await createPreviewHarness()
}, 30_000)
afterAll(async () => {
  await h?.close()
})
beforeEach(async () => {
  await h.reset()
})
it('consumes one ticket atomically under 16 concurrent requests; stores only hashes', async () => {
  const p = await h.ready(),
    ticket = await p.issue()
  const results = await Promise.allSettled(
    Array.from({ length: 16 }, () => h.preview.consume(ticket.ticket, p.host))
  )
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const rows = (await h.db.admin.query('SELECT * FROM forge_control.preview_tickets')).rows
  expect(rows).toHaveLength(2)
  expect(JSON.stringify(rows)).not.toContain(ticket.ticket)
  const won = results.find((r) => r.status === 'fulfilled')!
  if (won.status !== 'fulfilled') throw new Error('missing winner')
  expect((await h.preview.authorize(won.value.token, p.host)).generation).toBe(p.route.generation)
})
it('rolls consumption back when session insertion fails, then permits exactly one retry', async () => {
  const p = await h.ready(),
    t = await p.issue()
  await expect(
    h.db.api.tx((c) =>
      c.query('SELECT consume_preview_ticket($1,$2,$1)', [sha256(t.ticket), p.host])
    )
  ).rejects.toThrow()
  expect((await h.preview.consume(t.ticket, p.host)).token).toHaveLength(43)
})
it('rejects foreign tenant, wrong CSRF, wrong hostname, expired and replayed tickets', async () => {
  const p = await h.ready(),
    foreign = await h.actor()
  await expect(h.preview.issue(foreign.token, foreign.csrf, p.route.id, p.host)).rejects.toThrow()
  await expect(h.preview.issue(p.actor.token, foreign.csrf, p.route.id, p.host)).rejects.toThrow()
  const t = await p.issue()
  await expect(h.preview.consume(t.ticket, 'p2.vercel.app')).rejects.toThrow()
  await h.db.admin.query(
    "UPDATE forge_control.preview_tickets SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE token_hash=$1",
    [sha256(t.ticket)]
  )
  await expect(h.preview.consume(t.ticket, p.host)).rejects.toThrow()
  const fresh = await p.issue()
  await h.preview.consume(fresh.ticket, p.host)
  await expect(h.preview.consume(fresh.ticket, p.host)).rejects.toThrow()
})
it('binds sessions to exact tenant/generation/host and rotates once on concurrent renewal', async () => {
  const p = await h.ready(),
    other = await h.ready('p2.vercel.app'),
    t = await p.issue(),
    s = await h.preview.consume(t.ticket, p.host)
  await expect(h.preview.authorize(s.token, other.host)).rejects.toThrow()
  const renewals = await Promise.allSettled([
    h.preview.renew(s.token, p.host),
    h.preview.renew(s.token, p.host),
  ])
  expect(renewals.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  await expect(h.preview.authorize(s.token, p.host)).rejects.toThrow()
  const won = renewals.find((r) => r.status === 'fulfilled')!
  if (won.status !== 'fulfilled') throw new Error('missing winner')
  expect(Date.parse(won.value.grant.sessionExpiresAt)).toBeLessThanOrEqual(
    Date.parse(won.value.grant.absoluteExpiresAt)
  )
  await h.db.admin.query(
    'UPDATE forge_control.environments SET lease_epoch=lease_epoch+1 WHERE id=$1',
    [p.route.environment_id]
  )
  await expect(h.preview.authorize(won.value.token, p.host)).rejects.toThrow()
})
it.each([
  'membership',
  'logout',
  'disabled-user',
  'disabled-workspace',
  'deletion',
  'unhealthy',
  'idle',
  'environment-expiry',
  'session-expiry',
  'revoked-route',
  'shutdown',
])('denies continued access after %s and revokes credentials during cleanup', async (kind) => {
  const p = await h.ready(),
    t = await p.issue(),
    s = await h.preview.consume(t.ticket, p.host)
  switch (kind) {
    case 'membership':
      await h.db.admin.query('DELETE FROM forge_control.memberships WHERE user_id=$1', [p.actor.id])
      break
    case 'logout':
      await h.db.api.tx((c) =>
        c.query('SELECT logout_session($1,$2)', [sha256(p.actor.token), sha256(p.actor.csrf)])
      )
      break
    case 'disabled-user':
      await h.db.admin.query('UPDATE forge_control.users SET disabled_at=now() WHERE id=$1', [
        p.actor.id,
      ])
      break
    case 'disabled-workspace':
      await h.db.admin.query('UPDATE forge_control.workspaces SET disabled_at=now() WHERE id=$1', [
        p.actor.workspace,
      ])
      break
    case 'deletion':
      await h.db.admin.query('UPDATE forge_control.projects SET deleting_at=now() WHERE id=$1', [
        p.job.projectId,
      ])
      break
    case 'unhealthy':
      await h.db.admin.query("UPDATE forge_control.environments SET state='failed' WHERE id=$1", [
        p.route.environment_id,
      ])
      break
    case 'idle':
      await h.db.admin.query(
        "UPDATE forge_control.previews SET idle_expires_at=now()-interval '1 second' WHERE id=$1",
        [p.route.id]
      )
      break
    case 'environment-expiry':
      await h.db.admin.query(
        "UPDATE forge_control.environments SET expires_at=now()-interval '1 second' WHERE id=$1",
        [p.route.environment_id]
      )
      break
    case 'session-expiry':
      await h.db.admin.query(
        "UPDATE forge_control.preview_tickets SET created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=$1",
        [sha256(s.token)]
      )
      break
    case 'revoked-route':
      await h.preview.revoke(p.actor.token, p.actor.csrf, p.route.id, p.host)
      break
    case 'shutdown':
      await h.db.admin.query('UPDATE forge_control.control_settings SET security_shutdown=true')
      break
  }
  await expect(h.preview.authorize(s.token, p.host)).rejects.toThrow()
  await expect(h.preview.renew(s.token, p.host)).rejects.toThrow()
  await h.db.maintenance.tx((c) => c.query('SELECT cleanup_preview_credentials()'))
  await h.db.admin.query('UPDATE forge_control.control_settings SET security_shutdown=false')
})
it('prevents API/worker cross-authority grants and permanent hostname reuse', async () => {
  const p = await h.ready()
  await expect(h.db.api.tx((c) => c.query('SELECT * FROM preview_routes'))).rejects.toThrow()
  await expect(
    h.db.worker.scoped(p.actor.workspace, (c) =>
      c.query('SELECT authorize_preview($1,$2,NULL)', ['a'.repeat(64), p.host])
    )
  ).rejects.toThrow()
  await expect(
    h.db.admin.query('UPDATE forge_control.preview_routes SET hostname=$1 WHERE preview_id=$2', [
      'reused.vercel.app',
      p.route.id,
    ])
  ).rejects.toThrow()
  await expect(
    h.db.admin.query('DELETE FROM forge_control.preview_routes WHERE preview_id=$1', [p.route.id])
  ).rejects.toThrow()
})
it.each(['logout', 'revoke', 'cancel'])(
  'serializes %s against consume and renew without deadlocks or usable orphan sessions',
  async (action) => {
    const p = await h.ready(),
      first = await p.issue(),
      existing = await h.preview.consume(first.ticket, p.host),
      pending = await p.issue()
    const revoke =
      action === 'logout'
        ? h.db.api.tx((c) =>
            c.query('SELECT logout_session($1,$2)', [sha256(p.actor.token), sha256(p.actor.csrf)])
          )
        : action === 'revoke'
          ? h.preview.revoke(p.actor.token, p.actor.csrf, p.route.id, p.host)
          : h.service.cancel(p.actor.token, p.job.id, p.actor.csrf, crypto.randomUUID())
    const results = await Promise.allSettled([
      revoke,
      h.preview.consume(pending.ticket, p.host),
      h.preview.renew(existing.token, p.host),
    ])
    expect(results[0].status).toBe('fulfilled')
    for (const result of results.slice(1)) {
      if (result.status === 'rejected')
        expect(['40P01', '55P03', '57014']).not.toContain(result.reason.code)
      else if (result.value && 'token' in result.value)
        await expect(h.preview.authorize(result.value.token, p.host)).rejects.toThrow()
    }
    await expect(h.preview.authorize(existing.token, p.host)).rejects.toThrow()
  }
)
it('renews different viewer sessions concurrently and returns the updated idle expiry', async () => {
  const p = await h.ready(),
    viewer = await h.actor('viewer')
  await h.db.admin.query(
    "INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'viewer')",
    [p.actor.workspace, viewer.id]
  )
  const a = await h.preview.consume((await p.issue()).ticket, p.host)
  const b = await h.preview.consume(
    (await h.preview.issue(viewer.token, viewer.csrf, p.route.id, p.host)).ticket,
    p.host
  )
  await h.db.admin.query(
    "UPDATE forge_control.previews SET idle_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1",
    [p.route.id]
  )
  const results = await Promise.all([
    h.preview.renew(a.token, p.host),
    h.preview.renew(b.token, p.host),
  ])
  for (const r of results)
    expect(Date.parse(r.grant.idleExpiresAt)).toBeGreaterThan(Date.now() + 14 * 60_000)
  await expect(h.preview.revoke(viewer.token, viewer.csrf, p.route.id, p.host)).rejects.toThrow()
})
it('rejects legacy unbound tickets, generation mismatch, foreign worker registration and PUBLIC privileges', async () => {
  const p = await h.ready(),
    t = await p.issue()
  await h.db.admin.query(
    'UPDATE forge_control.preview_tickets SET parent_session_hash=NULL WHERE token_hash=$1',
    [sha256(t.ticket)]
  )
  await expect(h.preview.consume(t.ticket, p.host)).rejects.toThrow()
  const fresh = await p.issue()
  await h.db.admin.query(
    'UPDATE forge_control.preview_tickets SET generation=$1 WHERE token_hash=$2',
    [crypto.randomUUID(), sha256(fresh.ticket)]
  )
  await expect(h.preview.consume(fresh.ticket, p.host)).rejects.toThrow()
  const foreign = await h.actor()
  await expect(
    h.db.worker.scoped(foreign.workspace, (c) =>
      c.query('SELECT register_preview_route($1,$2,$3,$4,$5,$6)', [
        p.route.id,
        'foreign.vercel.app',
        p.route.environment_id,
        p.route.generation,
        p.route.broker_operation_id,
        p.route.lease_epoch,
      ])
    )
  ).rejects.toThrow()
  const privileges = await h.db.admin.query(
    "SELECT has_function_privilege('public','forge_control.consume_preview_ticket(forge_control.sha256_hex,text,forge_control.sha256_hex)','EXECUTE') AS allowed"
  )
  expect(privileges.rows[0].allowed).toBe(false)
})
it('revocation schedules canonical resource teardown and cleanup preserves hostname tombstone', async () => {
  const { ControlReconciler, FixtureCleanupAdapter } =
    await import('../../engine/control/reconciler.ts')
  const p = await h.ready()
  await h.reach(p.actor, p.job.id, 'SUCCEEDED')
  await h.preview.revoke(p.actor.token, p.actor.csrf, p.route.id, p.host)
  const pending = await h.db.maintenance.tx((c) => c.query('SELECT * FROM maintenance_jobs()'))
  expect(pending.rows.some((r) => r.job_id === p.job.id)).toBe(true)
  // Explicitly simulated teardown; real destruction is Task 02 acceptance.
  await new ControlReconciler(h.db.maintenance, new FixtureCleanupAdapter()).runOnce()
  const state = await h.db.admin.query('SELECT state FROM forge_control.environments WHERE id=$1', [
    p.route.environment_id,
  ])
  expect(state.rows[0].state).toBe('destroyed')
  const routes = await h.db.admin.query(
    'SELECT revoked_at FROM forge_control.preview_routes WHERE preview_id=$1',
    [p.route.id]
  )
  expect(routes.rows[0].revoked_at).not.toBeNull()
})
it('late worker registration racing revocation never resurrects a revoked preview', async () => {
  const p = await h.ready('late.vercel.app', false)
  let inserted!: () => void, finish!: () => void
  const insertedSignal = new Promise<void>((resolve) => {
    inserted = resolve
  })
  const finishSignal = new Promise<void>((resolve) => {
    finish = resolve
  })
  const registration = h.db.worker.scoped(p.actor.workspace, async (c) => {
    await c.query('SELECT register_preview_route($1,$2,$3,$4,$5,$6)', [
      p.route.id,
      p.host,
      p.route.environment_id,
      p.route.generation,
      p.route.broker_operation_id,
      p.route.lease_epoch,
    ])
    inserted()
    await finishSignal
  })
  await insertedSignal
  let revoked = false
  const revocation = h.preview.revoke(p.actor.token, p.actor.csrf, p.route.id, p.host).then(() => {
    revoked = true
  })
  try {
    // FK key-share lock from registration forces revocation to serialize.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(revoked).toBe(false)
  } finally {
    finish()
  }
  await Promise.all([registration, revocation])
  await expect(p.issue()).rejects.toThrow()
  const pending = await h.db.maintenance.tx((c) => c.query('SELECT * FROM maintenance_jobs()'))
  expect(pending.rows.some((r) => r.job_id === p.job.id)).toBe(true)
  await h.db.maintenance.tx((c) => c.query('SELECT cleanup_preview_credentials()'))
  const route = await h.db.admin.query(
    'SELECT revoked_at FROM forge_control.preview_routes WHERE preview_id=$1',
    [p.route.id]
  )
  expect(route.rows[0].revoked_at).not.toBeNull()
})
