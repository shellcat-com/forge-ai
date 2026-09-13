import { randomUUID } from 'node:crypto'
import { jobSchema, transitionJob, isTerminal, reviewStates } from '../workflows/jobs.ts'
import type { ApprovalProof, JobState, Transition } from '../workflows/jobs.ts'
import { canonicalHash } from '../contracts/canonical.ts'
import { jobEventSchema } from '../contracts/events.ts'
import {
  planReviewSchema,
  executionReviewSchema,
  promotionReviewSchema,
} from '../contracts/review.ts'
import type { JobEventV1 } from '../contracts/events.ts'
import type { Tx } from './database.ts'
import { clock, number, one } from './database.ts'
import { conflict, ControlError } from './contracts.ts'
export interface JobRow {
  id: string
  workspace_id: string
  project_id: string
  created_by: string
  kind: 'generate' | 'restore'
  state: JobState
  state_version: string
  base_revision: string
  base_snapshot_id: string | null
  template_digest: string
  policy_digest: string
  created_at: Date
  updated_at: Date
  review_expires_at: Date | null
  review_digest: string | null
  review_json: unknown
  finished_at: Date | null
  repair_count: number
  active_remaining_ms: number
  active_started_at: Date | null
  active_deadline_at: Date | null
  cancel_requested_at: Date | null
  cleanup_target: string | null
  next_event_seq: string
  earliest_event_seq: string
  candidate_snapshot_id: string | null
  plan_artifact_id: string | null
  request_json: Record<string, unknown>
  model_policy_json: unknown
  cost_limit_micros: string
  provider_calls: number
  origin: 'fixture'
}
export interface StepRow {
  id: string
  workspace_id: string
  project_id: string
  job_id: string
  stage: JobState
  attempt: number
  status: string
  lease_owner: string
  lease_epoch: string
  lease_expires_at: Date
  input_digest: string
  output_artifact_id: string | null
  external_operation_id: string | null
}
export function logicalJob(j: JobRow) {
  return jobSchema.parse({
    schemaVersion: 1,
    workspaceId: j.workspace_id,
    projectId: j.project_id,
    jobId: j.id,
    kind: j.kind,
    state: j.state,
    stateVersion: number(j.state_version),
    baseRevision: number(j.base_revision),
    baseSnapshotId: j.base_snapshot_id,
    templateDigest: j.template_digest,
    policyDigest: j.policy_digest,
    createdAt: j.created_at.toISOString(),
    updatedAt: j.updated_at.toISOString(),
    reviewExpiresAt: j.review_expires_at?.toISOString() ?? null,
    reviewDigest: j.review_digest,
    finishedAt: j.finished_at?.toISOString() ?? null,
    repairCount: j.repair_count,
    activeRemainingMs: j.active_remaining_ms,
    cancelRequested: j.cancel_requested_at !== null,
  })
}
export const scopeOf = (j: JobRow) => ({
  workspaceId: j.workspace_id,
  projectId: j.project_id,
  jobId: j.id,
})
export async function appendEvent(c: Tx, j: JobRow, type: JobEventV1['type'], data: unknown) {
  const e = jobEventSchema.parse({
    schemaVersion: 1,
    ...scopeOf(j),
    seq: number(j.next_event_seq),
    at: await clock(c),
    stateVersion: number(j.state_version),
    type,
    data,
  })
  await c.query(
    'INSERT INTO job_events(workspace_id,project_id,job_id,seq,type,schema_version,state_version,payload_json) VALUES($1,$2,$3,$4,$5,1,$6,$7)',
    [j.workspace_id, j.project_id, j.id, e.seq, e.type, e.stateVersion, e]
  )
  // Terminal jobs are immutable under E0: callers reserve event sequence before terminalizing.
  j.next_event_seq = String(number(j.next_event_seq) + 1)
  return e
}
export async function flushEventSequence(c: Tx, j: JobRow) {
  await c.query('UPDATE jobs SET next_event_seq=$2 WHERE id=$1', [j.id, j.next_event_seq])
}
export async function audit(
  c: Tx,
  j: { workspace_id: string; id: string },
  actor: string,
  action: string
) {
  await c.query(
    `INSERT INTO audit_events(id,workspace_id,actor_kind,actor_id,action,resource_id,request_id,outcome,metadata_json) VALUES($1,$2,'user',$3,$4,$5,$6,'allowed','{"schemaVersion":1,"origin":"fixture"}')`,
    [randomUUID(), j.workspace_id, actor, action, j.id, randomUUID()]
  )
}
export async function enqueue(c: Tx, j: JobRow) {
  if (
    isTerminal(j.state) ||
    reviewStates.includes(j.state) ||
    j.state === 'CANCELLING' ||
    j.cleanup_target
  )
    return
  const attempt = (
    await one<{ n: number }>(
      c,
      'SELECT COALESCE(max(attempt),0)::int+1 AS n FROM job_steps WHERE job_id=$1 AND stage=$2',
      [j.id, j.state]
    )
  ).n
  await c.query(
    `INSERT INTO job_steps(id,workspace_id,project_id,job_id,stage,attempt,status,available_at,input_digest) VALUES($1,$2,$3,$4,$5,$6,'queued',clock_timestamp(),$7)`,
    [
      randomUUID(),
      j.workspace_id,
      j.project_id,
      j.id,
      j.state,
      attempt,
      canonicalHash({
        jobId: j.id,
        state: j.state,
        version: number(j.state_version),
        candidate: j.candidate_snapshot_id,
        plan: j.plan_artifact_id,
      }),
    ]
  )
}
export async function changeState(
  c: Tx,
  j: JobRow,
  target: JobState,
  reason: Transition['reason'],
  review: unknown = null,
  proof?: ApprovalProof,
  at?: string
) {
  const now = at ?? (await clock(c))
  const elapsed = j.active_started_at
    ? Math.max(0, Date.parse(now) - j.active_started_at.getTime())
    : 0
  const subject =
    review === null
      ? null
      : (target === 'AWAITING_PLAN_APPROVAL'
          ? planReviewSchema
          : target === 'AWAITING_EXECUTION_APPROVAL'
            ? executionReviewSchema
            : promotionReviewSchema
        ).parse(review)
  const changed = transitionJob(
    logicalJob(j),
    {
      target,
      expectedStateVersion: number(j.state_version),
      now,
      elapsedActiveMs: reviewStates.includes(j.state) || j.state === 'QUEUED' ? 0 : elapsed,
      resourcesReleased: true,
      nextReviewDigest: subject ? canonicalHash(subject) : null,
      reason,
    },
    proof ? { ...proof, context: { ...(proof.context as object), now } } : undefined
  )
  if (subject && subject.expiresAt !== changed.reviewExpiresAt)
    throw new Error('Review expiry must match reducer')
  if (subject) {
    await one(
      c,
      'SELECT workspace_id FROM workspace_quotas WHERE workspace_id=$1 ORDER BY period_start DESC LIMIT 1 FOR UPDATE',
      [j.workspace_id]
    )
    const limit = await one<{ max_pending_reviews: number }>(
      c,
      'SELECT max_pending_reviews FROM control_settings'
    )
    const pending = await one<{ n: string }>(
      c,
      "SELECT count(*)::text AS n FROM jobs WHERE workspace_id=$1 AND id<>$2 AND state IN('AWAITING_PLAN_APPROVAL','AWAITING_EXECUTION_APPROVAL','AWAITING_PROMOTION')",
      [j.workspace_id, j.id]
    )
    if (number(pending.n) >= limit.max_pending_reviews)
      throw new ControlError(429, 'CAPACITY_UNAVAILABLE')
  }
  const previous = j.state
  j.state = changed.state
  j.state_version = String(changed.stateVersion)
  await appendEvent(c, j, 'job.state', { from: previous, to: target })
  if (isTerminal(target))
    await appendEvent(c, j, 'job.terminal', {
      state: target,
      errorCode:
        target === 'FAILED'
          ? 'FIXTURE_STAGE_FAILED'
          : target === 'EXPIRED'
            ? 'DEADLINE_EXCEEDED'
            : null,
    })
  const running =
    !isTerminal(target) &&
    !reviewStates.includes(target) &&
    target !== 'QUEUED' &&
    target !== 'CANCELLING'
  const deadline = running
    ? new Date(Date.parse(now) + changed.activeRemainingMs).toISOString()
    : null
  const result = await c.query<JobRow>(
    `UPDATE jobs SET state=$2::text::job_state,state_version=$3,updated_at=$4,active_remaining_ms=$5,active_started_at=$6,active_deadline_at=$7,
    review_expires_at=$8,review_digest=$9,review_json=$10,repair_count=$11,finished_at=$12,next_event_seq=$13,cancel_requested_at=CASE WHEN $2::text='CANCELLING' THEN COALESCE(cancel_requested_at,$4) ELSE cancel_requested_at END
    WHERE id=$1 AND state_version=$14 RETURNING *`,
    [
      j.id,
      target,
      changed.stateVersion,
      now,
      changed.activeRemainingMs,
      running ? now : null,
      deadline,
      changed.reviewExpiresAt,
      changed.reviewDigest,
      subject,
      changed.repairCount,
      changed.finishedAt,
      j.next_event_seq,
      changed.stateVersion - 1,
    ]
  )
  if (result.rowCount !== 1) throw conflict()
  Object.assign(j, result.rows[0])
  if (subject)
    await c.query(
      `INSERT INTO job_reviews(workspace_id,project_id,job_id,state_version,kind,subject_digest,body,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        j.workspace_id,
        j.project_id,
        j.id,
        j.state_version,
        target === 'AWAITING_PLAN_APPROVAL'
          ? 'plan'
          : target === 'AWAITING_EXECUTION_APPROVAL'
            ? 'execution'
            : 'promotion',
        j.review_digest,
        subject,
        subject.expiresAt,
      ]
    )
  await enqueue(c, j)
}
export async function reviewExpiry(c: Tx, j: JobRow) {
  const now = await clock(c)
  return new Date(
    Math.min(Date.parse(now) + 86400000, j.created_at.getTime() + 7 * 86400000)
  ).toISOString()
}
export async function releaseReservation(c: Tx, j: JobRow) {
  const r = await one<{
    reserved_micros: string
    settled_micros: string
    released_micros: string
    period_start: Date
    status: string
  }>(c, 'SELECT * FROM usage_reservations WHERE job_id=$1 FOR UPDATE', [j.id])
  const pending = await one<{ n: string; count: string }>(
    c,
    "SELECT COALESCE(sum(maximum_micros),0)::text AS n,count(*)::text AS count FROM provider_attempts WHERE job_id=$1 AND state IN ('dispatched','uncertain')",
    [j.id]
  )
  const liability = number(pending.n)
  const release = Math.max(
    0,
    number(r.reserved_micros) - number(r.settled_micros) - number(r.released_micros) - liability
  )
  await c.query(
    'UPDATE workspace_quotas SET reserved_micros=reserved_micros-$3 WHERE workspace_id=$1 AND period_start=$2',
    [j.workspace_id, r.period_start, release]
  )
  await c.query(
    'UPDATE usage_reservations SET released_micros=released_micros+$2,status=$3 WHERE job_id=$1',
    [j.id, release, number(pending.count) > 0 ? 'uncertain' : 'settled']
  )
}
