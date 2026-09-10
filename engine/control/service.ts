import { randomUUID } from 'node:crypto'
import { canonicalHash } from '../contracts/canonical.ts'
import { parseEventCursor, jobEventSchema } from '../contracts/events.ts'
import {
  validateApproval,
  approvalSchema,
  promotionReviewSchema,
  verificationSchema,
} from '../contracts/review.ts'
import { isTerminal } from '../workflows/jobs.ts'
import { ControlDatabase, clock, number, one } from './database.ts'
import type { Tx, Principal } from './database.ts'
import { SessionService } from './identity.ts'
import {
  ControlError,
  keySchema,
  projectInputSchema,
  projectPatchSchema,
  jobInputSchema,
  approveInputSchema,
  modelPolicySchema,
  listSchema,
  restoreInputSchema,
  promoteInputSchema,
} from './contracts.ts'
import { defaultControlCatalog } from './catalog.ts'
import type { ControlCatalog } from './catalog.ts'
import type { SourceRepository } from '../integration/source-repository.ts'
import { prepareSourceExport, readSourceFile } from '../generation/source.ts'
import { planSchema } from '../contracts/source.ts'
import { sourcePath } from '../contracts/paths.ts'
import { scopeOf } from './state.ts'
import {
  appendEvent,
  audit,
  changeState,
  enqueue,
  flushEventSequence,
  releaseReservation,
} from './state.ts'
import type { JobRow } from './state.ts'
export interface ProjectRow {
  id: string
  workspace_id: string
  name: string
  brief: string
  preset_id: string
  preset_version: number
  template_digest: string
  revision: string
  head_snapshot_id: string | null
  deleting_at: Date | null
  origin: 'fixture'
}
export const jobView = (j: JobRow) => ({
  schemaVersion: 1,
  origin: 'fixture',
  id: j.id,
  workspaceId: j.workspace_id,
  projectId: j.project_id,
  state: j.state,
  stateVersion: number(j.state_version),
  baseRevision: number(j.base_revision),
  baseSnapshotId: j.base_snapshot_id,
  reviewDigest: j.review_digest,
  review: j.review_json,
  candidateSnapshotId: j.candidate_snapshot_id,
  cleanupPending: j.cleanup_target !== null,
  finishedAt: j.finished_at?.toISOString() ?? null,
})
export const projectView = (p: ProjectRow) => ({
  id: p.id,
  workspaceId: p.workspace_id,
  name: p.name,
  brief: p.brief,
  presetId: p.preset_id,
  presetVersion: p.preset_version,
  templateId: 'next-postgres-v1',
  revision: number(p.revision),
  headSnapshotId: p.head_snapshot_id,
  origin: 'fixture',
})
export async function idempotent(
  c: Tx,
  p: Principal,
  w: string,
  key: string,
  route: string,
  input: unknown,
  action: () => Promise<{ status: number; body: Record<string, unknown> }>
) {
  keySchema.parse(key)
  const digest = canonicalHash(input)
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${w}:${p.user_id}:${route}:${key}`,
  ])
  const prior = (
    await c.query(
      'SELECT * FROM idempotency_records WHERE workspace_id=$1 AND actor_id=$2 AND route=$3 AND key=$4',
      [w, p.user_id, route, key]
    )
  ).rows[0]
  if (prior && prior.expires_at > new Date()) {
    if (prior.request_digest !== digest) throw new ControlError(409, 'IDEMPOTENCY_CONFLICT')
    return {
      status: prior.response_status as number,
      body: prior.response_json as Record<string, unknown>,
    }
  }
  if (prior)
    await c.query(
      'DELETE FROM idempotency_records WHERE workspace_id=$1 AND actor_id=$2 AND route=$3 AND key=$4',
      [w, p.user_id, route, key]
    )
  const result = await action()
  await c.query(
    `INSERT INTO idempotency_records(workspace_id,actor_id,route,key,request_digest,response_status,response_json,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')`,
    [w, p.user_id, route, key, digest, result.status, result.body]
  )
  return result
}
export class ControlService {
  constructor(
    readonly db: ControlDatabase,
    readonly sessions: SessionService,
    readonly admissionEnabled = false,
    readonly catalog: ControlCatalog = defaultControlCatalog,
    readonly sources?: SourceRepository
  ) {
    if (sources && sources.catalog.manifest.template.digest !== catalog.templateDigest)
      throw new Error('Source catalog mismatch')
  }
  async createProject(token: string, w: string, csrf: string, key: string, input: unknown) {
    const body = projectInputSchema.parse(input)
    this.catalog.assertProject(body.presetId, body.presetVersion)
    return this.db.session(token, w, 'editor', async (c, p) => {
      this.sessions.checkCsrf(p.csrf_hash, csrf)
      return idempotent(c, p, w, key, `POST /workspaces/${w}/projects`, body, async () => {
        const project = await one<ProjectRow>(
          c,
          `INSERT INTO projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            randomUUID(),
            w,
            body.name,
            body.brief,
            body.presetId,
            body.presetVersion,
            body.templateId,
            this.catalog.templateDigest,
          ]
        )
        await audit(c, project, p.user_id, 'project.created')
        return {
          status: 201,
          body: { schemaVersion: 1, origin: 'fixture', project: projectView(project) },
        }
      })
    })
  }
  async listProjects(token: string, w: string, input: unknown) {
    const q = listSchema.parse(input)
    return this.db.session(token, w, 'viewer', async (c) => {
      const rows = (
        await c.query<ProjectRow>(
          'SELECT * FROM projects WHERE deleting_at IS NULL AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
          [q.cursor ?? null, q.limit + 1]
        )
      ).rows
      return {
        schemaVersion: 1,
        origin: 'fixture',
        items: rows.slice(0, q.limit).map(projectView),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      }
    })
  }
  getProject(token: string, id: string) {
    return this.db.resource(token, id, 'project', 'viewer', async (c) => ({
      schemaVersion: 1,
      origin: 'fixture',
      project: projectView(await this.project(c, id)),
    }))
  }
  async project(c: Tx, id: string, lock = false) {
    const p = await one<ProjectRow>(
      c,
      `SELECT * FROM projects WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id]
    )
    if (p.deleting_at) throw new ControlError(404, 'NOT_FOUND')
    return p
  }
  async patchProject(
    token: string,
    id: string,
    csrf: string,
    key: string,
    revision: number,
    input: unknown
  ) {
    const body = projectPatchSchema.parse(input)
    return this.db.resource(token, id, 'project', 'editor', async (c, p, w) => {
      this.sessions.checkCsrf(p.csrf_hash, csrf)
      return idempotent(c, p, w, key, `PATCH /projects/${id}`, { body, revision }, async () => {
        const prior = await this.project(c, id, true)
        if (number(prior.revision) !== revision) throw new ControlError(412, 'REVISION_MISMATCH')
        if (
          (await c.query('SELECT 1 FROM jobs WHERE project_id=$1 AND finished_at IS NULL', [id]))
            .rowCount
        )
          throw new ControlError(409, 'STATE_CONFLICT')
        const result = await one<ProjectRow>(
          c,
          `UPDATE projects SET name=$2,brief=$3,preset_id=$4,preset_version=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [
            id,
            body.name ?? prior.name,
            body.brief ?? prior.brief,
            body.presetId ?? prior.preset_id,
            body.presetVersion ?? prior.preset_version,
          ]
        )
        await audit(c, result, p.user_id, 'project.updated')
        return {
          status: 200,
          body: { schemaVersion: 1, origin: 'fixture', project: projectView(result) },
        }
      })
    })
  }
  async admit(
    token: string,
    id: string,
    csrf: string,
    key: string,
    input: unknown,
    restoreSnapshotId?: string,
    restoreRequest?: ReturnType<typeof restoreInputSchema.parse>
  ) {
    const body = jobInputSchema.parse(input)
    if (!this.admissionEnabled) throw new ControlError(503, 'ADMISSION_DISABLED')
    return this.db.resource(token, id, 'project', 'editor', async (c, p, w) => {
      this.sessions.checkCsrf(p.csrf_hash, csrf)
      return idempotent(
        c,
        p,
        w,
        key,
        restoreRequest ? `POST /projects/${id}/restorations` : `POST /projects/${id}/jobs`,
        restoreRequest
          ? { ...restoreRequest, snapshotId: restoreSnapshotId }
          : { body, restoreSnapshotId: restoreSnapshotId ?? null },
        async () => {
          const settings = await one<{ max_job_micros: string }>(
            c,
            'SELECT * FROM lock_admission()'
          )
          const project = await this.project(c, id, true)
          this.catalog.assertProject(project.preset_id, project.preset_version)
          this.catalog.policy(body.maxCostMicros)
          if (
            number(project.revision) !== body.baseRevision ||
            project.head_snapshot_id !== body.baseSnapshotId
          )
            throw new ControlError(412, 'REVISION_MISMATCH')
          if (project.template_digest !== this.catalog.templateDigest)
            throw new ControlError(409, 'TEMPLATE_REVALIDATION_REQUIRED')
          if (body.maxCostMicros > number(settings.max_job_micros))
            throw new ControlError(429, 'QUOTA_EXCEEDED')
          if (restoreSnapshotId)
            await one(
              c,
              "SELECT id FROM snapshots WHERE id=$1 AND project_id=$2 AND status='verified'",
              [restoreSnapshotId, id]
            )
          const revoked = await c.query('SELECT 1 FROM revoked_policies WHERE digest IN ($1,$2)', [
            this.catalog.templateDigest,
            canonicalHash(this.catalog.policy(body.maxCostMicros)),
          ])
          if (revoked.rowCount) throw new ControlError(409, 'POLICY_REVOKED')
          const quota = await one<{
            period_start: Date
            limit_micros: string
            reserved_micros: string
            spent_micros: string
            max_active_jobs: number
          }>(
            c,
            "SELECT * FROM workspace_quotas WHERE workspace_id=$1 AND period_start<=now() AND period_start>now()-interval '1 day' ORDER BY period_start DESC LIMIT 1 FOR UPDATE",
            [w]
          )
          const active = number(
            (
              await one<{ n: string }>(
                c,
                'SELECT count(*)::text AS n FROM jobs WHERE workspace_id=$1 AND finished_at IS NULL',
                [w]
              )
            ).n
          )
          if (
            active >= quota.max_active_jobs ||
            number(quota.reserved_micros) + number(quota.spent_micros) + body.maxCostMicros >
              number(quota.limit_micros)
          )
            throw new ControlError(429, 'QUOTA_EXCEEDED')
          const idJob = randomUUID(),
            now = await clock(c)
          const policy = modelPolicySchema.parse({
            schemaVersion: 1,
            origin: 'fixture',
            modelPolicyId: 'fixture-v1',
            promptVersion: 'fixture-e1-v1',
            templateDigest: this.catalog.templateDigest,
            policyDigest: canonicalHash(this.catalog.policy(body.maxCostMicros)),
            maxCostMicros: body.maxCostMicros,
            maxAttemptMicros: Math.min(1, body.maxCostMicros),
          })
          const j = await one<JobRow>(
            c,
            `INSERT INTO jobs(id,workspace_id,project_id,created_by,kind,base_snapshot_id,base_revision,request_json,policy_digest,template_digest,prompt_version,model_policy_json,cost_limit_micros,active_remaining_ms,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1200000,$14,$14) RETURNING *`,
            [
              idJob,
              w,
              id,
              p.user_id,
              restoreSnapshotId ? 'restore' : 'generate',
              body.baseSnapshotId,
              body.baseRevision,
              { ...body, ...(restoreSnapshotId ? { restoreSnapshotId } : {}) },
              policy.policyDigest,
              this.catalog.templateDigest,
              policy.promptVersion,
              policy,
              body.maxCostMicros,
              now,
            ]
          )
          await c.query(
            'UPDATE workspace_quotas SET reserved_micros=reserved_micros+$3 WHERE workspace_id=$1 AND period_start=$2',
            [w, quota.period_start, body.maxCostMicros]
          )
          await c.query(
            `INSERT INTO usage_reservations(id,workspace_id,project_id,job_id,reserved_micros,status,expires_at,period_start) VALUES($1,$2,$3,$4,$5,'open',now()+interval '7 days',$6)`,
            [randomUUID(), w, id, idJob, body.maxCostMicros, quota.period_start]
          )
          await enqueue(c, j)
          await appendEvent(c, j, 'job.state', { from: 'QUEUED', to: 'QUEUED' })
          await flushEventSequence(c, j)
          await audit(c, j, p.user_id, 'job.admitted')
          return {
            status: 202,
            body: {
              schemaVersion: 1,
              origin: 'fixture',
              job: jobView(j),
              eventsUrl: `/api/v1/jobs/${j.id}/events`,
            },
          }
        }
      )
    })
  }
  getJob(token: string, id: string) {
    return this.db.resource(token, id, 'job', 'viewer', async (c) => ({
      schemaVersion: 1,
      origin: 'fixture',
      job: jobView(await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [id])),
    }))
  }
  async approve(
    token: string,
    id: string,
    csrf: string,
    key: string,
    input: unknown,
    promotion?: ReturnType<typeof promoteInputSchema.parse>
  ) {
    const body = approveInputSchema.parse(input)
    return this.db.resource(token, id, 'job', 'editor', async (c, p, w) => {
      this.sessions.checkCsrf(p.csrf_hash, csrf)
      return idempotent(
        c,
        p,
        w,
        key,
        promotion ? `POST /jobs/${id}/promote` : `POST /jobs/${id}/approvals`,
        promotion ?? body,
        async () => {
          await c.query('SELECT singleton FROM control_settings FOR SHARE')
          const found = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [id])
          const project = await this.project(c, found.project_id, true)
          const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [id])
          const expectedKind =
            j.state === 'AWAITING_PLAN_APPROVAL'
              ? 'plan'
              : j.state === 'AWAITING_EXECUTION_APPROVAL'
                ? 'execution'
                : j.state === 'AWAITING_PROMOTION'
                  ? 'promotion'
                  : null
          if (
            j.cleanup_target ||
            (
              await c.query(
                'SELECT 1 FROM cleanup_requests WHERE job_id=$1 AND confirmed_at IS NULL',
                [id]
              )
            ).rowCount
          )
            throw new ControlError(409, 'CLEANUP_PENDING')
          if (expectedKind !== body.kind || !j.review_expires_at || !j.review_digest)
            throw new ControlError(409, 'STATE_CONFLICT')
          if (
            number(project.revision) !== number(j.base_revision) ||
            project.head_snapshot_id !== j.base_snapshot_id
          )
            throw new ControlError(409, 'REVISION_MISMATCH')
          const revoked =
            (
              await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2)', [
                j.policy_digest,
                j.template_digest,
              ])
            ).rowCount !== 0
          const now = await clock(c)
          const a = approvalSchema.parse({
            id: randomUUID(),
            workspaceId: w,
            projectId: j.project_id,
            jobId: id,
            actorId: p.user_id,
            ...body,
            createdAt: now,
            expiresAt: j.review_expires_at.toISOString(),
          })
          const context = {
            workspaceId: w,
            projectId: j.project_id,
            jobId: id,
            actorId: p.user_id,
            currentRole: p.role,
            userDisabled: false,
            stateVersion: number(j.state_version),
            subjectDigest: j.review_digest,
            baseRevision: number(project.revision),
            baseSnapshotId: project.head_snapshot_id,
            kind: body.kind,
            now,
            reviewExpiresAt: j.review_expires_at.toISOString(),
            cancelRequested: j.cancel_requested_at !== null,
            policyRevoked: revoked,
            templateDigest: j.template_digest,
            policyDigest: j.policy_digest,
          }
          try {
            validateApproval(a, j.review_json, context)
          } catch {
            throw new ControlError(409, 'STALE_APPROVAL')
          }
          if (body.kind === 'promotion' && body.decision === 'approve') {
            const subject = promotionReviewSchema.parse(j.review_json)
            if (
              promotion &&
              (promotion.snapshotId !== j.candidate_snapshot_id ||
                promotion.verificationDigest !== subject.verificationDigest ||
                promotion.expectedProjectRevision !== number(project.revision))
            )
              throw new ControlError(409, 'STALE_APPROVAL')
            const snapshot = await one<{
              id: string
              manifest_digest: string
              sha256: string
              created_at: Date
            }>(
              c,
              `SELECT s.id,s.manifest_digest,a.sha256,a.created_at FROM snapshots s JOIN artifacts a ON a.id=s.verification_artifact_id WHERE s.id=$1 AND s.job_id=$2 AND s.status='verified' AND s.origin='fixture' AND a.status='available'`,
              [j.candidate_snapshot_id, j.id]
            )
            if (
              snapshot.manifest_digest !== subject.candidateDigest ||
              snapshot.sha256 !== subject.verificationDigest ||
              snapshot.created_at.getTime() <= Date.parse(now) - 86400000
            )
              throw new ControlError(409, 'REVALIDATION_REQUIRED')
            await c.query(
              'UPDATE projects SET head_snapshot_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',
              [j.project_id, snapshot.id]
            )
          }
          await c.query(
            `INSERT INTO approvals(id,workspace_id,project_id,job_id,actor_id,kind,subject_digest,state_version,decision,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              a.id,
              w,
              j.project_id,
              id,
              p.user_id,
              a.kind,
              a.subjectDigest,
              a.stateVersion,
              a.decision,
              a.expiresAt,
              a.createdAt,
            ]
          )
          await appendEvent(c, j, 'approval.recorded', {
            approvalId: a.id,
            kind: a.kind,
            decision: a.decision,
            subjectDigest: a.subjectDigest,
          })
          if (a.decision === 'reject') await this.cancelLocked(c, j)
          else {
            await changeState(
              c,
              j,
              body.kind === 'plan'
                ? 'GENERATING'
                : body.kind === 'execution'
                  ? 'PROVISIONING'
                  : 'SUCCEEDED',
              'approval',
              null,
              { approval: a, subject: j.review_json, context }
            )
            if (j.state === 'SUCCEEDED') await releaseReservation(c, j)
          }
          await audit(
            c,
            j,
            p.user_id,
            a.kind === 'promotion' ? 'source.promoted' : 'approval.recorded'
          )
          return {
            status: 200,
            body: {
              schemaVersion: 1,
              origin: 'fixture',
              job: jobView(j),
              ...(body.kind === 'promotion' && body.decision === 'approve'
                ? { project: projectView(await this.project(c, j.project_id)) }
                : {}),
            },
          }
        }
      )
    })
  }
  async promote(token: string, id: string, csrf: string, key: string, input: unknown) {
    const binding = promoteInputSchema.parse(input)
    // Review history survives terminal immutability, so an identical committed
    // promotion can replay its original idempotency response after review clears.
    const review = await this.db.resource(token, id, 'job', 'editor', async (c) =>
      one<{ subject_digest: string }>(
        c,
        "SELECT subject_digest FROM job_reviews WHERE job_id=$1 AND state_version=$2 AND kind='promotion'",
        [id, binding.stateVersion]
      )
    )
    return this.approve(
      token,
      id,
      csrf,
      key,
      {
        schemaVersion: 1,
        kind: 'promotion',
        decision: 'approve',
        subjectDigest: review.subject_digest,
        stateVersion: binding.stateVersion,
      },
      binding
    )
  }
  async restore(token: string, snapshotId: string, csrf: string, key: string, input: unknown) {
    const body = restoreInputSchema.parse(input)
    const source = await this.db.resource(token, snapshotId, 'snapshot', 'editor', async (c) => {
      const s = await one<{ project_id: string }>(
        c,
        "SELECT project_id FROM snapshots WHERE id=$1 AND status='verified'",
        [snapshotId]
      )
      return this.project(c, s.project_id)
    })
    return this.admit(
      token,
      source.id,
      csrf,
      key,
      {
        schemaVersion: 1,
        kind: 'generate',
        baseSnapshotId: source.head_snapshot_id,
        baseRevision: body.expectedProjectRevision,
        instruction: 'Restore this previously verified synthetic source snapshot.',
        modelPolicyId: 'fixture-v1',
        maxCostMicros: body.maxCostMicros,
      },
      snapshotId,
      body
    )
  }
  deleteProject(token: string, id: string, csrf: string, key: string, revision: number) {
    return this.db.resource(token, id, 'project', 'owner', async (c, p, w) => {
      this.sessions.checkCsrf(p.csrf_hash, csrf)
      return idempotent(
        c,
        p,
        w,
        key,
        `DELETE /projects/${id}`,
        { schemaVersion: 1, expectedProjectRevision: revision },
        async () => {
          const project = await this.project(c, id, true)
          if (number(project.revision) !== revision)
            throw new ControlError(412, 'REVISION_MISMATCH')
          const jobs = (
            await c.query<JobRow>(
              'SELECT * FROM jobs WHERE project_id=$1 AND finished_at IS NULL FOR UPDATE',
              [id]
            )
          ).rows
          for (const j of jobs) await this.cancelLocked(c, j)
          await c.query(
            'UPDATE projects SET deleting_at=clock_timestamp(),revision=revision+1 WHERE id=$1',
            [id]
          )
          await c.query(
            "UPDATE previews SET state='STOPPING' WHERE project_id=$1 AND state='READY'",
            [id]
          )
          await c.query(
            "UPDATE environments SET expires_at=clock_timestamp() WHERE project_id=$1 AND state<>'destroyed'",
            [id]
          )
          await audit(c, project, p.user_id, 'project.deleting')
          return {
            status: 202,
            body: { schemaVersion: 1, origin: 'fixture', projectId: id, state: 'deleting' },
          }
        }
      )
    })
  }
  async cancelLocked(c: Tx, j: JobRow) {
    if (isTerminal(j.state) || j.state === 'CANCELLING') return
    await changeState(c, j, 'CANCELLING', 'cancel')
    await c.query("UPDATE jobs SET cleanup_target='CANCELLED' WHERE id=$1", [j.id])
    j.cleanup_target = 'CANCELLED'
    await c.query(
      `UPDATE job_steps SET status='cancelled',finished_at=clock_timestamp(),lease_epoch=lease_epoch+1,lease_owner=NULL,lease_expires_at=NULL WHERE job_id=$1 AND status IN('queued','running')`,
      [j.id]
    )
    await c.query(
      `UPDATE previews SET state='STOPPING' WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1) AND state IN('REQUESTED','STARTING','READY')`,
      [j.id]
    )
    await c.query(
      `UPDATE preview_tickets SET revoked_at=clock_timestamp() WHERE preview_id IN(SELECT id FROM previews WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1))`,
      [j.id]
    )
    await c.query(
      `INSERT INTO cleanup_requests(workspace_id,project_id,job_id,reason) VALUES($1,$2,$3,'cancel') ON CONFLICT(job_id) DO UPDATE SET reason='cancel',confirmed_at=NULL,generation=EXCLUDED.generation`,
      [j.workspace_id, j.project_id, j.id]
    )
  }
  cancel(token: string, id: string, csrf: string, key: string) {
    return this.db.resource(token, id, 'job', 'editor', async (c, p, w) => {
      this.sessions.checkCsrf(p.csrf_hash, csrf)
      return idempotent(c, p, w, key, `POST /jobs/${id}/cancel`, { schemaVersion: 1 }, async () => {
        const prior = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [id])
        await this.project(c, prior.project_id, true)
        const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [id])
        await this.cancelLocked(c, j)
        await audit(c, j, p.user_id, 'job.cancel_requested')
        return {
          status: isTerminal(j.state) ? 200 : 202,
          body: { schemaVersion: 1, origin: 'fixture', job: jobView(j) },
        }
      })
    })
  }
  async events(token: string, id: string, cursor: string | undefined) {
    return this.db.resource(token, id, 'job', 'viewer', async (c) => {
      const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [id])
      let seq = 0
      try {
        seq = cursor ? parseEventCursor(cursor, id, number(j.next_event_seq) - 1) : 0
      } catch {
        throw new ControlError(422, 'INVALID_EVENT_CURSOR')
      }
      const retained = await one<{ seq: string | null }>(
        c,
        "SELECT min(seq)::text AS seq FROM job_events WHERE job_id=$1 AND created_at>=clock_timestamp()-interval '30 days'",
        [id]
      )
      const earliest = Math.max(
        number(j.earliest_event_seq),
        retained.seq ? number(retained.seq) : number(j.next_event_seq)
      )
      if (seq < earliest - 1)
        throw new ControlError(410, 'EVENT_CURSOR_EXPIRED', false, {
          earliestSeq: earliest,
          stateUrl: `/api/v1/jobs/${id}`,
          replayRequired: true,
        })
      const rows = (
        await c.query(
          'SELECT payload_json FROM job_events WHERE job_id=$1 AND seq>$2 ORDER BY seq LIMIT 100',
          [id, seq]
        )
      ).rows
      return {
        events: rows.map((r) => jobEventSchema.parse(r.payload_json)),
        terminal: isTerminal(j.state),
        latestSeq: number(j.next_event_seq) - 1,
        earliestSeq: earliest,
      }
    })
  }
  snapshots(token: string, id: string, input: unknown = {}) {
    const q = listSchema.parse(input)
    return this.db.resource(token, id, 'project', 'viewer', async (c) => {
      const rows = (
        await c.query(
          'SELECT id,parent_id,manifest_digest,status,origin,created_at FROM snapshots WHERE project_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
          [id, q.cursor ?? null, q.limit + 1]
        )
      ).rows
      return {
        schemaVersion: 1,
        origin: 'fixture',
        items: rows.slice(0, q.limit),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      }
    })
  }
  /** Authorized read snapshots are fenced again after immutable object I/O. */
  async plan(token: string, jobId: string) {
    const load = () =>
      this.db.resource(token, jobId, 'job', 'viewer', async (c) => {
        const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [jobId])
        if (!j.plan_artifact_id) throw new ControlError(409, 'PLAN_UNAVAILABLE')
        const { payload_json } = await one<{ payload_json: unknown }>(
          c,
          'SELECT payload_json FROM fixture_artifact_payloads WHERE artifact_id=$1',
          [j.plan_artifact_id]
        )
        return {
          scope: scopeOf(j),
          plan: planSchema.parse(payload_json),
          artifact: this.sources ? await this.sources.ref(c, scopeOf(j), j.plan_artifact_id) : null,
          stateVersion: number(j.state_version),
          reviewDigest: j.review_digest,
        }
      })
    const before = await load()
    if (this.sources && before.artifact)
      await this.sources.store.read(before.scope, before.artifact)
    if (canonicalHash(before) !== canonicalHash(await load()))
      throw new ControlError(409, 'READ_CHANGED')
    return {
      schemaVersion: 1,
      origin: 'fixture',
      plan: before.plan,
      planDigest: canonicalHash(before.plan),
      stateVersion: before.stateVersion,
      reviewDigest: before.reviewDigest,
    }
  }
  async changes(token: string, jobId: string) {
    const sources = this.sources
    if (!sources) throw new ControlError(409, 'SOURCE_UNAVAILABLE')
    const load = () =>
      this.db.resource(token, jobId, 'job', 'viewer', async (c) => {
        const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [jobId])
        if (!j.candidate_snapshot_id) throw new ControlError(409, 'SOURCE_UNAVAILABLE')
        const binding = await one<{ diff_artifact_id: string }>(
          c,
          'SELECT diff_artifact_id FROM job_source_contexts WHERE job_id=$1',
          [jobId]
        )
        const evidence = (
          await c.query<{ sha256: string; payload_json: unknown }>(
            `SELECT a.sha256,p.payload_json FROM snapshots s
        JOIN artifacts a ON a.id=s.verification_artifact_id AND a.status='available' AND a.kind='verification'
        JOIN fixture_artifact_payloads p ON p.artifact_id=a.id WHERE s.id=$1`,
            [j.candidate_snapshot_id]
          )
        ).rows[0]
        const verification = evidence ? verificationSchema.parse(evidence.payload_json) : null
        if (evidence && canonicalHash(verification) !== evidence.sha256)
          throw new ControlError(409, 'READ_CHANGED')
        return {
          scope: scopeOf(j),
          snapshotId: j.candidate_snapshot_id,
          source: await sources.snapshot(c, scopeOf(j), j.candidate_snapshot_id),
          diff: await sources.ref(c, scopeOf(j), binding.diff_artifact_id),
          verification,
          verificationDigest: evidence?.sha256 ?? null,
          stateVersion: number(j.state_version),
          reviewDigest: j.review_digest,
        }
      })
    const before = await load()
    await sources.validate(before.scope, before.source)
    const bytes = await sources.store.read(before.scope, before.diff)
    if (canonicalHash(before) !== canonicalHash(await load()))
      throw new ControlError(409, 'READ_CHANGED')
    return {
      schemaVersion: 1,
      origin: 'fixture',
      snapshotId: before.snapshotId,
      manifest: before.source.manifest,
      manifestDigest: canonicalHash(before.source.manifest),
      verification: before.verification,
      verificationDigest: before.verificationDigest,
      diff: {
        artifactId: before.diff.id,
        sha256: before.diff.sha256,
        bytes: before.diff.bytes,
        unified: Buffer.from(bytes).toString('utf8'),
      },
      stateVersion: before.stateVersion,
      reviewDigest: before.reviewDigest,
    }
  }
  private async sourceRead(
    token: string,
    snapshotId: string,
    role: 'viewer' | 'editor' = 'viewer'
  ) {
    const sources = this.sources
    if (!sources) throw new ControlError(409, 'SOURCE_UNAVAILABLE')
    return this.db.resource(token, snapshotId, 'snapshot', role, async (c) => {
      const s = await one<{
        workspace_id: string
        project_id: string
        job_id: string
        status: string
        verification_artifact_id: string | null
      }>(c, 'SELECT * FROM snapshots WHERE id=$1', [snapshotId])
      await this.project(c, s.project_id)
      const scope = { workspaceId: s.workspace_id, projectId: s.project_id, jobId: s.job_id }
      return {
        scope,
        source: await sources.snapshot(c, scope, snapshotId),
        status: s.status,
        verificationArtifactId: s.verification_artifact_id,
      }
    })
  }
  async files(token: string, snapshotId: string) {
    const loaded = await this.sourceRead(token, snapshotId)
    return {
      schemaVersion: 1,
      origin: 'fixture',
      snapshotId,
      manifestDigest: canonicalHash(loaded.source.manifest),
      files: loaded.source.manifest.files.map(({ path, sha256, bytes, mediaType }) => ({
        path,
        sha256,
        bytes,
        mediaType,
      })),
    }
  }
  async file(token: string, snapshotId: string, path: string) {
    sourcePath.parse(path)
    const loaded = await this.sourceRead(token, snapshotId)
    const file = loaded.source.manifest.files.find((f) => f.path === path)
    if (!file) throw new ControlError(404, 'NOT_FOUND')
    const bytes = await readSourceFile(this.sources!.store, loaded.scope, loaded.source, path)
    if (canonicalHash(loaded) !== canonicalHash(await this.sourceRead(token, snapshotId)))
      throw new ControlError(409, 'READ_CHANGED')
    return {
      schemaVersion: 1,
      origin: 'fixture',
      snapshotId,
      path,
      sha256: file.sha256,
      mediaType: file.mediaType,
      bytes,
      manifestDigest: canonicalHash(loaded.source.manifest),
    }
  }
  private async exportEligibility(c: Tx, snapshotId: string) {
    if (!this.sources) throw new ControlError(409, 'SOURCE_UNAVAILABLE')
    await c.query('SELECT singleton FROM control_settings FOR SHARE')
    const row = await one<{ manifest_digest: string; verification_digest: string }>(
      c,
      `SELECT s.manifest_digest,a.sha256 AS verification_digest FROM snapshots s JOIN artifacts a ON a.id=s.verification_artifact_id
       JOIN jobs j ON j.id=s.job_id WHERE s.id=$1 AND s.status='verified' AND s.origin='fixture' AND a.status='available'
       AND a.created_at>clock_timestamp()-interval '24 hours' AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp())
       AND s.template_digest=$3 AND j.policy_digest=$4
       AND NOT EXISTS(SELECT 1 FROM control_settings WHERE security_shutdown)
       AND NOT EXISTS(SELECT 1 FROM revoked_policies r WHERE r.digest IN(s.template_digest,j.policy_digest,$2))`,
      [
        snapshotId,
        this.sources.scanPolicyDigest,
        this.sources.catalog.manifest.template.digest,
        this.sources.catalog.manifest.commandPolicyDigest,
      ]
    )
    return row
  }
  /** Scanner/object I/O is outside transactions. Concurrent retries may produce
   * orphan objects, but one idempotent transaction adopts exactly one attachment. */
  async sourceExport(token: string, snapshotId: string, csrf: string, key: string) {
    keySchema.parse(key)
    const sources = this.sources
    if (!sources) throw new ControlError(409, 'SOURCE_UNAVAILABLE')
    const route = `POST /snapshots/${snapshotId}/exports`
    const input = { schemaVersion: 1, snapshotId, scanPolicyDigest: sources.scanPolicyDigest }
    const preflight = await this.db.resource(
      token,
      snapshotId,
      'snapshot',
      'editor',
      async (c, p, w) => {
        this.sessions.checkCsrf(p.csrf_hash, csrf)
        await this.exportEligibility(c, snapshotId)
        const prior = (
          await c.query<{
            request_digest: string
            response_json: { artifactId: string; jobId: string }
          }>(
            'SELECT request_digest,response_json FROM idempotency_records WHERE workspace_id=$1 AND actor_id=$2 AND route=$3 AND key=$4 AND expires_at>clock_timestamp()',
            [w, p.user_id, route, key]
          )
        ).rows[0]
        if (prior && prior.request_digest !== canonicalHash(input))
          throw new ControlError(409, 'IDEMPOTENCY_CONFLICT')
        return prior?.response_json
      }
    )
    if (preflight) return this.exportAttachment(token, preflight.jobId, preflight.artifactId)
    const before = await this.sourceRead(token, snapshotId, 'editor')
    const result = await prepareSourceExport(
      sources.store,
      before.scope,
      sources.catalog,
      before.source,
      sources.scan
    )
    const committed = await this.db.resource(
      token,
      snapshotId,
      'snapshot',
      'editor',
      async (c, p, w) => {
        this.sessions.checkCsrf(p.csrf_hash, csrf)
        const eligible = await this.exportEligibility(c, snapshotId)
        if (eligible.manifest_digest !== canonicalHash(before.source.manifest))
          throw new ControlError(409, 'READ_CHANGED')
        return idempotent(c, p, w, key, route, input, async () => {
          const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [before.scope.jobId])
          await sources.adoptRef(c, j, result.artifact)
          await c.query(
            `INSERT INTO source_exports(workspace_id,project_id,artifact_id,snapshot_id,scan_policy_digest,verification_digest,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '24 hours')`,
            [
              w,
              before.scope.projectId,
              result.artifact.id,
              snapshotId,
              sources.scanPolicyDigest,
              eligible.verification_digest,
            ]
          )
          await audit(c, j, p.user_id, 'source.exported')
          return {
            status: 201,
            body: {
              schemaVersion: 1,
              origin: 'fixture',
              artifactId: result.artifact.id,
              jobId: j.id,
            },
          }
        })
      }
    )
    return this.exportAttachment(
      token,
      String(committed.body.jobId),
      String(committed.body.artifactId)
    )
  }
  private async exportAttachment(token: string, jobId: string, artifactId: string) {
    const attachment = await this.artifactAttachment(token, jobId, artifactId)
    return {
      schemaVersion: 1,
      origin: 'fixture',
      snapshotId: attachment.snapshotId!,
      manifestDigest: attachment.manifestDigest!,
      jobId,
      artifactId,
      sha256: attachment.sha256,
      bytes: attachment.bytes,
    }
  }
  async artifactAttachmentById(token: string, artifactId: string) {
    const jobId = await this.db.resource(token, artifactId, 'artifact', 'viewer', async (c) => {
      const row = await one<{ job_id: string | null }>(
        c,
        "SELECT job_id FROM artifacts WHERE id=$1 AND status='available'",
        [artifactId]
      )
      if (!row.job_id) throw new ControlError(404, 'NOT_FOUND')
      return row.job_id
    })
    return this.artifactAttachment(token, jobId, artifactId)
  }
  async artifactAttachment(token: string, jobId: string, artifactId: string) {
    const sources = this.sources
    if (!sources) throw new ControlError(409, 'SOURCE_UNAVAILABLE')
    const load = () =>
      this.db.resource(token, jobId, 'job', 'viewer', async (c, p) => {
        const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [jobId])
        await this.project(c, j.project_id)
        const ref = await sources.ref(c, scopeOf(j), artifactId)
        if (ref.jobId !== jobId) throw new ControlError(404, 'NOT_FOUND')
        let snapshotId: string | null = null,
          manifestDigest: string | null = null
        if (ref.kind === 'source-export') {
          if (p.role === 'viewer') throw new ControlError(403, 'FORBIDDEN')
          const binding = await one<{ snapshot_id: string; verification_digest: string }>(
            c,
            'SELECT snapshot_id,verification_digest FROM source_exports WHERE artifact_id=$1 AND scan_policy_digest=$2 AND expires_at>clock_timestamp()',
            [artifactId, sources.scanPolicyDigest]
          )
          const eligibility = await this.exportEligibility(c, binding.snapshot_id)
          if (eligibility.verification_digest !== binding.verification_digest)
            throw new ControlError(409, 'REVALIDATION_REQUIRED')
          snapshotId = binding.snapshot_id
          manifestDigest = eligibility.manifest_digest
        }
        return { scope: scopeOf(j), ref, snapshotId, manifestDigest }
      })
    const before = await load()
    const bytes = await sources.store.read(before.scope, before.ref)
    if (canonicalHash(before) !== canonicalHash(await load()))
      throw new ControlError(409, 'READ_CHANGED')
    return {
      schemaVersion: 1,
      origin: 'fixture',
      artifactId,
      kind: before.ref.kind,
      sha256: before.ref.sha256,
      bytes,
      snapshotId: before.snapshotId,
      manifestDigest: before.manifestDigest,
    }
  }
  artifact(token: string, jobId: string, artifactId: string) {
    return this.db.resource(token, jobId, 'job', 'viewer', async (c) => ({
      schemaVersion: 1,
      origin: 'fixture',
      artifact: await one(
        c,
        `SELECT a.id,a.kind,a.sha256,p.payload_json FROM artifacts a JOIN fixture_artifact_payloads p ON p.artifact_id=a.id WHERE a.id=$1 AND a.job_id=$2 AND a.status='available'`,
        [artifactId, jobId]
      ),
    }))
  }
}
