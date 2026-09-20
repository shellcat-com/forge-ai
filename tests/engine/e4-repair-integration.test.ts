/** Native PostgreSQL + real E1/E2 source/control integration. Provider products,
 * verification, provisioning, cleanup and previews remain explicit fixtures. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ControlWorker } from '../../engine/control/worker.ts'
import { ControlReconciler, FixtureCleanupAdapter } from '../../engine/control/reconciler.ts'
import type { StageAdapter, StageInput } from '../../engine/control/stage-adapter.ts'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
import { createE2ControlHarness } from '../harness/e2-control.ts'

type Harness = Awaited<ReturnType<typeof createE2ControlHarness>>
let h: Harness
beforeAll(async () => { h = await createE2ControlHarness() }, 30000)
afterAll(async () => { await h?.close() })
beforeEach(async () => { await h.reset() })

/** ONLY the verification failure is injected. CandidateStageAdapter generates
 * every plan/source/repair product, and ControlWorker owns every transition. */
function verificationFailures(count: number) {
  const calls: StageInput[] = []
  let failed = 0
  const adapter: StageAdapter = { origin: 'fixture', run: async (input, signal) => {
    calls.push(structuredClone(input))
    signal.throwIfAborted()
    if (input.stage === 'VERIFYING' && failed++ < count)
      return { schemaVersion: 1, origin: 'fixture', kind: 'repairable-error', diagnosticCode: 'FIXTURE_CHECK_FAILURE' }
    return h.adapter.run(input, signal)
  } }
  const worker = new ControlWorker(h.db.worker, adapter, {}, h.control, h.sources)
  return { adapter, worker, calls }
}
async function counters(jobId: string) {
  return (await h.db.admin.query<{ repair_count: number; provider_calls: number }>(
    'SELECT repair_count,provider_calls FROM forge_control.jobs WHERE id=$1', [jobId])).rows[0]
}
async function settleCleanup() {
  await new ControlReconciler(h.db.maintenance, new FixtureCleanupAdapter()).runOnce()
}

