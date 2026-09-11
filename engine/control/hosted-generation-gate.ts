import { z } from 'zod'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { callTermsSchema } from '../providers/accounting.ts'
import type { CallTerms } from '../providers/accounting.ts'
import { providerPolicySchema } from '../providers/registry.ts'
import type { CallDispatchGate } from '../providers/accounting-postgres.ts'
import type { HostedGenerationContext } from '../generation/hosted-stage.ts'
import { batchBindingSchema } from '../generation/resumable.ts'
import { number, one } from './database.ts'
import type { ControlDatabase, Tx } from './database.ts'
import { ControlError } from './contracts.ts'
import { operationId } from './worker.ts'

const scopeSchema = z.strictObject({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  jobId: z.uuid(),
  stepId: z.uuid(),
  leaseEpoch: z.number().int().positive(),
})
type DispatchScope = z.infer<typeof scopeSchema>

/** The worker's scoped claim is necessary but not sufficient to spend a provider
 * call. Serialize against exact parent/session, global flags, current revision,
 * current key/model, lease, immutable admission policy and daily free allowance.
 * All methods are read/SQL only; never hold these locks over network effects. */
export class HostedGenerationGate implements CallDispatchGate {
  private readonly workerId: string
  constructor(
    private readonly db: ControlDatabase,
    workerId: string
  ) {
    if (db.role !== 'forge_control_worker' || db.environment !== 'hosted')
      throw new Error('HOSTED_WORKER_IDENTITY')
    this.workerId = z.uuid().parse(workerId)
  }
  private async lock(c: Tx, input: DispatchScope) {
    const s = scopeSchema.parse(input)
    // Parent-first matches API session/admission and scoped scheduler lock order.
    await c.query('SELECT authorize_hosted_job($1)', [s.jobId])
    const settings = await one<{
      environment: string
      worker_enabled: boolean
      security_shutdown: boolean
    }>(
      c,
      'SELECT environment,worker_enabled,security_shutdown FROM control_settings WHERE singleton FOR UPDATE'
    )
    if (settings.environment !== 'hosted' || !settings.worker_enabled || settings.security_shutdown)
      throw new ControlError(503, 'WORKER_DISABLED')
    const limits = await one<{ max_daily_calls: number }>(
      c,
      'SELECT max_daily_calls FROM hosted_generation_limits WHERE singleton'
    )
    const today = (
      await one<{ day: string }>(
        c,
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day"
      )
    ).day
    await c.query('INSERT INTO hosted_generation_days(day) VALUES($1) ON CONFLICT DO NOTHING', [
      today,
    ])
    const daily = await one<{ calls: number }>(
      c,
      'SELECT calls FROM hosted_generation_days WHERE day=$1 FOR UPDATE',
      [today]
    )
    const project = await one<{
      revision: string
      head_snapshot_id: string | null
      deleting_at: Date | null
      origin: string
    }>(
      c,
      'SELECT revision,head_snapshot_id,deleting_at,origin FROM projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
      [s.workspaceId, s.projectId]
    )
    const job = await one<Record<string, unknown>>(
      c,
      'SELECT * FROM jobs WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',
      [s.workspaceId, s.projectId, s.jobId]
    )
    const step = await one<Record<string, unknown>>(
      c,
      'SELECT *,lease_expires_at>clock_timestamp() AS live FROM job_steps WHERE workspace_id=$1 AND project_id=$2 AND job_id=$3 AND id=$4 FOR UPDATE',
      [s.workspaceId, s.projectId, s.jobId, s.stepId]
    )
    const binding = await one<Record<string, unknown>>(
      c,
      'SELECT * FROM hosted_job_bindings WHERE workspace_id=$1 AND project_id=$2 AND job_id=$3',
      [s.workspaceId, s.projectId, s.jobId]
    )
    const policy = providerPolicySchema.parse(binding.provider_policy_json)
    const now = Date.parse(
      (await one<{ now: string }>(c, 'SELECT clock_timestamp()::text AS now')).now
    )
    if (
      project.origin !== 'hosted' ||
      job.origin !== 'hosted' ||
      project.deleting_at ||
      job.finished_at ||
      job.cleanup_target ||
      job.cancel_requested_at ||
      project.revision !== job.base_revision ||
      project.head_snapshot_id !== job.base_snapshot_id ||
      step.status !== 'running' ||
      step.lease_owner !== this.workerId ||
      number(step.lease_epoch as string) !== s.leaseEpoch ||
      step.live !== true ||
      step.stage !== job.state ||
      !['PLANNING', 'GENERATING', 'REPAIRING'].includes(String(job.state)) ||
      !job.active_deadline_at ||
      new Date(job.active_deadline_at as Date).getTime() <= now ||
      new Date(job.created_at as Date).getTime() <= now - 7 * 86400000 ||
      policy.price.freeOnly !== true ||
      policy.price.inputMicrosPerMillion !== 0 ||
      policy.price.outputMicrosPerMillion !== 0 ||
      canonicalHash(policy) !== binding.provider_policy_digest ||
      policy.id !== binding.provider ||
      policy.model !== binding.model ||
      Date.parse(policy.price.validFrom) > now ||
      Date.parse(policy.price.expiresAt) <= now
    )
      throw new ControlError(409, 'HOSTED_DISPATCH_FENCED')
    if (
      (
        await c.query('SELECT 1 FROM cleanup_requests WHERE job_id=$1 AND confirmed_at IS NULL', [
          s.jobId,
        ])
      ).rowCount ||
      (
        await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2,$3)', [
          job.policy_digest,
          job.template_digest,
          binding.provider_policy_digest,
        ])
      ).rowCount
    )
      throw new ControlError(409, 'HOSTED_DISPATCH_FENCED')
    const credential = await one<Record<string, unknown>>(
      c,
      'SELECT * FROM provider_credentials WHERE workspace_id=$1 AND id=$2 FOR SHARE',
      [s.workspaceId, binding.credential_id]
    )
    const selected = await c.query(
      `SELECT 1 FROM provider_choices s JOIN provider_validations v ON v.workspace_id=s.workspace_id AND v.credential_id=s.credential_id
      WHERE s.workspace_id=$1 AND s.credential_id=$2 AND v.revision=$3 AND v.model=$4 AND v.free_tier_confirmed
      AND v.checked_at>clock_timestamp()-interval '1 day'`,
      [s.workspaceId, binding.credential_id, binding.credential_revision, binding.model]
    )
    if (
      credential.deleted ||
      !credential.envelope_json ||
      credential.revision !== binding.credential_revision ||
      credential.provider !== policy.id ||
      credential.destination !== policy.endpoint ||
      !selected.rowCount
    )
      throw new ControlError(409, 'HOSTED_CREDENTIAL_REVOKED')
    return { binding, job, step, policy, today, daily, limits, now }
  }
  async lockAndAuthorize(c: Tx, input: CallTerms) {
    const t = callTermsSchema.parse(input)
    const current = await this.lock(c, {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      jobId: t.jobId,
      stepId: t.stepId,
      leaseEpoch: t.leaseEpoch,
    })
    const { binding, job, step, policy, today, daily, limits, now } = current
    const stage = { PLANNING: 'plan', GENERATING: 'files', REPAIRING: 'repair' }[String(job.state)]
    if (
      t.requestId !== operationId(t.jobId, t.stepId, Number(step.attempt)) ||
      t.credentialId !== binding.credential_id ||
      t.credentialRevision !== number(binding.credential_revision as string) ||
      t.policyDigest !== binding.provider_policy_digest ||
      t.provider !== policy.id ||
      t.model !== policy.model ||
      t.destination !== policy.endpoint ||
      canonicalHash(t.price) !== canonicalHash(policy.price) ||
      t.maximumMicros !== 0 ||
      t.repairNumber !== job.repair_count ||
      t.stage !== stage ||
      Date.parse(t.deadlineAt) <= now ||
      Date.parse(t.deadlineAt) > now + 45_000 ||
      Date.parse(t.deadlineAt) > new Date(step.lease_expires_at as Date).getTime() ||
      Date.parse(t.deadlineAt) > new Date(job.active_deadline_at as Date).getTime() ||
      Date.parse(t.deadlineAt) > Date.parse(policy.price.expiresAt)
    )
      throw new ControlError(409, 'HOSTED_PROVIDER_BINDING')
    const prior = await c.query('SELECT 1 FROM provider_attempts WHERE operation_id=$1', [
      t.requestId,
    ])
    if (!prior.rowCount) {
      if (daily.calls >= limits.max_daily_calls)
        throw new ControlError(429, 'FREE_CAPACITY_UNAVAILABLE')
      // Same transaction as reservation; failures roll back, uncertain calls stay
      // counted. A dispatch CAS/replay with an existing attempt is never recharged.
      await c.query('UPDATE hosted_generation_days SET calls=calls+1 WHERE day=$1', [today])
    }
  }
  async withCurrent<T>(context: Readonly<HostedGenerationContext>, fn: (c: Tx) => Promise<T>) {
    return this.db.scoped(context.binding.workspaceId, async (c) => {
      await this.assertCurrentInTransaction(c, context)
      return fn(c)
    })
  }
  /** For fenced outbox settlement only, in the caller's existing scoped E1
   * transaction. The same authorization checks and locks as withCurrent apply. */
  async assertCurrentInTransaction(
    c: Tx,
    context: Readonly<HostedGenerationContext>
  ): Promise<void> {
    const b = batchBindingSchema.parse(context.binding)
    const current = await this.lock(c, {
      workspaceId: b.workspaceId,
      projectId: b.projectId,
      jobId: b.jobId,
      stepId: context.stepId,
      leaseEpoch: context.leaseEpoch,
    })
    if (
      context.operationId !== operationId(b.jobId, context.stepId, Number(current.step.attempt)) ||
      b.credentialId !== current.binding.credential_id ||
      b.credentialRevision !== number(current.binding.credential_revision as string) ||
      b.providerPolicyDigest !== current.binding.provider_policy_digest ||
      b.model !== current.binding.model ||
      b.provider !== current.binding.provider ||
      b.repairNumber !== current.job.repair_count ||
      b.promptVersion !== current.job.prompt_version ||
      sha256(context.instruction) !== current.binding.instruction_digest ||
      canonicalHash(context.preset) !== canonicalHash(current.binding.preset_json) ||
      Date.parse(context.deadlineAt) <= current.now ||
      Date.parse(context.deadlineAt) > new Date(current.step.lease_expires_at as Date).getTime()
    )
      throw new ControlError(409, 'HOSTED_SOURCE_BINDING')
    const source = await one<{ base_manifest_artifact_id: string }>(
      c,
      'SELECT base_manifest_artifact_id FROM job_source_contexts WHERE job_id=$1',
      [b.jobId]
    )
    if (source.base_manifest_artifact_id !== context.base.manifestArtifact.id)
      throw new ControlError(409, 'HOSTED_SOURCE_BINDING')
  }
  async withClaim<T>(scope: DispatchScope, fn: (c: Tx) => Promise<T>) {
    return this.db.scoped(scope.workspaceId, async (c) => {
      await this.lock(c, scope)
      return fn(c)
    })
  }
}
