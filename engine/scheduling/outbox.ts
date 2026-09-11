import { randomUUID } from 'node:crypto'
import { one, number } from '../control/database.ts'
import type { ControlDatabase, Principal, Tx } from '../control/database.ts'
import type { JobRow, StepRow } from '../control/state.ts'
import { appendEvent, flushEventSequence } from '../control/state.ts'
import { operationId } from '../control/worker.ts'
import { parseCommand, parseDispatch, parseResult, MAX_DISPATCH_MS } from './protocol.ts'
import type { Dispatch, StepCommand, StepResult } from './protocol.ts'
import type { DeliveryOutcome } from './delivery.ts'

export class OutboxError extends Error {
  constructor(readonly code: 'FENCED' | 'CONFLICT' | 'CAPACITY_UNVERIFIED' | 'UNRESOLVED') {
    super(code)
  }
}
interface Intent {
  id: string
  workspace_id: string
  project_id: string
  job_id: string
  actor_id: string
  session_hash: string
  admitted_state_version: string
  policy_digest: string
  template_digest: string
  expires_at: Date
  delivery_status: string
  delivery_epoch: number
  delivery_owner: string | null
  delivery_expires_at: Date | null
  next_sequence: number
  closed_at: Date | null
}
export interface StepClaim {
  step: StepRow
  operationId: string
}
export type BeginResult =
  | { kind: 'claimed'; claim: StepClaim }
  | { kind: 'replay'; result: StepResult }
  | { kind: 'busy' | 'unresolved' }
export interface DeliveryClaim {
  dispatch: Dispatch
  epoch: number
  owner: string
}
/** Real composition must reserve verified shared allowances inside this transaction.
 * No default allowance, plan-name inference, or network request is provided here.
 */
export interface SchedulerAllowanceGate {
  reserveDelivery(c: Tx, dispatch: Dispatch, attempt: number): Promise<void>
}
const metadata = (d: Intent): Dispatch => ({
  schemaVersion: 1,
  dispatchId: d.id,
  workspaceId: d.workspace_id,
  jobId: d.job_id,
  expiresAt: d.expires_at.toISOString(),
})
const now = async (c: Tx) => (await one<{ now: Date }>(c, 'SELECT clock_timestamp() AS now')).now
const sameDispatch = (a: Dispatch, b: Dispatch) =>
  a.schemaVersion === b.schemaVersion &&
  a.dispatchId === b.dispatchId &&
  a.workspaceId === b.workspaceId &&
  a.jobId === b.jobId &&
  a.expiresAt === b.expiresAt
const runnable = (j: JobRow, at: Date) =>
  !j.finished_at &&
  !j.cleanup_target &&
  !j.cancel_requested_at &&
  !j.state.startsWith('AWAITING_') &&
  j.state !== 'CANCELLING' &&
  j.created_at.getTime() > at.getTime() - 7 * 86400000 &&
  (j.state !== 'QUEUED' || j.created_at.getTime() > at.getTime() - 600000) &&
  (!j.active_deadline_at || j.active_deadline_at > at)

/** Call from the existing authenticated admission/approval transaction, after
 * quotas and job/source policy are admitted. No separate transaction or job is created.
 */
