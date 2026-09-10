import { randomUUID } from 'node:crypto'
import type { ControlDatabase } from './database.ts'
import { one, clock, number } from './database.ts'
import { changeState, appendEvent, flushEventSequence, releaseReservation } from './state.ts'
import type { JobRow } from './state.ts'
import { destroyFixtureResources, requestCleanup } from './worker.ts'
import { isTerminal } from '../workflows/jobs.ts'
export interface CleanupAdapter {
  readonly origin: 'fixture'
  confirm(jobId: string): Promise<boolean>
}
/** Confirms simulated resources only. Does not claim real host termination. */
export class FixtureCleanupAdapter implements CleanupAdapter {
  readonly origin = 'fixture' as const
  constructor(public available = true) {}
  async confirm() {
    return this.available
  }
}
export class ControlReconciler {
  readonly id = randomUUID()
  constructor(
    readonly db: ControlDatabase,
    readonly cleanup: CleanupAdapter
  ) {
    if (cleanup.origin !== 'fixture') throw new Error('Real runner cleanup is E3')
  }
  async runOnce(): Promise<number> {
    const candidates = await this.db.tx(
      async (c) =>
        (
          await c.query<{ workspace_id: string; project_id: string; job_id: string }>(
            'SELECT * FROM maintenance_jobs()'
          )
        ).rows
    )
    for (const candidate of candidates) {
      const action = await this.db.scoped(candidate.workspace_id, async (c) => {
        const project = await one<{ deleting_at: Date | null }>(
          c,
          'SELECT deleting_at FROM projects WHERE id=$1 FOR UPDATE',
          [candidate.project_id]
        )
        const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [
          candidate.job_id,
        ])
        const pending = (
          await c.query<{ generation: string; reason: string }>(
            'SELECT generation,reason FROM cleanup_requests WHERE job_id=$1 AND confirmed_at IS NULL',
            [j.id]
          )
        ).rows[0]
        if (pending)
          return {
            kind: pending.reason === 'lease-recovery' ? 'requeue' : 'terminal',
            generation: pending.generation,
          }
        const now = Date.parse(await clock(c))
        const { security_shutdown } = await one<{ security_shutdown: boolean }>(
          c,
          'SELECT * FROM control_settings'
        )
        let kind = 'preview'
        const actor = await one<{ allowed: boolean }>(c, 'SELECT * FROM worker_actor($1,$2)', [
          j.workspace_id,
          j.created_by,
        ])
        const revoked =
          (
            await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2)', [
              j.policy_digest,
              j.template_digest,
            ])
          ).rowCount !== 0
        if (!isTerminal(j.state)) {
          const expired =
            j.created_at.getTime() + 7 * 86400000 <= now ||
            (j.state === 'QUEUED' && j.created_at.getTime() + 600000 <= now) ||
            (j.review_expires_at !== null && j.review_expires_at.getTime() <= now) ||
            (j.active_deadline_at !== null && j.active_deadline_at.getTime() <= now)
          if (
            !j.cleanup_target &&
            (j.cancel_requested_at ||
              project.deleting_at ||
              security_shutdown ||
              revoked ||
              !actor.allowed ||
              expired)
          ) {
            const target = j.state === 'CANCELLING' ? 'CANCELLED' : expired ? 'EXPIRED' : 'FAILED'
            await requestCleanup(c, j, expired ? 'timeout' : 'failure', target)
          }
          if (j.cleanup_target) kind = 'terminal'
          else {
            const lost = (
              await c.query(
                `SELECT id FROM job_steps WHERE job_id=$1 AND status='running' AND lease_expires_at<=clock_timestamp() FOR UPDATE`,
                [j.id]
              )
            ).rows
            if (lost.length) {
              const uncertain = (
                await c.query(
                  `SELECT p.operation_id FROM provider_attempts p LEFT JOIN fixture_operations o ON o.id=p.operation_id WHERE p.job_id=$1 AND p.state='dispatched' AND (o.state IS DISTINCT FROM 'completed')`,
                  [j.id]
                )
              ).rows
              if (uncertain.length) {
                await c.query(
                  "UPDATE provider_attempts SET state='uncertain' WHERE job_id=$1 AND state='dispatched' AND operation_id=ANY($2::uuid[])",
                  [j.id, uncertain.map((x) => x.operation_id)]
                )
                await requestCleanup(c, j, 'failure', 'FAILED')
                kind = 'terminal'
              } else {
                await c.query(
                  `UPDATE job_steps SET lease_epoch=lease_epoch+1 WHERE job_id=$1 AND status='running' AND lease_expires_at<=clock_timestamp()`,
                  [j.id]
                )
                kind = 'requeue'
              }
            }
          }
        }
        if (kind === 'preview') {
          const due = (
            await c.query(
              `SELECT 1 FROM environments e WHERE e.job_id=$1 AND e.state<>'destroyed' AND (e.expires_at<=clock_timestamp() OR $2 OR EXISTS(SELECT 1 FROM previews p WHERE p.environment_id=e.id AND p.state='READY' AND p.idle_expires_at<=clock_timestamp()))`,
              [j.id, security_shutdown || revoked || !actor.allowed]
            )
          ).rowCount
          if (!due) return null // Another reconciler already completed the enumerated work.
          if (!isTerminal(j.state) && j.state !== 'AWAITING_PROMOTION') {
            await requestCleanup(c, j, 'failure', 'FAILED')
            kind = 'terminal'
          }
        }
        await c.query(
          "UPDATE previews SET state='STOPPING' WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1) AND state='READY'",
          [j.id]
        )
        await c.query(
          'UPDATE preview_tickets SET revoked_at=clock_timestamp() WHERE preview_id IN(SELECT id FROM previews WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1))',
          [j.id]
        )
        const generation = randomUUID()
        await c.query(
          `INSERT INTO cleanup_requests(workspace_id,project_id,job_id,reason,generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO UPDATE SET confirmed_at=NULL,generation=EXCLUDED.generation,reason=EXCLUDED.reason`,
          [
            j.workspace_id,
            j.project_id,
            j.id,
            kind === 'requeue' ? 'lease-recovery' : 'failure',
            generation,
          ]
        )
        return { kind, generation }
      })
      if (!action) continue
      if (!(await this.cleanup.confirm(candidate.job_id))) continue
      await this.db.scoped(candidate.workspace_id, async (c) => {
        await one(c, 'SELECT id FROM projects WHERE id=$1 FOR UPDATE', [candidate.project_id])
        const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [
          candidate.job_id,
        ])
        const pending = (
          await c.query(
            'SELECT generation FROM cleanup_requests WHERE job_id=$1 AND confirmed_at IS NULL FOR UPDATE',
            [j.id]
          )
        ).rows[0]
        if (pending?.generation !== action.generation) return // Late confirmation cannot clean a newer lease or cancellation.
        // No host effects: only fixture records. Cleanup confirmation is required
        // even here so partition/restart behavior can be tested without fiction.
        await destroyFixtureResources(c, j)
        await c.query(
          'UPDATE cleanup_requests SET confirmed_at=clock_timestamp() WHERE job_id=$1',
          [j.id]
        )
        if (isTerminal(j.state)) return
        if (j.cleanup_target) {
          const target =
            j.state === 'CANCELLING' ? 'CANCELLED' : (j.cleanup_target as 'FAILED' | 'EXPIRED')
          // Clear cleanup metadata before terminal immutability takes effect.
          await c.query('UPDATE jobs SET cleanup_target=NULL WHERE id=$1', [j.id])
          j.cleanup_target = null
          await changeState(
            c,
            j,
            target,
            target === 'CANCELLED' ? 'cleanup' : target === 'EXPIRED' ? 'timeout' : 'failure'
          )
          await releaseReservation(c, j)
        } else if (action.kind === 'requeue') {
          await c.query(
            `UPDATE job_steps SET status='queued',lease_owner=NULL,lease_expires_at=NULL,available_at=clock_timestamp() WHERE job_id=$1 AND status='running' AND lease_expires_at<=clock_timestamp()`,
            [j.id]
          )
          await appendEvent(c, j, 'job.state', { from: j.state, to: j.state })
          await flushEventSequence(c, j)
        }
      })
    }
    return candidates.length
  }
  /** Audited operator-only reconciliation of an uncertain fixture liability.
   * E1 has no public endpoint and no live provider pricing authority. */
  async resolveUncertain(workspace: string, jobId: string, operationId: string, amount: number) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid amount')
    return this.db.scoped(workspace, async (c) => {
      const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId])
      const attempt = await one<{
        state: string
        maximum_micros: string
        amount_micros: string | null
        step_id: string
      }>(c, 'SELECT * FROM provider_attempts WHERE operation_id=$1 AND job_id=$2 FOR UPDATE', [
        operationId,
        jobId,
      ])
      if (!isTerminal(j.state)) throw new Error('Resolve only terminal fixture liabilities')
      if (attempt.state === 'resolved') {
        if (number(attempt.amount_micros!) !== amount) throw new Error('Resolution conflict')
        return
      }
      if (
        !['uncertain', 'dispatched'].includes(attempt.state) ||
        amount > number(attempt.maximum_micros)
      )
        throw new Error('Unbounded resolution')
      const r = await one<{ period_start: Date }>(
        c,
        'SELECT period_start FROM usage_reservations WHERE job_id=$1 FOR UPDATE',
        [jobId]
      )
      await c.query(
        'UPDATE workspace_quotas SET reserved_micros=reserved_micros-$3,spent_micros=spent_micros+$3 WHERE workspace_id=$1 AND period_start=$2',
        [workspace, r.period_start, amount]
      )
      await c.query(
        'UPDATE usage_reservations SET settled_micros=settled_micros+$2 WHERE job_id=$1',
        [jobId, amount]
      )
      await c.query(
        "UPDATE provider_attempts SET state='resolved',amount_micros=$2 WHERE operation_id=$1",
        [operationId, amount]
      )
      await c.query(
        `INSERT INTO usage_ledger(id,workspace_id,project_id,job_id,step_id,amount_micros,price_version,classification,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,'fixture-operator-resolution-v1','adjustment',$7)`,
        [
          operationId,
          workspace,
          j.project_id,
          j.id,
          attempt.step_id,
          amount,
          `fixture-resolution:${operationId}`,
        ]
      )
      await c.query(
        `INSERT INTO audit_events(id,workspace_id,actor_kind,actor_id,action,resource_id,request_id,outcome,metadata_json) VALUES($1,$2,'service',$6,'fixture.liability_resolved',$3,$4,'allowed',$5)`,
        [
          randomUUID(),
          workspace,
          j.id,
          randomUUID(),
          { schemaVersion: 1, origin: 'fixture', operationId, amountMicros: amount },
          this.id,
        ]
      )
      if (isTerminal(j.state)) await releaseReservation(c, j)
    })
  }
}
