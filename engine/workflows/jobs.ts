import { z } from 'zod'
import { digest, positive, scope, timestamp, uint, uuid, version } from '../contracts/primitives.ts'
import { approvalContextSchema, validateApproval } from '../contracts/review.ts'

export const states = ['QUEUED', 'PLANNING', 'AWAITING_PLAN_APPROVAL', 'GENERATING', 'VALIDATING',
  'AWAITING_EXECUTION_APPROVAL', 'PROVISIONING', 'VERIFYING', 'REPAIRING', 'PREPARING_PREVIEW',
  'AWAITING_PROMOTION', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const
export const stateSchema = z.enum(states)
export type JobState = z.infer<typeof stateSchema>
export const terminals = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const
export const isTerminal = (s: JobState): boolean => (terminals as readonly string[]).includes(s)
export const reviewStates = ['AWAITING_PLAN_APPROVAL', 'AWAITING_EXECUTION_APPROVAL', 'AWAITING_PROMOTION']
export const edges: Record<JobState, readonly JobState[]> = {
  QUEUED: ['PLANNING', 'VALIDATING'], PLANNING: ['AWAITING_PLAN_APPROVAL'],
  AWAITING_PLAN_APPROVAL: ['GENERATING'], GENERATING: ['VALIDATING'],
  VALIDATING: ['AWAITING_EXECUTION_APPROVAL', 'REPAIRING'], AWAITING_EXECUTION_APPROVAL: ['PROVISIONING'],
  PROVISIONING: ['VERIFYING'], VERIFYING: ['PREPARING_PREVIEW', 'REPAIRING'], REPAIRING: ['VALIDATING'],
  PREPARING_PREVIEW: ['AWAITING_PROMOTION'], AWAITING_PROMOTION: ['SUCCEEDED'],
  CANCELLING: ['CANCELLED'], SUCCEEDED: [], FAILED: [], CANCELLED: [], EXPIRED: [],
}
export const jobSchema = z.strictObject({ schemaVersion: version, ...scope, kind: z.enum(['generate', 'restore']),
  state: stateSchema, stateVersion: positive, baseRevision: positive, baseSnapshotId: uuid.nullable(),
  templateDigest: digest, policyDigest: digest, createdAt: timestamp, updatedAt: timestamp,
  reviewExpiresAt: timestamp.nullable(), reviewDigest: digest.nullable(), finishedAt: timestamp.nullable(), repairCount: uint.max(2),
  activeRemainingMs: uint.max(1_200_000), cancelRequested: z.boolean(),
}).refine(j => isTerminal(j.state) === (j.finishedAt !== null)
  && reviewStates.includes(j.state) === (j.reviewExpiresAt !== null)
  && reviewStates.includes(j.state) === (j.reviewDigest !== null)
  && Date.parse(j.updatedAt) >= Date.parse(j.createdAt)
  && (j.finishedAt === null || Date.parse(j.finishedAt) >= Date.parse(j.createdAt))
  && (j.state !== 'CANCELLING' || j.cancelRequested)
  && (j.kind !== 'restore' || (j.baseSnapshotId !== null && j.repairCount === 0)), 'Inconsistent job state')
export type JobV1 = z.infer<typeof jobSchema>
export const transitionSchema = z.strictObject({ target: stateSchema, expectedStateVersion: positive,
  now: timestamp, elapsedActiveMs: uint, resourcesReleased: z.boolean(), nextReviewDigest: digest.nullable(),
  reason: z.enum(['stage-complete', 'approval', 'repairable-error', 'security-rejection', 'failure', 'cancel', 'timeout', 'cleanup']),
})
export type Transition = z.infer<typeof transitionSchema>
export interface ApprovalProof { approval: unknown; subject: unknown; context: unknown }

/** Deterministic reducer. Stage evidence, elapsed time and cleanup confirmation
 * are trusted worker inputs, never client/provider assertions. E1 must persist
 * the result plus event/lease CAS in one DB transaction. */
export function transitionJob(jobInput: unknown, input: unknown, proof?: ApprovalProof): JobV1 {
  const job = jobSchema.parse(jobInput)
  const t = transitionSchema.parse(input)
  if (isTerminal(job.state) || t.expectedStateVersion !== job.stateVersion || job.stateVersion === Number.MAX_SAFE_INTEGER
    || Date.parse(t.now) < Date.parse(job.updatedAt)) throw new Error('State conflict')
  const waiting = reviewStates.includes(job.state) || job.state === 'QUEUED'
  if (waiting && t.elapsedActiveMs !== 0) throw new Error('Paused time cannot consume active budget')
  const remaining = Math.max(0, job.activeRemainingMs - t.elapsedActiveMs)
  const deadlinePassed = Date.parse(t.now) - Date.parse(job.createdAt) >= 7 * 86_400_000
    || (job.reviewExpiresAt !== null && Date.parse(t.now) >= Date.parse(job.reviewExpiresAt))
    || (job.state === 'QUEUED' && Date.parse(t.now) - Date.parse(job.createdAt) >= 600_000)
    || remaining === 0
  let allowed = false
  if (job.state === 'CANCELLING') allowed = t.target === 'CANCELLED' && t.reason === 'cleanup' && t.resourcesReleased
  else if (t.target === 'CANCELLING') allowed = t.reason === 'cancel'
  else if (t.target === 'FAILED') allowed = ['failure', 'security-rejection'].includes(t.reason) && t.resourcesReleased
  else if (t.target === 'EXPIRED') allowed = t.reason === 'timeout' && deadlinePassed && t.resourcesReleased
  else if (!deadlinePassed && !job.cancelRequested && edges[job.state].includes(t.target)) {
    allowed = t.reason === 'stage-complete'
    if (job.state === 'QUEUED') allowed &&= t.target === (job.kind === 'generate' ? 'PLANNING' : 'VALIDATING')
    if (t.target === 'REPAIRING') allowed = t.reason === 'repairable-error' && job.kind === 'generate' && job.repairCount < 2 && t.resourcesReleased
    if (reviewStates.includes(job.state)) {
      if (!proof) throw new Error('Missing approval')
      const c = approvalContextSchema.parse(proof.context)
      const kind = job.state === 'AWAITING_PLAN_APPROVAL' ? 'plan' : job.state === 'AWAITING_EXECUTION_APPROVAL' ? 'execution' : 'promotion'
      if (c.kind !== kind || c.now !== t.now || c.stateVersion !== job.stateVersion || c.reviewExpiresAt !== job.reviewExpiresAt || c.subjectDigest !== job.reviewDigest
        || c.baseRevision !== job.baseRevision || c.baseSnapshotId !== job.baseSnapshotId || c.cancelRequested !== job.cancelRequested
        || c.templateDigest !== job.templateDigest || c.policyDigest !== job.policyDigest
        || c.workspaceId !== job.workspaceId || c.projectId !== job.projectId || c.jobId !== job.jobId) throw new Error('Approval context mismatch')
      allowed = t.reason === 'approval' && validateApproval(proof.approval, proof.subject, c).decision === 'approve'
    }
  }
  if (!allowed || reviewStates.includes(t.target) !== (t.nextReviewDigest !== null)) throw new Error('Forbidden transition')
  const reviewExpiresAt = reviewStates.includes(t.target)
    ? new Date(Math.min(Date.parse(t.now) + 86_400_000, Date.parse(job.createdAt) + 7 * 86_400_000)).toISOString() : null
  return jobSchema.parse({ ...job, state: t.target, stateVersion: job.stateVersion + 1,
    updatedAt: t.now, activeRemainingMs: remaining, reviewExpiresAt, reviewDigest: t.nextReviewDigest,
    finishedAt: isTerminal(t.target) ? t.now : null,
    repairCount: job.repairCount + (t.target === 'REPAIRING' ? 1 : 0),
    cancelRequested: job.cancelRequested || t.target === 'CANCELLING',
  })
}