export async function enqueueDispatch(
  c: Tx,
  principal: Principal,
  jobId: string,
  dispatch: Dispatch
): Promise<Dispatch> {
  const input = parseDispatch(dispatch)
  if (input.jobId !== jobId) throw new OutboxError('CONFLICT')
  const settings = await one<{ admission_enabled: boolean; security_shutdown: boolean }>(
    c,
    'SELECT admission_enabled,security_shutdown FROM control_settings WHERE singleton FOR SHARE'
  )
  if (!settings.admission_enabled || settings.security_shutdown) throw new OutboxError('FENCED')
  const hint = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2', [
    jobId,
    input.workspaceId,
  ])
  await one(c, 'SELECT id FROM projects WHERE id=$1 AND deleting_at IS NULL FOR UPDATE', [
    hint.project_id,
  ])
  const job = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId])
  const timestamp = await now(c)
  if (!runnable(job, timestamp) || job.created_by !== principal.user_id)
    throw new OutboxError('FENCED')
  const prior = (
    await c.query<Intent>('SELECT * FROM scheduler_dispatches WHERE id=$1', [input.dispatchId])
  ).rows[0]
  const { hash } = await one<{ hash: string }>(
    c,
    "SELECT current_setting('forge.session_hash',true) AS hash"
  )
  if (prior) {
    if (
      !sameDispatch(metadata(prior), input) ||
      prior.actor_id !== principal.user_id ||
      prior.session_hash !== hash
    )
      throw new OutboxError('CONFLICT')
    return metadata(prior)
  }
  const remaining = Date.parse(input.expiresAt) - timestamp.getTime()
  if (remaining <= 0 || remaining > MAX_DISPATCH_MS) throw new OutboxError('FENCED')
  await one(
    c,
    "SELECT id FROM usage_reservations WHERE job_id=$1 AND status='open' AND expires_at>clock_timestamp() FOR SHARE",
    [jobId]
  )
  if (
    (
      await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2)', [
        job.policy_digest,
        job.template_digest,
      ])
    ).rowCount
  )
    throw new OutboxError('FENCED')
  const row = await one<Intent>(
    c,
    `INSERT INTO scheduler_dispatches
    (id,workspace_id,project_id,job_id,actor_id,session_hash,admitted_state_version,policy_digest,template_digest,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      input.dispatchId,
      job.workspace_id,
      job.project_id,
      job.id,
      principal.user_id,
      hash,
      job.state_version,
      job.policy_digest,
      job.template_digest,
      input.expiresAt,
    ]
  )
  return metadata(row)
}

/** Durable transport/lease plumbing, NOT a StageAdapter or BoundedControlStep.
 * Nothing calls providers, executes generated code, mounts HTTP or enables workers.
 */
export class PostgresSchedulerOutbox {
  constructor(
    readonly db: ControlDatabase,
    readonly allowance?: SchedulerAllowanceGate
  ) {
    if (db.role !== 'forge_control_worker') throw new Error('Restricted worker identity required')
  }
  private async lock(c: Tx, input: Dispatch) {
    // Identity/session locks precede settings/project/job locks, matching admission.
    await c.query('SELECT authorize_scheduler_dispatch($1,$2)', [
      input.dispatchId,
      input.workspaceId,
    ])
    const settings = await one<{
      worker_enabled: boolean
      security_shutdown: boolean
      max_running: number
    }>(
      c,
      'SELECT worker_enabled,security_shutdown,max_running FROM control_settings WHERE singleton FOR UPDATE'
    )
    if (!settings.worker_enabled || settings.security_shutdown) throw new OutboxError('FENCED')
    const hint = await one<Intent>(c, 'SELECT * FROM scheduler_dispatches WHERE id=$1', [
      input.dispatchId,
    ])
    await one(c, 'SELECT id FROM projects WHERE id=$1 AND deleting_at IS NULL FOR UPDATE', [
      hint.project_id,
    ])
    const job = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [hint.job_id])
    const intent = await one<Intent>(
      c,
      'SELECT * FROM scheduler_dispatches WHERE id=$1 FOR UPDATE',
      [input.dispatchId]
    )
    if (
      !sameDispatch(metadata(intent), input) ||
      job.created_by !== intent.actor_id ||
      job.policy_digest !== intent.policy_digest ||
      job.template_digest !== intent.template_digest ||
      number(job.state_version) < number(intent.admitted_state_version)
    )
      throw new OutboxError('CONFLICT')
    return { intent, job, settings, timestamp: await now(c) }
  }
  private async active(c: Tx, intent: Intent, job: JobRow, timestamp: Date) {
    if (intent.closed_at || intent.expires_at <= timestamp || !runnable(job, timestamp))
      throw new OutboxError('FENCED')
    if (
      (
        await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2)', [
          job.policy_digest,
          job.template_digest,
        ])
      ).rowCount ||
      (
        await c.query('SELECT 1 FROM cleanup_requests WHERE job_id=$1 AND confirmed_at IS NULL', [
          job.id,
        ])
      ).rowCount
    )
      throw new OutboxError('FENCED')
    await one(
      c,
      "SELECT id FROM usage_reservations WHERE job_id=$1 AND status='open' AND expires_at>clock_timestamp() FOR SHARE",
      [job.id]
    )
  }
  async claimDelivery(dispatch: Dispatch): Promise<DeliveryClaim | null> {
    const input = parseDispatch(dispatch)
    if (!this.allowance) throw new OutboxError('CAPACITY_UNVERIFIED')
    return this.db.scoped(input.workspaceId, async (c) => {
      const { intent, job, timestamp } = await this.lock(c, input)
      await this.active(c, intent, job, timestamp)
      if (['acknowledged', 'rejected'].includes(intent.delivery_status)) return null
      if (intent.delivery_status === 'claimed' && intent.delivery_expires_at! > timestamp)
        return null
      if (intent.delivery_status === 'claimed') {
        await this.receipt(c, intent, intent.delivery_epoch, 'unknown')
        await c.query(
          "UPDATE scheduler_dispatches SET delivery_status='unknown',delivery_owner=NULL,delivery_expires_at=NULL WHERE id=$1",
          [intent.id]
        )
      }
      if (intent.delivery_epoch >= 3) return null
      // Reserve worst-case delivery/lookup/reconciliation use BEFORE any HTTP call.
      await this.allowance!.reserveDelivery(c, input, intent.delivery_epoch + 1)
      const owner = randomUUID()
      await c.query(
        `UPDATE scheduler_dispatches SET delivery_status='claimed',delivery_epoch=delivery_epoch+1,
        delivery_owner=$2,delivery_expires_at=LEAST(expires_at,clock_timestamp()+interval '30 seconds') WHERE id=$1`,
        [intent.id, owner]
      )
      return { dispatch: input, epoch: intent.delivery_epoch + 1, owner }
    })
  }
  private receipt(c: Tx, d: Intent, epoch: number, outcome: Exclude<DeliveryOutcome, 'disabled'>) {
    return c.query(
      `INSERT INTO scheduler_delivery_receipts(workspace_id,project_id,job_id,dispatch_id,epoch,outcome)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [d.workspace_id, d.project_id, d.job_id, d.id, epoch, outcome]
    )
  }
  /** Late transport acknowledgement is evidence only, never restored job authority.
   * An expired/replaced delivery lease cannot overwrite a newer result.
   */
  async recordDelivery(claim: DeliveryClaim, outcome: Exclude<DeliveryOutcome, 'disabled'>) {
    if (!['acknowledged', 'rejected', 'unknown'].includes(outcome))
      throw new OutboxError('CONFLICT')
    const input = parseDispatch(claim.dispatch)
    return this.db.scoped(input.workspaceId, async (c) => {
      const d = await one<Intent>(c, 'SELECT * FROM scheduler_dispatches WHERE id=$1 FOR UPDATE', [
        input.dispatchId,
      ])
      if (!sameDispatch(metadata(d), input)) throw new OutboxError('CONFLICT')
      const prior = (
        await c.query<{ outcome: string }>(
          'SELECT outcome FROM scheduler_delivery_receipts WHERE dispatch_id=$1 AND epoch=$2',
          [d.id, claim.epoch]
        )
      ).rows[0]
      if (prior) {
        if (prior.outcome !== outcome) throw new OutboxError('CONFLICT')
        return
      }
      if (
        d.delivery_status !== 'claimed' ||
        d.delivery_epoch !== claim.epoch ||
        d.delivery_owner !== claim.owner ||
        !d.delivery_expires_at ||
        d.delivery_expires_at <= (await now(c))
      )
        throw new OutboxError('FENCED')
      await this.receipt(c, d, claim.epoch, outcome)
      await c.query(
        'UPDATE scheduler_dispatches SET delivery_status=$2,delivery_owner=NULL,delivery_expires_at=NULL WHERE id=$1',
        [d.id, outcome]
      )
    })
  }
  async begin(command: StepCommand): Promise<BeginResult> {
    const input = parseCommand(command)
    return this.db.scoped(input.workspaceId, async (c) => {
      const { intent, job, settings, timestamp } = await this.lock(c, input)
      const prior = (
        await c.query<{ status: string; result_json: unknown }>(
          'SELECT status,result_json FROM scheduler_step_receipts WHERE dispatch_id=$1 AND sequence=$2',
          [intent.id, input.sequence]
        )
      ).rows[0]
      // Never rerun a started step, even after a crash, lease expiry or worker restart.
      if (prior)
        return prior.status === 'settled'
          ? { kind: 'replay', result: parseResult(prior.result_json) }
          : { kind: 'unresolved' }
      if (input.sequence !== intent.next_sequence) throw new OutboxError('CONFLICT')
      await this.active(c, intent, job, timestamp)
      // Global settings lock serializes with existing E1 claims. Expired leases
      // count until the canonical reconciler resolves their external liabilities.
      const counts = await one<{ total: string; actor: string; workspace: string }>(
        c,
        `SELECT count(*)::text AS total,
        count(*) FILTER(WHERE j.created_by=$1)::text AS actor,
        count(*) FILTER(WHERE s.workspace_id=$2)::text AS workspace
        FROM job_steps s JOIN jobs j ON j.id=s.job_id WHERE s.status='running'`,
        [job.created_by, job.workspace_id]
      )
      const quota = (
        await c.query<{ max_active_jobs: number }>(
          `SELECT max_active_jobs FROM workspace_quotas
        WHERE workspace_id=$1 AND period_start<=clock_timestamp() AND period_start>clock_timestamp()-interval '1 day'
        ORDER BY period_start DESC LIMIT 1 FOR SHARE`,
          [job.workspace_id]
        )
      ).rows[0]
      // Existing tenant RLS means a worker cannot count other tenants here. The
      // guarded global counter below is required; scoped counts alone are unsafe.
      const global = await one<{ running: string; actor: string }>(
        c,
        'SELECT * FROM scheduler_running_counts($1)',
        [job.created_by]
      )
      if (
        !quota ||
        number(global.running) >= Math.min(1, settings.max_running) ||
        number(global.actor) >= 1 ||
        number(counts.workspace) >= quota.max_active_jobs
      )
        return { kind: 'busy' }
      const selected = (
        await c.query<StepRow>(
          `SELECT * FROM job_steps WHERE job_id=$1 AND stage=$2 AND status='queued'
        AND available_at<=clock_timestamp() ORDER BY attempt LIMIT 1 FOR UPDATE`,
          [job.id, job.state]
        )
      ).rows[0]
      if (!selected) return { kind: 'busy' }
      const owner = randomUUID()
      const step = await one<StepRow>(
        c,
        `UPDATE job_steps SET status='running',lease_owner=$2,lease_epoch=lease_epoch+1,
        lease_expires_at=LEAST($3::timestamptz,clock_timestamp()+interval '60 seconds'),started_at=COALESCE(started_at,clock_timestamp())
        WHERE id=$1 RETURNING *`,
        [selected.id, owner, intent.expires_at]
      )
      const op = operationId(job.id, step.id, step.attempt)
      await c.query(
        `INSERT INTO scheduler_step_receipts(workspace_id,project_id,job_id,dispatch_id,sequence,step_id,lease_owner,lease_epoch,operation_id,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'started')`,
        [
          job.workspace_id,
          job.project_id,
          job.id,
          intent.id,
          input.sequence,
          step.id,
          owner,
          step.lease_epoch,
          op,
        ]
      )
      await appendEvent(c, job, 'step.started', {
        stepId: step.id,
        stage: step.stage,
        attempt: step.attempt,
        leaseEpoch: number(step.lease_epoch),
      })
      await flushEventSequence(c, job)
      return { kind: 'claimed', claim: { step, operationId: op } }
    })
  }
  /** Apply trusted stage state/events and the scheduler outcome in ONE short E1
   * transaction. Never put a provider call/build/HTTP request in applyStage.
   * This is not provider/source/approval authority; real composition adds those checks.
   */
  async settle(
    command: StepCommand,
    claim: StepClaim,
    result: StepResult,
    applyStage: (c: Tx, job: JobRow, step: StepRow) => Promise<void>
  ) {
    const input = parseCommand(command),
      output = parseResult(result)
    return this.db.scoped(input.workspaceId, async (c) => {
      const { intent, job, timestamp } = await this.lock(c, input)
      const receipt = await one<{
        status: string
        result_json: unknown
        step_id: string
        lease_owner: string
        lease_epoch: string
        operation_id: string
      }>(
        c,
        'SELECT * FROM scheduler_step_receipts WHERE dispatch_id=$1 AND sequence=$2 FOR UPDATE',
        [intent.id, input.sequence]
      )
      if (
        receipt.step_id !== claim.step.id ||
        receipt.lease_owner !== claim.step.lease_owner ||
        receipt.lease_epoch !== claim.step.lease_epoch ||
        receipt.operation_id !== claim.operationId
      )
        throw new OutboxError('CONFLICT')
      if (receipt.status === 'settled') {
        const prior = parseResult(receipt.result_json)
        if (prior.state !== output.state || prior.retryAfterSeconds !== output.retryAfterSeconds)
          throw new OutboxError('CONFLICT')
        return output
      }
      await this.active(c, intent, job, timestamp)
      const step = await one<StepRow>(
        c,
        `SELECT * FROM job_steps WHERE id=$1 AND lease_owner=$2 AND lease_epoch=$3
        AND status='running' AND lease_expires_at>clock_timestamp() FOR UPDATE`,
        [claim.step.id, claim.step.lease_owner, claim.step.lease_epoch]
      )
      if (step.job_id !== job.id || step.stage !== job.state) throw new OutboxError('FENCED')
      await applyStage(c, job, step)
      // Returning a scheduler hint cannot silently leave a lease running.
      await one(
        c,
        "SELECT id FROM job_steps WHERE id=$1 AND lease_epoch=$2 AND status IN('succeeded','failed','cancelled')",
        [step.id, step.lease_epoch]
      )
      const committed = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [job.id])
      const matches =
        output.state === 'complete'
          ? committed.state === 'SUCCEEDED'
          : output.state === 'awaiting-approval'
            ? committed.state.startsWith('AWAITING_')
            : output.state === 'cancelled'
              ? committed.cancel_requested_at !== null
              : output.state === 'blocked'
                ? ['FAILED', 'EXPIRED'].includes(committed.state)
                : runnable(committed, await now(c))
      if (!matches) throw new OutboxError('CONFLICT')
      await c.query(
        "UPDATE scheduler_step_receipts SET status='settled',result_json=$3,settled_at=clock_timestamp() WHERE dispatch_id=$1 AND sequence=$2",
        [intent.id, input.sequence, output]
      )
      await c.query(
        `UPDATE scheduler_dispatches SET next_sequence=next_sequence+1,
        closed_at=CASE WHEN $2 OR next_sequence=29 THEN clock_timestamp() ELSE NULL END WHERE id=$1`,
        [intent.id, output.state !== 'continue']
      )
      return output
    })
  }
}
