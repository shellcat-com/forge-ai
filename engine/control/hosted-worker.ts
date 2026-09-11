import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { isGeneratedPath } from '../contracts/paths.ts'
import { commandPolicySchema, planReviewSchema, validateApproval } from '../contracts/review.ts'
import type { ExecutionReviewV1 } from '../contracts/review.ts'
import type { PlanV1 } from '../contracts/source.ts'
import { artifactRefSchema } from '../artifacts/store.ts'
import type { ArtifactRef, ArtifactStore } from '../artifacts/store.ts'
import type { TemplateCatalog } from '../generation/catalog.ts'
import { HostedGenerationStage } from '../generation/hosted-stage.ts'
import type { HostedGenerationContext } from '../generation/hosted-stage.ts'
import { batchBindingSchema } from '../generation/resumable.ts'
import { createTemplateSource, readSourceFile, validateStoredSource } from '../generation/source.ts'
import type { StoredSource } from '../generation/source.ts'
import { providerPolicySchema } from '../providers/registry.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import { PostgresCallAccounting } from '../providers/accounting-postgres.ts'
import type { CredentialCipher } from '../providers/credentials.ts'
import { PostgresSchedulerOutbox } from '../scheduling/outbox.ts'
import type { StepClaim } from '../scheduling/outbox.ts'
import type { BoundedControlStep } from '../scheduling/handler.ts'
import { parseCommand } from '../scheduling/protocol.ts'
import type { StepCommand, StepResult } from '../scheduling/protocol.ts'
import { validateMigrationSql } from '../validation/migrations.ts'
import { clock, number, one } from './database.ts'
import type { ControlDatabase, Tx } from './database.ts'
import { HostedGenerationGate } from './hosted-generation-gate.ts'
import { HostedProducts } from './hosted-products.ts'
import { appendEvent, changeState, enqueue, flushEventSequence, scopeOf } from './state.ts'
import type { JobRow } from './state.ts'

export interface HostedSourceWorkerConfig {
  /** Explicit opt-in; mounting a route or setting a database flag is insufficient. */
  enabled?: boolean
  db: ControlDatabase
  store: ArtifactStore
  catalog: TemplateCatalog
  registry: ProviderRegistry
  cipher: CredentialCipher
  commandPolicy: ExecutionReviewV1['commandPolicy']
  templateGuidance: string
  /** Operator-composed independent static checks, never generated scripts.
   * Required even though dynamic validation/execution remains a separate stage. */
  scan(
    files: readonly { path: string; bytes: Uint8Array }[],
    digest: string,
    signal: AbortSignal
  ): Promise<void>
}
const continuing: StepResult = { schemaVersion: 1, state: 'continue', retryAfterSeconds: 5 }
const waiting: StepResult = {
  schemaVersion: 1,
  state: 'awaiting-approval',
  retryAfterSeconds: 0,
}
const supported = ['QUEUED', 'PLANNING', 'GENERATING']
const failure = (code: string): never => {
  throw new Error(code)
}

/** Bounded, source-only composition of the existing hosted stage and E1 outbox.
 * No listener, scheduler delivery, runner, synthetic provider, automatic approval,
 * publish, host execution or environment-variable credential fallback is installed.
 * A started receipt with unknown outcome must be reconciled, never re-dispatched.
 */