describe('bounded repair with native E1/E2 and explicitly fake execution', () => {
  it('requires changed repair bytes, a new diff and fresh execution approval before fixture success', async () => {
    const a = await h.actor(), j = await h.job(a), injected = verificationFailures(1)
    const originalReview = await h.reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL', injected.worker)
    const original = await h.service.changes(a.token, j.id)
    const oldPage = await h.service.file(a.token, original.snapshotId, 'app/page.tsx')
    await h.approve(a, j.id)
    await h.reach(a, j.id, 'REPAIRING', injected.worker)
    expect(await counters(j.id)).toEqual({ repair_count: 1, provider_calls: 2 })
    expect((await h.db.admin.query("SELECT count(*)::int AS n FROM forge_control.environments WHERE job_id=$1 AND state<>'destroyed'", [j.id])).rows[0].n).toBe(0)
    const newReview = await h.reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL', injected.worker)
    const repaired = await h.service.changes(a.token, j.id)
    const repairedPage = await h.service.file(a.token, repaired.snapshotId, 'app/page.tsx')
    expect(repairedPage.sha256).not.toBe(oldPage.sha256)
    expect(repaired.diff.sha256).not.toBe(original.diff.sha256)
    expect(repaired.diff.unified).toContain('Explicit fixture repair')
    expect(repaired.diff.unified).toContain(canonicalHash(original.manifest))
    expect(newReview.reviewDigest).not.toBe(originalReview.reviewDigest)
    expect(newReview.stateVersion).toBeGreaterThan(originalReview.stateVersion)
    expect(repaired.verification).toBeNull()
    expect(await counters(j.id)).toEqual({ repair_count: 1, provider_calls: 3 })
    const callsBefore = injected.calls.length
    await expect(h.service.approve(a.token, j.id, a.csrf, randomUUID(), {
      schemaVersion: 1, kind: 'execution', decision: 'approve', subjectDigest: originalReview.reviewDigest!, stateVersion: originalReview.stateVersion,
    })).rejects.toMatchObject({ code: 'STALE_APPROVAL' })
    expect(await injected.worker.runOnce()).toBe(false)
    expect(injected.calls).toHaveLength(callsBefore)
    expect((await h.state(a, j.id)).state).toBe('AWAITING_EXECUTION_APPROVAL')
    await h.approve(a, j.id)
    await h.reach(a, j.id, 'SUCCEEDED', injected.worker)
    const final = await h.service.changes(a.token, j.id)
    expect(final.verification?.origin).toBe('fixture')
    expect(final.verification?.candidateDigest).toBe(canonicalHash(repaired.manifest))
    expect((await h.service.getProject(a.token, j.projectId)).project.headSnapshotId).toBe(repaired.snapshotId)
    expect(injected.calls.filter(input => input.stage === 'REPAIRING')).toHaveLength(1)
    expect(injected.calls.filter(input => input.stage === 'VERIFYING')).toHaveLength(2)
    expect(await counters(j.id)).toEqual({ repair_count: 1, provider_calls: 3 })
  }, 30000)

  it('stops at two repairs and four total reserved provider fixture operations despite repeated failures', async () => {
    const a = await h.actor(), j = await h.job(a), injected = verificationFailures(100)
    const diffHashes = new Set<string>()
    for (let attempt = 0; attempt < 3; attempt++) {
      await h.reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL', injected.worker)
      diffHashes.add((await h.service.changes(a.token, j.id)).diff.sha256)
      await h.approve(a, j.id)
      await h.reach(a, j.id, 'VERIFYING', injected.worker)
      await injected.worker.runOnce()
      expect(await counters(j.id)).toEqual({ repair_count: Math.min(attempt + 1, 2), provider_calls: attempt + 2 })
      if (attempt < 2) expect((await h.state(a, j.id)).state).toBe('REPAIRING')
    }
    expect(diffHashes.size).toBe(3)
    expect((await h.state(a, j.id)).cleanupPending).toBe(true)
    await settleCleanup()
    expect((await h.state(a, j.id)).state).toBe('FAILED')
    for (let i = 0; i < 5; i++) expect(await injected.worker.runOnce()).toBe(false)
    expect(injected.calls.filter(input => input.stage === 'REPAIRING')).toHaveLength(2)
    expect(injected.calls.filter(input => input.stage === 'VERIFYING')).toHaveLength(3)
    expect(await counters(j.id)).toEqual({ repair_count: 2, provider_calls: 4 })
    const attempts = await h.db.admin.query<{ stage: string; n: number }>(
      'SELECT s.stage,count(*)::int AS n FROM forge_control.provider_attempts p JOIN forge_control.job_steps s ON p.step_id=s.id WHERE p.job_id=$1 GROUP BY s.stage ORDER BY s.stage', [j.id])
    expect(attempts.rows).toEqual([{ stage: 'GENERATING', n: 1 }, { stage: 'PLANNING', n: 1 }, { stage: 'REPAIRING', n: 2 }])
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM forge_control.snapshots WHERE job_id=$1 AND status=\'verified\'', [j.id])).rows[0].n).toBe(0)
  }, 30000)

  it.each(['cancel', 'epoch'] as const)('fences an unadopted repair result after %s changes during commit', async mode => {
    const a = await h.actor(), j = await h.job(a), injected = verificationFailures(1)
    await h.reach(a, j.id, 'REPAIRING', injected.worker)
    const old = await h.state(a, j.id)
    const worker = new ControlWorker(h.db.worker, injected.adapter, { beforeCommit: async () => {
      if (mode === 'cancel') await h.service.cancel(a.token, j.id, a.csrf, randomUUID())
      else await h.db.admin.query("UPDATE forge_control.job_steps SET lease_epoch=lease_epoch+1 WHERE job_id=$1 AND stage='REPAIRING' AND status='running'", [j.id])
    } }, h.control, h.sources)
    await worker.runOnce()
    expect((await h.state(a, j.id)).candidateSnapshotId).toBe(old.candidateSnapshotId)
    expect((await h.db.admin.query('SELECT count(*)::int AS n FROM forge_control.snapshots WHERE job_id=$1', [j.id])).rows[0].n).toBe(1)
    const dispatched = injected.calls.find(input => input.stage === 'REPAIRING')!
    const step = (await h.db.admin.query('SELECT lease_epoch,status FROM forge_control.job_steps WHERE id=$1', [dispatched.stepId])).rows[0]
    expect(Number(step.lease_epoch)).toBeGreaterThan(dispatched.leaseEpoch)
    if (mode === 'cancel') expect(step.status).toBe('cancelled')
    else await h.service.cancel(a.token, j.id, a.csrf, randomUUID())
    await settleCleanup()
    expect((await h.state(a, j.id)).state).toBe('CANCELLED')
    expect(await worker.runOnce()).toBe(false)
    expect(injected.calls.filter(input => input.stage === 'REPAIRING')).toHaveLength(1)
    expect(await counters(j.id)).toEqual({ repair_count: 1, provider_calls: 3 })
  }, 30000)
})
