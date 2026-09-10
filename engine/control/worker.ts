import { randomUUID } from 'node:crypto'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { manifestSchema, planSchema } from '../contracts/source.ts'
import {
  executionReviewSchema,
  verificationSchema,
  validateApproval,
  validateDescriptor,
} from '../contracts/review.ts'
import { modelPolicySchema, ControlError } from './contracts.ts'
import { clock, one, number } from './database.ts'
import type { Tx , ControlDatabase } from './database.ts'
import { appendEvent, changeState, flushEventSequence, scopeOf } from './state.ts'
import type { JobRow, StepRow } from './state.ts'
import { fixturePolicy, fixtureImageDigest } from './catalog.ts'
import { stageResultSchema } from './stage-adapter.ts'
import type { StageAdapter, StageInput, StageResult } from './stage-adapter.ts'
export class SimulatedWorkerCrash extends Error {}
export class UncertainOperation extends Error {}
export const operationId = (j: string, s: string, attempt: number) => {
  const h = sha256(`${j}:${s}:${attempt}`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export interface WorkerHooks {
  attemptTimeoutMs?: number
  afterDispatch?: () => Promise<void>
  afterResult?: () => Promise<void>
  beforeCommit?: () => Promise<void>
  afterCommit?: () => Promise<void>
}
export class ControlWorker {
  readonly id = randomUUID()
  constructor(
    readonly db: ControlDatabase,
    readonly adapter: StageAdapter,
    readonly hooks: WorkerHooks = {}
  ) {
    if (adapter.origin !== 'fixture') throw new Error('Live adapters blocked pending E2/D3/D5')
  }
  async claim(): Promise<StepRow | null> {
    return this.db.tx(async (c) => {
      const s = (await c.query<StepRow>('SELECT * FROM claim_step($1)', [this.id])).rows[0]
      if (!s) return null
      const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1', [s.job_id])
      await appendEvent(c, j, 'step.started', {
        stepId: s.id,
        stage: s.stage,
        attempt: s.attempt,
        leaseEpoch: number(s.lease_epoch),
      })
      await flushEventSequence(c, j)
      return s
    })
  }
  async leased<T>(s: StepRow, fn: (c: Tx, j: JobRow, current: StepRow) => Promise<T>): Promise<T> {
    return this.db.scoped(s.workspace_id, async (c) => {
      const settings = await one<{ worker_enabled: boolean; security_shutdown: boolean }>(
        c,
        'SELECT * FROM control_settings FOR SHARE'
      )
      await one(c, 'SELECT id FROM projects WHERE id=$1 FOR UPDATE', [s.project_id])
      const j = await one<JobRow>(c, 'SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [s.job_id])
      const current = (
        await c.query<StepRow>(
          `SELECT * FROM job_steps WHERE id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND status='running' AND lease_expires_at>clock_timestamp() FOR UPDATE`,
          [s.id, this.id, s.lease_epoch]
        )
      ).rows[0]
      if (
        (
          await c.query('SELECT 1 FROM cleanup_requests WHERE job_id=$1 AND confirmed_at IS NULL', [
            j.id,
          ])
        ).rowCount
      )
        throw new ControlError(409, 'LEASE_LOST')
      if (
        !current ||
        j.state !== s.stage ||
        j.finished_at ||
        j.cleanup_target ||
        j.cancel_requested_at
      )
        throw new ControlError(409, 'LEASE_LOST')
      const valid = (
        await c.query('SELECT * FROM worker_actor($1,$2)', [j.workspace_id, j.created_by])
      ).rows[0]
      const now = await clock(c)
      if (
        !settings.worker_enabled ||
        settings.security_shutdown ||
        !valid?.allowed ||
        (
          await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2)', [
            j.policy_digest,
            j.template_digest,
          ])
        ).rowCount ||
        (j.active_deadline_at && j.active_deadline_at.getTime() <= Date.parse(now)) ||
        j.created_at.getTime() <= Date.parse(now) - 7 * 86400000
      )
        throw new ControlError(409, 'DISPATCH_FENCED')
      return fn(c, j, current)
    })
  }
  heartbeat(s: StepRow) {
    return this.leased(s, async (c) => {
      await c.query(
        `UPDATE job_steps SET lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE id=$1`,
        [s.id]
      )
    })
  }
  async payload(c: Tx, id: string) {
    return (
      await one<{ payload_json: unknown }>(
        c,
        'SELECT payload_json FROM fixture_artifact_payloads WHERE artifact_id=$1',
        [id]
      )
    ).payload_json
  }
  async input(c: Tx, j: JobRow, s: StepRow): Promise<StageInput> {
    const input: { -readonly [K in keyof StageInput]: StageInput[K] } = {
      ...scopeOf(j),
      stepId: s.id,
      leaseEpoch: number(s.lease_epoch),
      operationId: operationId(j.id, s.id, s.attempt),
      inputDigest: s.input_digest,
      stage: j.state,
      instruction: String(j.request_json.instruction),
      maxCostMicros: number(j.cost_limit_micros),
      baseSnapshotId: j.base_snapshot_id,
    }
    if (j.plan_artifact_id) input.plan = planSchema.parse(await this.payload(c, j.plan_artifact_id))
    if (j.candidate_snapshot_id) {
      const snap = await one<{
        manifest_artifact_id: string
        verification_artifact_id: string | null
      }>(c, 'SELECT * FROM snapshots WHERE id=$1', [j.candidate_snapshot_id])
      input.manifest = manifestSchema.parse(await this.payload(c, snap.manifest_artifact_id))
      if (snap.verification_artifact_id)
        input.verification = verificationSchema.parse(
          await this.payload(c, snap.verification_artifact_id)
        )
    }
    return input
  }
  async putArtifact(
    c: Tx,
    j: JobRow,
    kind: string,
    payload: unknown,
    id: string = randomUUID()
  ): Promise<string> {
    const digest = canonicalHash(payload),
      bytes = Buffer.byteLength(JSON.stringify(payload))
    await c.query(
      `INSERT INTO artifacts(id,workspace_id,project_id,job_id,kind,object_key,object_version,sha256,bytes,status) VALUES($1,$2,$3,$4,$5,$6,'fixture-v1',$7,$8,'available')`,
      [
        id,
        j.workspace_id,
        j.project_id,
        j.id,
        kind,
        `fixture/${j.workspace_id}/${j.project_id}/${id}`,
        digest,
        bytes,
      ]
    )
    await c.query(
      'INSERT INTO fixture_artifact_payloads(workspace_id,project_id,artifact_id,payload_json) VALUES($1,$2,$3,$4)',
      [j.workspace_id, j.project_id, id, payload]
    )
    return id
  }
  async candidate(c: Tx, j: JobRow, result: Extract<StageResult, { kind: 'candidate' }>) {
    const m = manifestSchema.parse(result.manifest)
    if (
      m.template.digest !== j.template_digest ||
      m.commandPolicyDigest !== j.policy_digest ||
      m.provenance.origin !== 'fixture' ||
      m.provenance.jobId !== j.id ||
      m.baseSnapshotId !== j.base_snapshot_id
    )
      throw new Error('Candidate binding')
    if (result.blobs.length !== m.files.length) throw new Error('Fixture blob count')
    for (const f of m.files) {
      const blob = result.blobs.find((b) => b.blobId === f.blobId)
      if (!blob || sha256(blob.content) !== f.sha256 || Buffer.byteLength(blob.content) !== f.bytes)
        throw new Error('Blob mismatch')
      await this.putArtifact(
        c,
        j,
        'source-blob',
        { schemaVersion: 1, origin: 'fixture', content: blob.content },
        blob.blobId
      )
    }
    const artifact = await this.putArtifact(c, j, 'source-manifest', m),
      snapshotId = randomUUID()
    await c.query(
      `INSERT INTO snapshots(id,workspace_id,project_id,job_id,parent_id,manifest_artifact_id,manifest_digest,template_digest,schema_digest,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'candidate')`,
      [
        snapshotId,
        j.workspace_id,
        j.project_id,
        j.id,
        j.base_snapshot_id,
        artifact,
        canonicalHash(m),
        j.template_digest,
        canonicalHash(m.migrations),
      ]
    )
    await c.query('UPDATE jobs SET candidate_snapshot_id=$2 WHERE id=$1', [j.id, snapshotId])
    j.candidate_snapshot_id = snapshotId
    return artifact
  }
  async executionContext(c: Tx, j: JobRow) {
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
      `SELECT r.body,r.state_version,r.expires_at,r.subject_digest,a.actor_id,a.id,a.decision,a.created_at FROM job_reviews r JOIN approvals a ON a.job_id=r.job_id AND a.state_version=r.state_version AND a.subject_digest=r.subject_digest AND a.kind='execution' AND a.decision='approve' WHERE r.job_id=$1 AND r.kind='execution' ORDER BY r.state_version DESC LIMIT 1`,
      [j.id]
    )
    const project = await one<{ revision: string; head_snapshot_id: string | null }>(
      c,
      'SELECT revision,head_snapshot_id FROM projects WHERE id=$1',
      [j.project_id]
    )
    const actor = await one<{ allowed: boolean; member_role: string }>(
      c,
      'SELECT * FROM worker_actor($1,$2)',
      [j.workspace_id, r.actor_id]
    )
    const now = await clock(c),
      review = executionReviewSchema.parse(r.body)
    const approval = {
      schemaVersion: 1,
      ...scopeOf(j),
      actorId: r.actor_id,
      id: r.id,
      kind: 'execution',
      decision: r.decision,
      stateVersion: number(r.state_version),
      subjectDigest: r.subject_digest,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    }
    const context = {
      ...scopeOf(j),
      actorId: r.actor_id,
      currentRole: actor.allowed ? actor.member_role : null,
      userDisabled: !actor.allowed,
      kind: 'execution',
      now,
      stateVersion: number(r.state_version),
      subjectDigest: r.subject_digest,
      baseRevision: number(project.revision),
      baseSnapshotId: project.head_snapshot_id,
      reviewExpiresAt: r.expires_at.toISOString(),
      cancelRequested: j.cancel_requested_at !== null,
      policyRevoked: false,
      templateDigest: j.template_digest,
      policyDigest: j.policy_digest,
    }
    validateApproval(approval, review, context)
    const snap = await one<{ manifest_digest: string }>(
      c,
      'SELECT manifest_digest FROM snapshots WHERE id=$1',
      [j.candidate_snapshot_id]
    )
    if (review.candidateDigest !== snap.manifest_digest)
      throw new Error('Approval candidate changed')
    return { approval, context, review }
  }
  async prepare(s: StepRow) {
    return this.leased(s, async (c, j, current) => {
      const input = await this.input(c, j, current),
        isProvider = ['PLANNING', 'GENERATING', 'REPAIRING'].includes(j.state)
      const previous = (
        await c.query('SELECT * FROM fixture_operations WHERE id=$1 FOR UPDATE', [
          input.operationId,
        ])
      ).rows[0]
      if (previous && previous.input_digest !== input.inputDigest)
        throw new Error('Operation input changed')
      if (
        previous?.state === 'completed' &&
        (isProvider || number(previous.lease_epoch) === input.leaseEpoch)
      )
        return { input, cached: stageResultSchema.parse(previous.result_json), isProvider }
      if (previous && isProvider) {
        await c.query("UPDATE provider_attempts SET state='uncertain' WHERE operation_id=$1", [
          input.operationId,
        ])
        throw new UncertainOperation('Unknown provider outcome')
      }
      if (isProvider) {
        const policy = modelPolicySchema.parse(j.model_policy_json)
        const balance = await one<{ n: string }>(
          c,
          "SELECT COALESCE(sum(CASE WHEN state IN('dispatched','uncertain') THEN maximum_micros ELSE COALESCE(amount_micros,0) END),0)::text AS n FROM provider_attempts WHERE job_id=$1",
          [j.id]
        )
        if (
          j.provider_calls >= 12 ||
          number(balance.n) + policy.maxAttemptMicros > number(j.cost_limit_micros)
        )
          throw new ControlError(429, 'QUOTA_EXCEEDED')
        await c.query(
          `INSERT INTO provider_attempts(workspace_id,project_id,job_id,step_id,operation_id,input_digest,maximum_micros,state) VALUES($1,$2,$3,$4,$5,$6,$7,'dispatched')`,
          [
            j.workspace_id,
            j.project_id,
            j.id,
            s.id,
            input.operationId,
            input.inputDigest,
            policy.maxAttemptMicros,
          ]
        )
        await c.query('UPDATE jobs SET provider_calls=provider_calls+1 WHERE id=$1', [j.id])
      } else {
        const proof = await this.executionContext(c, j)
        const descriptor = {
          schemaVersion: 1,
          ...scopeOf(j),
          operationId: input.operationId,
          environmentId: randomUUID(),
          appDatabaseId: randomUUID(),
          kind: j.state === 'PREPARING_PREVIEW' ? 'preview' : 'test',
          leaseEpoch: input.leaseEpoch,
          issuedAt: proof.context.now,
          expiresAt: new Date(Date.parse(proof.context.now) + 60000).toISOString(),
          approvalId: proof.approval.id,
          executionReviewDigest: canonicalHash(proof.review),
          sourceManifestDigest: proof.review.candidateDigest,
          templateDigest: j.template_digest,
          imageDigest: fixtureImageDigest,
          commandPolicyDigest: j.policy_digest,
          mounts: [
            { source: 'approved-source', target: '/workspace', readOnly: true },
            { source: 'ephemeral-scratch', target: '/scratch', readOnly: false },
          ],
          network: proof.review.commandPolicy.network,
          resources: proof.review.commandPolicy.resources,
        }
        validateDescriptor(
          descriptor,
          proof.review,
          proof.approval,
          proof.context,
          input.leaseEpoch
        )
      }
      await c.query(
        `INSERT INTO fixture_operations(id,workspace_id,project_id,job_id,step_id,kind,input_digest,lease_epoch,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'requested') ON CONFLICT(id) DO UPDATE SET state='requested',result_json=NULL,lease_epoch=EXCLUDED.lease_epoch`,
        [
          input.operationId,
          j.workspace_id,
          j.project_id,
          j.id,
          s.id,
          isProvider ? 'provider' : 'runner',
          input.inputDigest,
          input.leaseEpoch,
        ]
      )
      await c.query('UPDATE job_steps SET external_operation_id=$2 WHERE id=$1', [
        s.id,
        input.operationId,
      ])
      return { input, cached: null, isProvider }
    })
  }
  async runOnce(): Promise<boolean> {
    const s = await this.claim()
    if (!s) return false
    const abort = new AbortController()
    const heartbeat = setInterval(() => {
      void this.heartbeat(s).catch(() => abort.abort())
    }, 15000)
    const deadline = setTimeout(
      () => abort.abort(),
      Math.min(120000, this.hooks.attemptTimeoutMs ?? 120000)
    )
    try {
      if (['QUEUED', 'VALIDATING'].includes(s.stage)) {
        await this.complete(s, null)
        return true
      }
      const prepared = await this.prepare(s)
      let result = prepared.cached
      if (!result) {
        await this.hooks.afterDispatch?.()
        const stage = this.adapter.run(prepared.input, abort.signal)
        let onAbort!: () => void
        const interrupted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new ControlError(503, 'FIXTURE_STAGE_TIMEOUT'))
          if (abort.signal.aborted) onAbort()
          else abort.signal.addEventListener('abort', onAbort, { once: true })
        })
        result = stageResultSchema.parse(
          await Promise.race([stage, interrupted]).finally(() =>
            abort.signal.removeEventListener('abort', onAbort)
          )
        )
        await this.leased(s, async (c) => {
          await c.query(
            "UPDATE fixture_operations SET state='completed',result_json=$2 WHERE id=$1 AND lease_epoch=$3",
            [prepared.input.operationId, result, s.lease_epoch]
          )
        })
        await this.hooks.afterResult?.()
      }
      await this.hooks.beforeCommit?.()
      await this.complete(s, result)
      await this.hooks.afterCommit?.()
      return true
    } catch (error) {
      if (error instanceof SimulatedWorkerCrash) throw error
      try {
        await this.leased(s, async (c, j) => {
          if (error instanceof UncertainOperation)
            await c.query(
              "UPDATE provider_attempts SET state='uncertain' WHERE job_id=$1 AND state='dispatched'",
              [j.id]
            )
          await requestCleanup(c, j, 'failure', 'FAILED')
        })
      } catch {
        /* Lost lease/cancellation: only reconciler or current owner may mutate. */
      }
      return true
    } finally {
      clearInterval(heartbeat)
      clearTimeout(deadline)
      abort.abort()
    }
  }
  async complete(s: StepRow, result: StageResult | null) {
    return this.leased(s, async (c, j) => {
      let output: string | null = null,
        target: JobRow['state'],
        review: unknown = null,
        reason: 'stage-complete' | 'repairable-error' = 'stage-complete'
      const at = await clock(c),
        expiresAt = new Date(
          Math.min(Date.parse(at) + 86400000, j.created_at.getTime() + 7 * 86400000)
        ).toISOString()
      const common = {
        schemaVersion: 1,
        ...scopeOf(j),
        baseRevision: number(j.base_revision),
        baseSnapshotId: j.base_snapshot_id,
        templateDigest: j.template_digest,
        policyDigest: j.policy_digest,
        expiresAt,
      }
      if (j.state === 'QUEUED') target = j.kind === 'generate' ? 'PLANNING' : 'VALIDATING'
      else if (j.state === 'PLANNING' && result?.kind === 'plan') {
        if (
          result.plan.templateDigest !== j.template_digest ||
          result.plan.briefHash !== sha256(String(j.request_json.instruction))
        )
          throw new Error('Plan binding')
        output = await this.putArtifact(c, j, 'plan', result.plan)
        await c.query('UPDATE jobs SET plan_artifact_id=$2 WHERE id=$1', [j.id, output])
        j.plan_artifact_id = output
        target = 'AWAITING_PLAN_APPROVAL'
        review = { ...common, planDigest: canonicalHash(result.plan) }
      } else if (['GENERATING', 'REPAIRING'].includes(j.state) && result?.kind === 'candidate') {
        output = await this.candidate(c, j, result)
        target = 'VALIDATING'
      } else if (j.state === 'VALIDATING') {
        if (j.kind === 'restore' && !j.candidate_snapshot_id) {
          const prior = await one<{ manifest_artifact_id: string }>(
            c,
            "SELECT manifest_artifact_id FROM snapshots WHERE id=$1 AND project_id=$2 AND status='verified'",
            [j.request_json.restoreSnapshotId, j.project_id]
          )
          const m = manifestSchema.parse(await this.payload(c, prior.manifest_artifact_id))
          const blobs = []
          for (const file of m.files) {
            const payload = (await this.payload(c, file.blobId)) as { content: string }
            const blobId = randomUUID()
            file.blobId = blobId
            blobs.push({ blobId, content: payload.content })
          }
          m.baseSnapshotId = j.base_snapshot_id
          m.provenance = { ...m.provenance, origin: 'fixture', jobId: j.id }
          m.commandPolicyDigest = j.policy_digest
          output = await this.candidate(c, j, {
            schemaVersion: 1,
            origin: 'fixture',
            kind: 'candidate',
            manifest: m,
            blobs,
          })
        }
        const input = await this.input(c, j, s)
        if (!input.manifest) throw new Error('Missing candidate')
        target = 'AWAITING_EXECUTION_APPROVAL'
        review = {
          ...common,
          candidateDigest: canonicalHash(input.manifest),
          diffDigest: sha256('fixture diff only'),
          imageDigest: fixtureImageDigest,
          commandPolicy: fixturePolicy(number(j.cost_limit_micros)),
          migrations: input.manifest.migrations,
          migrationBundleDigest: canonicalHash(input.manifest.migrations),
          dataReset: 'synthetic-data-only',
        }
      } else if (j.state === 'PROVISIONING' && result?.kind === 'provisioned') {
        const env = randomUUID()
        await c.query(
          `INSERT INTO environments(id,workspace_id,project_id,job_id,snapshot_id,kind,broker_operation_id,lease_epoch,state,expires_at) VALUES($1,$2,$3,$4,$5,'test',$6,$7,'ready',clock_timestamp()+interval '10 minutes')`,
          [
            env,
            j.workspace_id,
            j.project_id,
            j.id,
            j.candidate_snapshot_id,
            operationId(j.id, s.id, s.attempt),
            s.lease_epoch,
          ]
        )
        target = 'VERIFYING'
      } else if (j.state === 'VERIFYING' && result?.kind === 'repairable-error') {
        if (j.kind === 'restore' || j.repair_count >= 2) throw new Error('Repair exhausted')
        await destroyFixtureResources(c, j)
        reason = 'repairable-error'
        target = 'REPAIRING'
      } else if (j.state === 'VERIFYING' && result?.kind === 'verification') {
        const v = verificationSchema.parse(result.verification),
          input = await this.input(c, j, s)
        if (
          v.origin !== 'fixture' ||
          v.candidateDigest !== canonicalHash(input.manifest) ||
          v.templateDigest !== j.template_digest ||
          v.policyDigest !== j.policy_digest ||
          v.imageDigest !== fixtureImageDigest ||
          v.leaseEpoch !== number(s.lease_epoch) ||
          v.jobId !== j.id ||
          v.workspaceId !== j.workspace_id ||
          v.projectId !== j.project_id ||
          v.checks.some((x) => x.exitCode !== 0 || x.oom || x.timedOut)
        )
          throw new Error('Invalid fixture verification')
        output = await this.putArtifact(c, j, 'verification', v)
        await c.query(
          "UPDATE snapshots SET status='verified',verification_artifact_id=$2 WHERE id=$1",
          [j.candidate_snapshot_id, output]
        )
        for (const check of v.checks)
          await appendEvent(c, j, 'check.result', {
            check: check.checkId,
            status: 'passed',
            exitCode: 0,
            evidenceId: output,
            candidateDigest: v.candidateDigest,
            origin: 'fixture',
          })
        await destroyFixtureResources(c, j)
        target = 'PREPARING_PREVIEW'
      } else if (j.state === 'PREPARING_PREVIEW' && result?.kind === 'preview') {
        const env = randomUUID(),
          preview = randomUUID(),
          generation = randomUUID(),
          input = await this.input(c, j, s)
        const prior = (
          await c.query<JobRow>(
            "SELECT DISTINCT old.* FROM jobs old JOIN environments e ON e.job_id=old.id WHERE old.project_id=$1 AND old.id<>$2 AND e.kind='preview' AND e.state<>'destroyed'",
            [j.project_id, j.id]
          )
        ).rows
        for (const old of prior) await destroyFixtureResources(c, old) // Simulated resources only; E3 needs authenticated cleanup receipts.
        await c.query('SELECT reserve_fixture_preview($1)', [j.workspace_id])
        await c.query(
          `INSERT INTO environments(id,workspace_id,project_id,job_id,snapshot_id,kind,broker_operation_id,lease_epoch,state,expires_at) VALUES($1,$2,$3,$4,$5,'preview',$6,$7,'ready',clock_timestamp()+interval '2 hours')`,
          [
            env,
            j.workspace_id,
            j.project_id,
            j.id,
            j.candidate_snapshot_id,
            operationId(j.id, s.id, s.attempt),
            s.lease_epoch,
          ]
        )
        await c.query(`UPDATE previews SET state='STOPPED' WHERE project_id=$1 AND state='READY'`, [
          j.project_id,
        ])
        await c.query(
          `INSERT INTO previews(id,workspace_id,project_id,snapshot_id,environment_id,generation,state,absolute_expires_at,idle_expires_at) VALUES($1,$2,$3,$4,$5,$6,'READY',now()+interval '2 hours',now()+interval '15 minutes')`,
          [preview, j.workspace_id, j.project_id, j.candidate_snapshot_id, env, generation]
        )
        await appendEvent(c, j, 'preview.state', {
          previewId: preview,
          generation,
          state: 'READY',
          expiresAt: new Date(Date.parse(at) + 2 * 3600000).toISOString(),
        })
        target = 'AWAITING_PROMOTION'
        review = {
          ...common,
          candidateDigest: canonicalHash(input.manifest),
          verificationDigest: canonicalHash(input.verification),
        }
      } else throw new Error('Stage/result mismatch')
      const attempt = (
        await c.query('SELECT * FROM provider_attempts WHERE operation_id=$1 FOR UPDATE', [
          operationId(j.id, s.id, s.attempt),
        ])
      ).rows[0]
      if (attempt && attempt.state !== 'completed') {
        await c.query(
          `INSERT INTO usage_ledger(id,workspace_id,project_id,job_id,step_id,provider_request_id,amount_micros,price_version,classification,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,0,'fixture-zero-cost-v1','measured',$7) ON CONFLICT(dedupe_key) DO NOTHING`,
          [
            randomUUID(),
            j.workspace_id,
            j.project_id,
            j.id,
            s.id,
            attempt.operation_id,
            `fixture:${attempt.operation_id}`,
          ]
        )
        await c.query(
          "UPDATE provider_attempts SET state='completed',amount_micros=0 WHERE operation_id=$1",
          [attempt.operation_id]
        )
        await appendEvent(c, j, 'usage.updated', {
          classification: 'measured',
          amountMicros: 0,
          priceVersion: 'fixture-zero-cost-v1',
          requestId: attempt.operation_id,
        })
      }
      await c.query(
        `UPDATE job_steps SET status='succeeded',finished_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,output_artifact_id=$2 WHERE id=$1`,
        [s.id, output]
      )
      await appendEvent(c, j, 'step.finished', {
        stepId: s.id,
        status: 'succeeded',
        evidenceId: output,
      })
      await changeState(c, j, target, reason, review, undefined, at)
      if (target === 'AWAITING_PLAN_APPROVAL')
        await appendEvent(c, j, 'plan.ready', {
          artifactId: j.plan_artifact_id,
          planDigest: (review as { planDigest: string }).planDigest,
          reviewDigest: j.review_digest,
        })
      if (target === 'AWAITING_EXECUTION_APPROVAL')
        await appendEvent(c, j, 'changes.ready', {
          snapshotId: j.candidate_snapshot_id,
          manifestDigest: (review as { candidateDigest: string }).candidateDigest,
          reviewDigest: j.review_digest,
        })
      await flushEventSequence(c, j)
    })
  }
}
export async function requestCleanup(
  c: Tx,
  j: JobRow,
  reason: 'cancel' | 'failure' | 'timeout' | 'security-rejection',
  target: 'FAILED' | 'EXPIRED' | 'CANCELLED'
) {
  await c.query('UPDATE jobs SET cleanup_target=$2,error_code=$3 WHERE id=$1', [
    j.id,
    target,
    reason === 'timeout' ? 'DEADLINE_EXCEEDED' : 'FIXTURE_STAGE_FAILED',
  ])
  j.cleanup_target = target
  await c.query(
    `UPDATE job_steps SET status='cancelled',finished_at=clock_timestamp(),lease_epoch=lease_epoch+1,lease_owner=NULL,lease_expires_at=NULL WHERE job_id=$1 AND status IN('queued','running')`,
    [j.id]
  )
  await c.query(
    `INSERT INTO cleanup_requests(workspace_id,project_id,job_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO UPDATE SET reason=EXCLUDED.reason,confirmed_at=NULL,generation=EXCLUDED.generation`,
    [j.workspace_id, j.project_id, j.id, reason]
  )
  await c.query(
    "UPDATE previews SET state='STOPPING' WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1) AND state='READY'",
    [j.id]
  )
  await c.query(
    `UPDATE preview_tickets SET revoked_at=clock_timestamp() WHERE preview_id IN(SELECT id FROM previews WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1))`,
    [j.id]
  )
}
export async function destroyFixtureResources(c: Tx, j: JobRow) {
  await c.query(
    `UPDATE preview_tickets SET revoked_at=clock_timestamp() WHERE preview_id IN(SELECT id FROM previews WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1))`,
    [j.id]
  )
  await c.query(
    `UPDATE previews SET state='STOPPED' WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1) AND state NOT IN('STOPPED','EXPIRED')`,
    [j.id]
  )
  await c.query(
    `UPDATE environments SET state='destroyed',destroyed_at=clock_timestamp() WHERE job_id=$1 AND state<>'destroyed'`,
    [j.id]
  )
  await c.query(
    `UPDATE app_databases SET state='deleted' WHERE environment_id IN(SELECT id FROM environments WHERE job_id=$1)`,
    [j.id]
  )
  await c.query(
    "UPDATE fixture_operations SET state='destroyed' WHERE job_id=$1 AND kind='runner' AND state<>'destroyed'",
    [j.id]
  )
}
