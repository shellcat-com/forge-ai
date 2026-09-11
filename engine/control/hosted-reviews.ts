import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { artifactRefSchema } from '../artifacts/store.ts'
import type { ArtifactStore } from '../artifacts/store.ts'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { approvalSchema, planReviewSchema, validateApproval } from '../contracts/review.ts'
import { planSchema } from '../contracts/source.ts'
import { providerPolicySchema } from '../providers/registry.ts'
import { enqueueDispatch } from '../scheduling/outbox.ts'
import { ControlError } from './contracts.ts'
import { clock, number, one } from './database.ts'
import type { ControlDatabase, Tx } from './database.ts'
import type { HostedIdentityBridge } from './hosted-identity.ts'
import { idempotent } from './service.ts'
import { appendEvent, audit, changeState, scopeOf } from './state.ts'
import type { JobRow } from './state.ts'

const approvalInput = z.strictObject({
  schemaVersion: z.literal(1),
  stateVersion: z.number().int().positive(),
  subjectDigest: z.string().regex(/^[a-f0-9]{64}$/),
})

/** Owner-only plan reading and explicit approval. Object I/O is outside SQL
 * transactions; approval commits exact review, state, step and outbox together.
 * No generated execution, automatic approval, publish or HTTP route is installed. */
export class HostedReviews {
  constructor(
    private readonly db: ControlDatabase,
    private readonly bridge: HostedIdentityBridge,
    private readonly store: ArtifactStore
  ) {
    if (
      db.role !== 'forge_control_api' ||
      db.environment !== 'hosted' ||
      store.evidence !== 'durable'
    )
      throw new Error('HOSTED_REVIEW_CONFIGURATION')
  }
  private async metadata(c: Tx, workspace: string, jobId: string) {
    const job = await one<JobRow>(
      c,
      `SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id AND p.workspace_id=j.workspace_id
      WHERE j.id=$1 AND j.workspace_id=$2 AND j.origin='hosted' AND p.origin='hosted' AND p.deleting_at IS NULL`,
      [jobId, workspace]
    )
    if (!job.plan_artifact_id) throw new ControlError(409, 'PLAN_UNAVAILABLE')
    const row = await one<Record<string, unknown>>(
      c,
      `SELECT * FROM artifacts WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND job_id=$4
      AND kind='plan' AND status='available' AND (expires_at IS NULL OR expires_at>clock_timestamp())`,
      [job.plan_artifact_id, workspace, job.project_id, job.id]
    )
    const ref = artifactRefSchema.parse({
      schemaVersion: 1,
      ...scopeOf(job),
      id: row.id,
      kind: 'plan',
      sha256: row.sha256,
      bytes: Number(row.bytes),
      storageKey: row.object_key,
      storageVersion: row.object_version,
      state: 'available',
      backendEvidence: 'durable',
    })
    return { ref, job }
  }
  async plan(token: string, workspace: string, jobId: string) {
    z.uuid().parse(jobId)
    const load = () =>
      this.db.session(token, workspace, 'owner', async (c) => {
        const { ref, job } = await this.metadata(c, workspace, jobId)
        return {
          ref,
          state: job.state,
          stateVersion: number(job.state_version),
          reviewDigest: job.review_digest,
          review:
            job.state === 'AWAITING_PLAN_APPROVAL' ? planReviewSchema.parse(job.review_json) : null,
        }
      })
    const before = await load()
    const plan = planSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await this.store.read(
            { workspaceId: before.ref.workspaceId, projectId: before.ref.projectId, jobId },
            before.ref
          )
        )
      )
    )
    if (
      canonicalHash(plan) !== before.ref.sha256 ||
      canonicalHash(before) !== canonicalHash(await load())
    )
      throw new ControlError(409, 'READ_CHANGED')
    return {
      schemaVersion: 1 as const,
      origin: 'hosted' as const,
      jobId,
      plan,
      planDigest: before.ref.sha256,
      state: before.state,
      stateVersion: before.stateVersion,
      reviewDigest: before.reviewDigest,
      review: before.review,
    }
  }
  async approvePlan(
    token: string,
    workspace: string,
    csrf: string,
    jobId: string,
    key: string,
    input: unknown
  ) {
    const body = approvalInput.parse(input)
    // Never hold admission locks over decryption/storage transport. A second
    // current metadata binding check below prevents stale approval after I/O.
    const observed = await this.plan(token, workspace, jobId)
    return this.db.session(token, workspace, 'owner', async (c, actor) => {
      this.bridge.checkCsrf(actor.csrf_hash, csrf)
      return idempotent(
        c,
        actor,
        workspace,
        key,
        `POST /hosted/jobs/${jobId}/plan-approval`,
        body,
        async () => {
          const settings = await one<{
            environment: string
            worker_enabled: boolean
            max_job_micros: string
          }>(c, 'SELECT * FROM lock_admission()')
          if (
            settings.environment !== 'hosted' ||
            !settings.worker_enabled ||
            number(settings.max_job_micros) !== 0
          )
            throw new ControlError(503, 'HOSTED_GENERATION_UNAVAILABLE')
          const hint = await one<{ project_id: string }>(
            c,
            "SELECT project_id FROM jobs WHERE id=$1 AND workspace_id=$2 AND origin='hosted'",
            [jobId, workspace]
          )
          const project = await one<{ revision: string; head_snapshot_id: string | null }>(
            c,
            "SELECT revision,head_snapshot_id FROM projects WHERE id=$1 AND workspace_id=$2 AND origin='hosted' AND deleting_at IS NULL FOR UPDATE",
            [hint.project_id, workspace]
          )
          const job = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId])
          const binding = await one<Record<string, unknown>>(
            c,
            'SELECT * FROM hosted_job_bindings WHERE job_id=$1',
            [jobId]
          )
          if (job.created_by !== actor.user_id || binding.parent_session_hash !== sha256(token))
            throw new ControlError(409, 'JOB_SESSION_CHANGED')
          const policy = providerPolicySchema.parse(binding.provider_policy_json),
            at = await clock(c)
          if (
            canonicalHash(policy) !== binding.provider_policy_digest ||
            !policy.price.freeOnly ||
            policy.price.inputMicrosPerMillion !== 0 ||
            policy.price.outputMicrosPerMillion !== 0 ||
            Date.parse(policy.price.validFrom) > Date.parse(at) ||
            Date.parse(policy.price.expiresAt) <= Date.parse(at)
          )
            throw new ControlError(409, 'MODEL_REVALIDATION_REQUIRED')
          const selected = await c.query(
            `SELECT 1 FROM provider_choices s JOIN provider_credentials k ON k.workspace_id=s.workspace_id AND k.id=s.credential_id
          JOIN provider_validations v ON v.workspace_id=k.workspace_id AND v.credential_id=k.id AND v.revision=k.revision
          WHERE s.workspace_id=$1 AND k.id=$2 AND k.revision=$3 AND k.provider=$4 AND k.destination=$5 AND NOT k.deleted
          AND v.model=$6 AND v.free_tier_confirmed AND v.checked_at>clock_timestamp()-interval '1 day' FOR SHARE OF k`,
            [
              workspace,
              binding.credential_id,
              binding.credential_revision,
              policy.id,
              policy.endpoint,
              policy.model,
            ]
          )
          if (!selected.rowCount) throw new ControlError(409, 'HOSTED_CREDENTIAL_REVOKED')
          const revoked = !!(
            await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2,$3)', [
              job.policy_digest,
              job.template_digest,
              binding.provider_policy_digest,
            ])
          ).rowCount
          if (
            job.state !== 'AWAITING_PLAN_APPROVAL' ||
            job.finished_at ||
            job.cleanup_target ||
            job.cancel_requested_at ||
            !job.review_expires_at ||
            !job.review_digest ||
            job.state_version !== String(body.stateVersion)
          )
            throw new ControlError(409, 'STALE_APPROVAL')
          const subject = planReviewSchema.parse(job.review_json)
          const { ref } = await this.metadata(c, workspace, jobId)
          if (subject.planDigest !== observed.planDigest || ref.sha256 !== observed.planDigest)
            throw new ControlError(409, 'READ_CHANGED')
          const approval = approvalSchema.parse({
            ...body,
            ...scopeOf(job),
            id: randomUUID(),
            actorId: actor.user_id,
            kind: 'plan',
            decision: 'approve',
            createdAt: at,
            expiresAt: job.review_expires_at.toISOString(),
          })
          const context = {
            ...scopeOf(job),
            actorId: actor.user_id,
            currentRole: actor.role,
            userDisabled: false,
            stateVersion: number(job.state_version),
            subjectDigest: job.review_digest,
            baseRevision: number(project.revision),
            baseSnapshotId: project.head_snapshot_id,
            kind: 'plan',
            now: at,
            reviewExpiresAt: job.review_expires_at.toISOString(),
            cancelRequested: false,
            policyRevoked: revoked,
            templateDigest: job.template_digest,
            policyDigest: job.policy_digest,
          }
          try {
            validateApproval(approval, subject, context)
          } catch {
            throw new ControlError(409, 'STALE_APPROVAL')
          }
          await c.query(
            `INSERT INTO approvals(id,workspace_id,project_id,job_id,actor_id,kind,subject_digest,state_version,decision,expires_at,created_at)
          VALUES($1,$2,$3,$4,$5,'plan',$6,$7,'approve',$8,$9)`,
            [
              approval.id,
              workspace,
              job.project_id,
              jobId,
              actor.user_id,
              approval.subjectDigest,
              approval.stateVersion,
              approval.expiresAt,
              at,
            ]
          )
          await appendEvent(c, job, 'approval.recorded', {
            approvalId: approval.id,
            kind: 'plan',
            decision: 'approve',
            subjectDigest: approval.subjectDigest,
          })
          await changeState(
            c,
            job,
            'GENERATING',
            'approval',
            null,
            { approval, subject, context },
            at
          )
          await enqueueDispatch(c, actor, job.id, {
            schemaVersion: 1,
            dispatchId: randomUUID(),
            workspaceId: workspace,
            jobId,
            expiresAt: new Date(Date.parse(at) + 14 * 60000).toISOString(),
          })
          await audit(c, job, actor.user_id, 'approval.recorded')
          return {
            status: 200,
            body: {
              schemaVersion: 1,
              origin: 'hosted',
              jobId,
              state: job.state,
              stateVersion: number(job.state_version),
            },
          }
        }
      )
    })
  }
}
