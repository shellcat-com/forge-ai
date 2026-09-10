import { expect, it } from 'vitest'
import { edges, isTerminal, jobSchema, reviewStates, states, transitionJob } from '../../engine/workflows/jobs.ts'
import { approval, context, hash, job, now, review, transition } from './fixtures.ts'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
const proof = { approval, subject: review, context }
it('requires approval and current state version; does not mutate its inputs', () => {
  expect(() => transitionJob(job, transition)).toThrow('Missing approval')
  expect(() => transitionJob(job, { ...transition, expectedStateVersion: 5 }, proof)).toThrow('State conflict')
  const result = transitionJob(job, transition, proof)
  expect(result).toMatchObject({ state: 'PROVISIONING', stateVersion: 7, reviewDigest: null })
  expect(job.state).toBe('AWAITING_EXECUTION_APPROVAL')
  expect(transitionJob(job, transition, proof)).toEqual(result)
})
it('enumerates all forbidden ordinary state pairs', () => {
  let tested = 0
  for (const from of states) for (const to of states) {
    if (!edges[from].includes(to)) {
      const current = { ...job, state: from, finishedAt: isTerminal(from) ? now : null,
        reviewExpiresAt: reviewStates.includes(from) ? job.reviewExpiresAt : null,
        reviewDigest: reviewStates.includes(from) ? hash : null }
      expect(() => transitionJob(current, { ...transition, target: to, reason: 'stage-complete' })).toThrow()
      tested++
    }
  }
  expect(tested).toBeGreaterThan(230)
})
it('requires fresh review digests and consumes machine-active time, with deterministic 24h expiry', () => {
  const current = { ...job, state: 'PLANNING', reviewExpiresAt: null, reviewDigest: null }
  const t = { ...transition, target: 'AWAITING_PLAN_APPROVAL', reason: 'stage-complete', elapsedActiveMs: 1000, nextReviewDigest: hash }
  expect(transitionJob(current, t)).toMatchObject({ activeRemainingMs: 1199000, reviewDigest: hash, reviewExpiresAt: '2026-09-10T12:00:00.000Z' })
  expect(() => transitionJob(job, { ...transition, elapsedActiveMs: 1 }, proof)).toThrow('Paused')
})
it('requires confirmed cleanup; cancelling never fails, expires or promotes early', () => {
  const cancelling = transitionJob(job, { ...transition, target: 'CANCELLING', reason: 'cancel', resourcesReleased: false })
  for (const target of ['FAILED', 'EXPIRED', 'SUCCEEDED', 'CANCELLED'])
    expect(() => transitionJob(cancelling, { ...transition, target, expectedStateVersion: 7, resourcesReleased: false, reason: 'cleanup' })).toThrow()
  const cancelled = transitionJob(cancelling, { ...transition, target: 'CANCELLED', expectedStateVersion: 7, reason: 'cleanup' })
  expect(cancelled.finishedAt).toBe(now)
  expect(() => transitionJob(cancelled, { ...transition, expectedStateVersion: 8 })).toThrow('State conflict')
})
it('honors queue/review/active deadlines and does not permit timeout before a deadline', () => {
  const queued = { ...job, state: 'QUEUED', reviewExpiresAt: null, reviewDigest: null }
  expect(() => transitionJob(queued, { ...transition, target: 'EXPIRED', reason: 'timeout' })).toThrow()
  expect(transitionJob(queued, { ...transition, target: 'EXPIRED', reason: 'timeout', now: '2026-09-09T12:10:00.000Z' }).state).toBe('EXPIRED')
  expect(() => transitionJob(job, { ...transition, now: job.reviewExpiresAt }, { ...proof, context: { ...context, now: job.reviewExpiresAt } })).toThrow()
  expect(() => transitionJob({ ...queued, state: 'VERIFYING' }, { ...transition, target: 'PREPARING_PREVIEW', reason: 'stage-complete', elapsedActiveMs: 1200000 })).toThrow()
})
it('bounds repairs for the entire job and forbids restore repair or wrong admission path', () => {
  const current = { ...job, state: 'VERIFYING', reviewExpiresAt: null, reviewDigest: null }
  const t = { ...transition, target: 'REPAIRING', reason: 'repairable-error' }
  expect(transitionJob(current, t).repairCount).toBe(1)
  expect(() => transitionJob({ ...current, repairCount: 2 }, t)).toThrow()
  expect(() => transitionJob({ ...current, kind: 'restore', baseSnapshotId: scopeSnapshot }, t)).toThrow()
  expect(() => transitionJob({ ...current, state: 'QUEUED' }, { ...transition, target: 'VALIDATING', reason: 'stage-complete' })).toThrow()
  expect(jobSchema.safeParse({ ...current, kind: 'restore', baseSnapshotId: null }).success).toBe(false)
})
const scopeSnapshot = '00000000-0000-4000-8000-000000000099'
it('cannot reuse approval after repair or replace its persisted subject', () => {
  expect(() => transitionJob({ ...job, stateVersion: 9 }, { ...transition, expectedStateVersion: 9 }, proof)).toThrow()
  expect(() => transitionJob({ ...job, reviewDigest: hash }, transition, proof)).toThrow()
  expect(() => transitionJob(job, transition, { ...proof, approval: { ...approval, decision: 'reject' } })).toThrow()
})
it.each(['plan', 'promotion'] as const)('binds %s approval to its exact persisted review and revision', kind => {
  const subject = { schemaVersion: 1, workspaceId: job.workspaceId, projectId: job.projectId, jobId: job.jobId,
    baseRevision: job.baseRevision, baseSnapshotId: job.baseSnapshotId, templateDigest: job.templateDigest, policyDigest: job.policyDigest,
    expiresAt: job.reviewExpiresAt,
    ...(kind === 'plan' ? { planDigest: hash } : { candidateDigest: hash, verificationDigest: hash }) }
  const subjectDigest = canonicalHash(subject)
  const current = { ...job, state: kind === 'plan' ? 'AWAITING_PLAN_APPROVAL' : 'AWAITING_PROMOTION', reviewDigest: subjectDigest }
  const target = kind === 'plan' ? 'GENERATING' : 'SUCCEEDED'
  const evidence = { subject, approval: { ...approval, kind, subjectDigest }, context: { ...context, kind, subjectDigest } }
  expect(transitionJob(current, { ...transition, target }, evidence).state).toBe(target)
  expect(() => transitionJob(current, { ...transition, target }, { ...evidence, context: { ...evidence.context, baseRevision: 2 } })).toThrow()
})