export class HostedSourceWorker implements BoundedControlStep {
  private readonly config: HostedSourceWorkerConfig
  private readonly outbox: PostgresSchedulerOutbox
  private checked?: Promise<void>
  constructor(config: HostedSourceWorkerConfig) {
    if (
      config.db.role !== 'forge_control_worker' ||
      config.db.environment !== 'hosted' ||
      config.store.evidence !== 'durable' ||
      config.catalog.evidence !== 'release' ||
      typeof config.scan !== 'function'
    )
      failure('HOSTED_WORKER_CONFIGURATION')
    const policy = commandPolicySchema.parse(config.commandPolicy)
    if (
      canonicalHash(policy) !== config.catalog.manifest.commandPolicyDigest ||
      policy.resources.maxCostMicros !== 0
    )
      failure('HOSTED_WORKER_POLICY')
    this.config = {
      ...config,
      commandPolicy: policy,
      templateGuidance: z.string().min(1).max(12000).parse(config.templateGuidance),
    }
    this.outbox = new PostgresSchedulerOutbox(config.db)
  }
  async execute(raw: Readonly<StepCommand>, signal: AbortSignal): Promise<StepResult> {
    if (this.config.enabled !== true) failure('HOSTED_SOURCE_WORKER_DISABLED')
    signal.throwIfAborted()
    this.checked ??= this.config.db.check().catch((error) => {
      this.checked = undefined
      throw error
    })
    await this.checked
    signal.throwIfAborted()
    const command = parseCommand(structuredClone(raw))
    // A replay after reaching a review is still handled by the outbox. Preflight
    // only excludes foreign/fixture jobs; begin performs the authoritative claim.
    await this.config.db.scoped(command.workspaceId, async (c) => {
      await c.query('SELECT authorize_scheduler_dispatch($1,$2)', [
        command.dispatchId,
        command.workspaceId,
      ])
      const job = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [command.jobId])
      if (job.origin !== 'hosted' || job.kind !== 'generate') failure('HOSTED_SOURCE_JOB_REQUIRED')
      if (!supported.includes(job.state)) {
        const prior = await c.query(
          'SELECT 1 FROM scheduler_step_receipts WHERE dispatch_id=$1 AND sequence=$2',
          [command.dispatchId, command.sequence]
        )
        if (!prior.rowCount) failure('HOSTED_SOURCE_STAGE_UNAVAILABLE')
      }
    })
    signal.throwIfAborted()
    const begun = await this.outbox.begin(command)
    if (begun.kind === 'replay') return begun.result
    // Do not return a success hint: advancing the Workflow sequence on a busy
    // unclaimed command would permanently skip this receipt's sequence.
    if (begun.kind === 'busy') failure('HOSTED_SOURCE_BUSY')
    if (begun.kind === 'unresolved') failure('HOSTED_SOURCE_RECONCILIATION_REQUIRED')
    if (begun.kind !== 'claimed') return failure('HOSTED_SOURCE_UNAVAILABLE')
    const claim = begun.claim
    const deadline = Math.min(
      Date.now() + 44_000,
      Date.parse(command.expiresAt),
      claim.step.lease_expires_at.getTime()
    )
    if (deadline <= Date.now()) failure('HOSTED_SOURCE_EXPIRED')
    const abort = AbortSignal.any([signal, AbortSignal.timeout(deadline - Date.now())])
    // An exception after claim deliberately retains the durable started receipt
    // and operation identity. A timeout is not proof the provider did no work.
    if (claim.step.stage === 'QUEUED') {
      return this.outbox.settle(command, claim, continuing, async (c, j) => {
        abort.throwIfAborted()
        if (j.origin !== 'hosted' || j.kind !== 'generate') failure('HOSTED_SOURCE_JOB_REQUIRED')
        await this.finish(c, j, claim, null)
        await changeState(c, j, 'PLANNING', 'stage-complete')
        abort.throwIfAborted()
      })
    }
    if (!['PLANNING', 'GENERATING'].includes(claim.step.stage))
      failure('HOSTED_SOURCE_STAGE_UNAVAILABLE')
    const gate = new HostedGenerationGate(this.config.db, claim.step.lease_owner)
    const products = new HostedProducts(gate, this.config.store)
    const scope = {
      workspaceId: claim.step.workspace_id,
      projectId: claim.step.project_id,
      jobId: claim.step.job_id,
      stepId: claim.step.id,
      leaseEpoch: number(claim.step.lease_epoch),
    }
    const loaded = await gate.withClaim(scope, async (c) => {
      const j = await one<JobRow & { prompt_version: string }>(
        c,
        'SELECT * FROM jobs WHERE id=$1',
        [scope.jobId]
      )
      if (
        j.template_digest !== this.config.catalog.manifest.template.digest ||
        j.policy_digest !== canonicalHash(this.config.commandPolicy) ||
        j.repair_count !== 0
      )
        failure('HOSTED_SOURCE_RELEASE_CHANGED')
      // A new dispatch/step is not permission to replace an earlier call whose
      // product was never durably adopted, even when its usage was measured.
      if (
        (
          await c.query(
            `SELECT 1 FROM provider_attempts a LEFT JOIN hosted_source_products p
        ON p.operation_id=a.operation_id WHERE a.job_id=$1 AND a.operation_id<>$2 AND p.operation_id IS NULL LIMIT 1`,
            [j.id, claim.operationId]
          )
        ).rowCount
      )
        failure('HOSTED_SOURCE_RECONCILIATION_REQUIRED')
      const binding = await one<Record<string, unknown>>(
        c,
        'SELECT * FROM hosted_job_bindings WHERE job_id=$1',
        [j.id]
      )
      const project = await one<{ brief: string }>(c, 'SELECT brief FROM projects WHERE id=$1', [
        j.project_id,
      ])
      const source = (await c.query<{ base_manifest_artifact_id: string }>(csql.source, [j.id]))
        .rows[0]
      const snapshot =
        !source && j.base_snapshot_id
          ? await one<{ manifest_artifact_id: string }>(
              c,
              "SELECT manifest_artifact_id FROM snapshots WHERE id=$1 AND project_id=$2 AND status='verified'",
              [j.base_snapshot_id, j.project_id]
            )
          : null
      const policy = providerPolicySchema.parse(binding.provider_policy_json)
      return {
        j,
        binding,
        brief: project.brief,
        manifestId: source?.base_manifest_artifact_id ?? snapshot?.manifest_artifact_id,
        deadlineAt: new Date(
          Math.min(deadline, j.active_deadline_at!.getTime(), Date.parse(policy.price.expiresAt))
        ).toISOString(),
      }
    })
    abort.throwIfAborted()
    const presetDigest = canonicalHash(loaded.binding.preset_json)
    const base = loaded.manifestId
      ? await products.source(scope, loaded.manifestId, this.config.catalog)
      : await createTemplateSource(
          this.config.store,
          scopeOf(loaded.j),
          this.config.catalog,
          presetDigest
        )
    await validateStoredSource(this.config.store, scopeOf(loaded.j), base, this.config.catalog)
    abort.throwIfAborted()
    await gate.withClaim(scope, async (c) => {
      abort.throwIfAborted()
      await this.adoptSource(c, loaded.j, base, products)
      await c.query(
        `INSERT INTO job_source_contexts(workspace_id,project_id,job_id,base_manifest_artifact_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO NOTHING`,
        [scope.workspaceId, scope.projectId, scope.jobId, base.manifestArtifact.id]
      )
      const prior = await one<{ base_manifest_artifact_id: string }>(c, csql.source, [scope.jobId])
      if (prior.base_manifest_artifact_id !== base.manifestArtifact.id)
        failure('HOSTED_BASE_CONFLICT')
    })
    const b = loaded.binding
    const context: HostedGenerationContext = {
      binding: batchBindingSchema.parse({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        jobId: scope.jobId,
        credentialId: b.credential_id,
        credentialRevision: number(b.credential_revision as string),
        provider: b.provider,
        model: b.model,
        providerPolicyDigest: b.provider_policy_digest,
        promptVersion: loaded.j.prompt_version,
        repairNumber: loaded.j.repair_count,
      }),
      stepId: scope.stepId,
      leaseEpoch: scope.leaseEpoch,
      operationId: claim.operationId,
      deadlineAt: loaded.deadlineAt,
      instruction: z.string().min(20).max(12000).parse(loaded.j.request_json.instruction),
      brief: loaded.brief,
      preset: structuredClone(b.preset_json),
      templateGuidance: this.config.templateGuidance,
      base,
    }
    context.source = await Promise.all(
      base.manifest.files
        .filter((f) => isGeneratedPath(f.path))
        .map(async (f) => ({
          path: f.path,
          content: new TextDecoder('utf-8', { fatal: true }).decode(
            await readSourceFile(this.config.store, scopeOf(loaded.j), base, f.path)
          ),
        }))
    )
    abort.throwIfAborted()
    const plan =
      loaded.j.state === 'GENERATING'
        ? await products.plan(scope, loaded.j.plan_artifact_id ?? failure('HOSTED_PLAN_REQUIRED'))
        : undefined
    const current = async (c: Tx) => {
      abort.throwIfAborted()
      await gate.assertCurrentInTransaction(c, context)
      if (plan) await this.approvedPlan(c, loaded.j, plan)
      abort.throwIfAborted()
    }
    const stage = new HostedGenerationStage(
      this.config.registry,
      this.config.store,
      this.config.catalog,
      {
        accounting: new PostgresCallAccounting(this.config.db, {
          lockAndAuthorize: async (c, terms) => {
            await gate.lockAndAuthorize(c, terms)
            if (plan) await this.approvedPlan(c, loaded.j, plan)
            abort.throwIfAborted()
          },
        }),
        assertCurrent: () => this.config.db.scoped(scope.workspaceId, current),
        credential: async () => {
          const record = await this.config.db.scoped(scope.workspaceId, async (c) => {
            await current(c)
            return one<{
              envelope_json: Parameters<CredentialCipher['decrypt']>[1]
              destination: string
            }>(
              c,
              'SELECT envelope_json,destination FROM provider_credentials WHERE workspace_id=$1 AND id=$2',
              [scope.workspaceId, context.binding.credentialId]
            )
          })
          const key = await this.config.cipher.decrypt(
            {
              workspaceId: scope.workspaceId,
              id: context.binding.credentialId,
              revision: context.binding.credentialRevision,
              provider: context.binding.provider,
              destination: record.destination,
            },
            record.envelope_json
          )
          await this.config.db.scoped(scope.workspaceId, current)
          return key
        },
        saveProduct: (ctx, request, ref, s) => products.save(ctx, request, ref, s),
      }
    )
    if (!plan) {
      const prior = await gate.withCurrent(
        context,
        async (c) =>
          (
            await c.query<{ artifact_id: string }>(
              "SELECT artifact_id FROM hosted_source_products WHERE job_id=$1 AND stage='plan' ORDER BY created_at LIMIT 1",
              [scope.jobId]
            )
          ).rows[0]
      )
      const result = prior
        ? {
            plan: await products.plan(scope, prior.artifact_id),
            artifact: await gate.withCurrent(context, (c) =>
              products.ref(c, scope, prior.artifact_id)
            ),
          }
        : await stage.plan(context, this.config.commandPolicy, abort)
      return this.outbox.settle(command, claim, waiting, async (c, j) => {
        await current(c)
        this.validatePlan(j, result.plan, presetDigest)
        const adopted = await one<{ artifact_id: string }>(
          c,
          "SELECT artifact_id FROM hosted_source_products WHERE job_id=$1 AND stage='plan' AND artifact_id=$2",
          [j.id, result.artifact.id]
        )
        const at = await clock(c)
        await c.query('UPDATE jobs SET plan_artifact_id=$2 WHERE id=$1', [
          j.id,
          adopted.artifact_id,
        ])
        j.plan_artifact_id = adopted.artifact_id
        await this.finish(c, j, claim, adopted.artifact_id)
        const review = {
          schemaVersion: 1,
          ...scopeOf(j),
          baseRevision: number(j.base_revision),
          baseSnapshotId: j.base_snapshot_id,
          templateDigest: j.template_digest,
          policyDigest: j.policy_digest,
          planDigest: canonicalHash(result.plan),
          expiresAt: new Date(
            Math.min(Date.parse(at) + 86400000, j.created_at.getTime() + 7 * 86400000)
          ).toISOString(),
        }
        await changeState(c, j, 'AWAITING_PLAN_APPROVAL', 'stage-complete', review, undefined, at)
        await appendEvent(c, j, 'plan.ready', {
          artifactId: adopted.artifact_id,
          planDigest: review.planDigest,
          reviewDigest: j.review_digest,
        })
        await flushEventSequence(c, j)
        abort.throwIfAborted()
      })
    }
    this.validatePlan(loaded.j, plan, presetDigest)
    const saved = await gate.withCurrent(context, async (c) => {
      await this.approvedPlan(c, loaded.j, plan)
      const rows = await c.query<{ artifact_id: string }>(
        "SELECT artifact_id FROM hosted_source_products WHERE job_id=$1 AND stage='files' AND repair_number=0 ORDER BY batch_index",
        [scope.jobId]
      )
      return Promise.all(rows.rows.map((r) => products.ref(c, scope, r.artifact_id)))
    })
    const result = await stage.files(
      context,
      {
        plan,
        baseSnapshotId: loaded.j.base_snapshot_id,
        savedProducts: saved,
        scan: async (source) => {
          const files = await Promise.all(
            source.manifest.files.map(async (f) => ({
              path: f.path,
              bytes: await readSourceFile(this.config.store, scopeOf(loaded.j), source, f.path),
            }))
          )
          for (const f of files.filter((f) => f.path.startsWith('migrations/')))
            validateMigrationSql(new TextDecoder('utf-8', { fatal: true }).decode(f.bytes))
          await this.config.scan(files, canonicalHash(source.manifest), abort)
        },
        // Candidate adoption belongs to the same transaction as step/state/receipt
        // settlement below. Saved provider products already provide durable recovery.
        adopt: async () => {
          await this.config.db.scoped(scope.workspaceId, current)
        },
      },
      abort
    )
    return this.outbox.settle(command, claim, continuing, async (c, j) => {
      await current(c)
      if (result.state === 'continue') {
        await this.finish(c, j, claim, result.products.at(-1)!.id)
        await enqueue(c, j)
        await flushEventSequence(c, j)
      } else {
        const m = result.candidate.manifest
        if (
          m.provenance.origin !== 'provider' ||
          m.provenance.jobId !== j.id ||
          m.baseSnapshotId !== j.base_snapshot_id ||
          m.planDigest !== canonicalHash(plan)
        )
          failure('HOSTED_CANDIDATE_BINDING')
        await this.adoptSource(c, j, result.candidate, products)
        await this.adoptRef(c, j, result.diff, products)
        const snapshot = randomUUID()
        await c.query(
          `INSERT INTO snapshots(id,workspace_id,project_id,job_id,parent_id,manifest_artifact_id,manifest_digest,template_digest,schema_digest,status,origin)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'candidate','hosted')`,
          [
            snapshot,
            j.workspace_id,
            j.project_id,
            j.id,
            j.base_snapshot_id,
            result.candidate.manifestArtifact.id,
            canonicalHash(m),
            j.template_digest,
            canonicalHash(m.migrations),
          ]
        )
        await c.query('UPDATE job_source_contexts SET diff_artifact_id=$2 WHERE job_id=$1', [
          j.id,
          result.diff.id,
        ])
        await c.query('UPDATE jobs SET candidate_snapshot_id=$2 WHERE id=$1', [j.id, snapshot])
        j.candidate_snapshot_id = snapshot
        await this.finish(c, j, claim, result.candidate.manifestArtifact.id)
        await changeState(c, j, 'VALIDATING', 'stage-complete')
      }
      abort.throwIfAborted()
    })
  }
  private validatePlan(j: JobRow, plan: PlanV1, presetDigest: string) {
    if (
      plan.briefHash !== sha256(String(j.request_json.instruction)) ||
      plan.templateDigest !== j.template_digest ||
      plan.presetDigest !== presetDigest ||
      plan.unsupportedRequirements.length ||
      canonicalHash(plan.resources) !== canonicalHash(this.config.commandPolicy.resources) ||
      canonicalHash(plan.network) !== canonicalHash(this.config.commandPolicy.network) ||
      canonicalHash(plan.requiredChecks) !== canonicalHash(this.config.commandPolicy.requiredChecks)
    )
      failure('HOSTED_PLAN_BINDING')
  }
  private async approvedPlan(c: Tx, j: JobRow, plan: PlanV1) {
    const r = await one<{
      body: unknown
      state_version: string
      expires_at: Date
      subject_digest: string
      actor_id: string
      id: string
      decision: string
      created_at: Date
    }>(
      c,
      `SELECT r.body,r.state_version,r.expires_at,r.subject_digest,a.actor_id,a.id,a.decision,a.created_at
       FROM job_reviews r JOIN approvals a ON a.job_id=r.job_id AND a.state_version=r.state_version AND a.subject_digest=r.subject_digest
       WHERE r.job_id=$1 AND r.kind='plan' AND a.kind='plan' AND a.decision='approve' ORDER BY r.state_version DESC LIMIT 1`,
      [j.id]
    )
    const subject = planReviewSchema.parse(r.body)
    if (
      r.actor_id !== j.created_by ||
      number(r.state_version) + 1 !== number(j.state_version) ||
      subject.planDigest !== canonicalHash(plan)
    )
      failure('HOSTED_PLAN_APPROVAL_REQUIRED')
    const at = await clock(c)
    const actor = await one<{ allowed: boolean; member_role: string }>(
      c,
      'SELECT * FROM worker_actor($1,$2)',
      [j.workspace_id, r.actor_id]
    )
    validateApproval(
      {
        schemaVersion: 1,
        ...scopeOf(j),
        actorId: r.actor_id,
        id: r.id,
        kind: 'plan',
        decision: r.decision,
        stateVersion: number(r.state_version),
        subjectDigest: r.subject_digest,
        createdAt: r.created_at.toISOString(),
        expiresAt: r.expires_at.toISOString(),
      },
      subject,
      {
        ...scopeOf(j),
        actorId: r.actor_id,
        currentRole: actor.allowed ? actor.member_role : null,
        userDisabled: !actor.allowed,
        stateVersion: number(r.state_version),
        subjectDigest: r.subject_digest,
        baseRevision: number(j.base_revision),
        baseSnapshotId: j.base_snapshot_id,
        kind: 'plan',
        now: at,
        reviewExpiresAt: r.expires_at.toISOString(),
        cancelRequested: false,
        policyRevoked: false,
        templateDigest: j.template_digest,
        policyDigest: j.policy_digest,
      }
    )
  }
  private async adoptRef(c: Tx, j: JobRow, raw: ArtifactRef, products: HostedProducts) {
    const ref = artifactRefSchema.parse(raw)
    if (
      ref.workspaceId !== j.workspace_id ||
      ref.projectId !== j.project_id ||
      ref.backendEvidence !== 'durable'
    )
      failure('HOSTED_ARTIFACT_SCOPE')
    const existing = await c.query('SELECT id FROM artifacts WHERE id=$1', [ref.id])
    if (existing.rowCount) {
      if (canonicalHash(await products.ref(c, scopeOf(j), ref.id)) !== canonicalHash(ref))
        failure('HOSTED_ARTIFACT_CONFLICT')
      return
    }
    if (ref.jobId !== j.id) failure('HOSTED_ARTIFACT_UNADOPTED')
    await c.query('SELECT forge_objects.adopt($1,$2,$3,$4)', [
      ref.storageKey,
      ref.storageVersion,
      j.workspace_id,
      j.project_id,
    ])
    await c.query(
      `INSERT INTO artifacts(id,workspace_id,project_id,job_id,kind,object_key,object_version,sha256,bytes,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'available')`,
      [
        ref.id,
        ref.workspaceId,
        ref.projectId,
        ref.jobId,
        ref.kind,
        ref.storageKey,
        ref.storageVersion,
        ref.sha256,
        ref.bytes,
      ]
    )
  }
  private async adoptSource(c: Tx, j: JobRow, source: StoredSource, products: HostedProducts) {
    for (const ref of source.blobs) await this.adoptRef(c, j, ref, products)
    await this.adoptRef(c, j, source.manifestArtifact, products)
  }
  private async finish(c: Tx, j: JobRow, claim: StepClaim, artifact: string | null) {
    await c.query(
      `UPDATE job_steps SET status='succeeded',finished_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,output_artifact_id=$2 WHERE id=$1`,
      [claim.step.id, artifact]
    )
    await appendEvent(c, j, 'step.finished', {
      stepId: claim.step.id,
      status: 'succeeded',
      evidenceId: artifact,
    })
  }
}
const csql = { source: 'SELECT base_manifest_artifact_id FROM job_source_contexts WHERE job_id=$1' }
