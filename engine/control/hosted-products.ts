import { artifactRefSchema } from '../artifacts/store.ts'
import type { ArtifactRef, ArtifactScope, ArtifactStore } from '../artifacts/store.ts'
import { canonicalHash } from '../contracts/canonical.ts'
import { manifestSchema, planSchema } from '../contracts/source.ts'
import { generationRequestSchema } from '../contracts/provider.ts'
import type { GenerationRequest } from '../contracts/provider.ts'
import { callTermsSchema } from '../providers/accounting.ts'
import { storedSourceSchema } from '../integration/contracts.ts'
import type { HostedGenerationContext } from '../generation/hosted-stage.ts'
import type { TemplateCatalog } from '../generation/catalog.ts'
import { validateStoredSource } from '../generation/source.ts'
import { batchScope } from '../generation/resumable.ts'
import { ControlError } from './contracts.ts'
import { one } from './database.ts'
import type { Tx } from './database.ts'
import type { HostedGenerationGate } from './hosted-generation-gate.ts'

type Claim = ArtifactScope & { stepId: string; leaseEpoch: number }
/** Reads decrypted source outside control transactions. Every ref comes from
 * current authorized metadata; callers cannot select a backend, bucket or URL. */
export class HostedProducts {
  constructor(
    private readonly gate: HostedGenerationGate,
    private readonly store: ArtifactStore
  ) {
    if (store.evidence !== 'durable') throw new Error('HOSTED_STORAGE_REQUIRED')
  }
  async ref(c: Tx, scope: ArtifactScope, id: string): Promise<ArtifactRef> {
    const row = await one<Record<string, unknown>>(
      c,
      `SELECT a.* FROM artifacts a
      JOIN jobs j ON j.id=a.job_id AND j.workspace_id=a.workspace_id AND j.project_id=a.project_id
      WHERE a.id=$1 AND a.workspace_id=$2 AND a.project_id=$3 AND j.origin='hosted'
      AND a.status='available' AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp())`,
      [id, scope.workspaceId, scope.projectId]
    )
    return artifactRefSchema.parse({
      schemaVersion: 1,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      jobId: row.job_id,
      id: row.id,
      kind: row.kind,
      sha256: row.sha256,
      bytes: Number(row.bytes),
      storageKey: row.object_key,
      storageVersion: row.object_version,
      state: 'available',
      backendEvidence: 'durable',
    })
  }
  async source(claim: Claim, manifestId: string, catalog: TemplateCatalog) {
    const scope = { workspaceId: claim.workspaceId, projectId: claim.projectId, jobId: claim.jobId }
    const manifestArtifact = await this.gate.withClaim(claim, (c) => this.ref(c, scope, manifestId))
    if (manifestArtifact.kind !== 'source-manifest') throw new Error('HOSTED_MANIFEST_REQUIRED')
    const bytes = await this.store.read(scope, manifestArtifact)
    const manifest = manifestSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    )
    if (canonicalHash(manifest) !== manifestArtifact.sha256)
      throw new Error('HOSTED_MANIFEST_BINDING')
    const blobs = await this.gate.withClaim(claim, async (c) => {
      const result: ArtifactRef[] = []
      for (const f of manifest.files) result.push(await this.ref(c, scope, f.blobId))
      return result
    })
    const source = storedSourceSchema.parse({ manifest, manifestArtifact, blobs })
    await validateStoredSource(this.store, scope, source, catalog)
    await this.gate.withClaim(claim, async () => undefined)
    return source
  }
  async plan(claim: Claim, id: string) {
    const scope = { workspaceId: claim.workspaceId, projectId: claim.projectId, jobId: claim.jobId }
    const ref = await this.gate.withClaim(claim, (c) => this.ref(c, scope, id))
    if (ref.kind !== 'plan' || ref.jobId !== claim.jobId) throw new Error('HOSTED_PLAN_BINDING')
    const plan = planSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await this.store.read(scope, ref))
      )
    )
    await this.gate.withClaim(claim, async () => undefined)
    return plan
  }
  /** Adopt only after the matching provider operation was accounted. This saves
   * recovery evidence, not job-step success; the outbox's fenced settle separately
   * commits the state transition. A crash cannot erase this completed product. */
  async save(
    context: Readonly<HostedGenerationContext>,
    requestInput: GenerationRequest,
    refInput: ArtifactRef,
    signal: AbortSignal
  ) {
    const request = generationRequestSchema.parse(requestInput),
      ref = artifactRefSchema.parse(refInput)
    const scope = batchScope(context.binding)
    signal.throwIfAborted()
    await this.gate.withCurrent(context, async (c) => {
      signal.throwIfAborted()
      const attempt = await one<{ terms_json: unknown; state: string }>(
        c,
        'SELECT terms_json,state FROM provider_attempts WHERE workspace_id=$1 AND project_id=$2 AND job_id=$3 AND step_id=$4 AND operation_id=$5 FOR UPDATE',
        [scope.workspaceId, scope.projectId, scope.jobId, context.stepId, context.operationId]
      )
      const terms = callTermsSchema.parse(attempt.terms_json)
      if (
        !['completed', 'uncertain'].includes(attempt.state) ||
        terms.requestDigest !== canonicalHash(request) ||
        request.requestId !== context.operationId ||
        ref.workspaceId !== scope.workspaceId ||
        ref.projectId !== scope.projectId ||
        ref.jobId !== scope.jobId ||
        ref.backendEvidence !== 'durable' ||
        ref.kind !== (request.stage === 'plan' ? 'plan' : 'provider-product')
      )
        throw new ControlError(409, 'HOSTED_PRODUCT_BINDING')
      const payloads = request.context
        .filter((m) => m.role === 'user')
        .map((m) => {
          try {
            return JSON.parse(m.content) as Record<string, unknown>
          } catch {
            return null
          }
        })
        .filter((m) => m?.kind === 'generation-input')
      if (payloads.length !== 1) throw new ControlError(409, 'HOSTED_PRODUCT_BINDING')
      const batch = request.stage === 'plan' ? 0 : Number(payloads[0]!.batchIndex)
      if (!Number.isSafeInteger(batch) || batch < 0 || batch > 11)
        throw new ControlError(409, 'HOSTED_PRODUCT_BINDING')
      const prior = (
        await c.query(
          'SELECT artifact_id,request_digest FROM hosted_source_products WHERE operation_id=$1',
          [context.operationId]
        )
      ).rows[0]
      if (prior) {
        if (
          prior.artifact_id !== ref.id ||
          prior.request_digest !== canonicalHash(request) ||
          canonicalHash(await this.ref(c, scope, ref.id)) !== canonicalHash(ref)
        )
          throw new ControlError(409, 'HOSTED_PRODUCT_CONFLICT')
        return
      }
      if (request.stage !== 'plan') {
        const count = await one<{ n: number }>(
          c,
          'SELECT count(*)::int AS n FROM hosted_source_products WHERE job_id=$1 AND stage=$2 AND repair_number=$3',
          [scope.jobId, request.stage, context.binding.repairNumber]
        )
        if (count.n !== batch) throw new ControlError(409, 'HOSTED_PRODUCT_ORDER')
      }
      await c.query('SELECT forge_objects.adopt($1,$2,$3,$4)', [
        ref.storageKey,
        ref.storageVersion,
        scope.workspaceId,
        scope.projectId,
      ])
      await c.query(
        `INSERT INTO artifacts(id,workspace_id,project_id,job_id,kind,object_key,object_version,sha256,bytes,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'available')`,
        [
          ref.id,
          scope.workspaceId,
          scope.projectId,
          scope.jobId,
          ref.kind,
          ref.storageKey,
          ref.storageVersion,
          ref.sha256,
          ref.bytes,
        ]
      )
      await c.query(
        `INSERT INTO hosted_source_products(workspace_id,project_id,job_id,step_id,operation_id,stage,repair_number,batch_index,artifact_id,request_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          scope.workspaceId,
          scope.projectId,
          scope.jobId,
          context.stepId,
          context.operationId,
          request.stage,
          context.binding.repairNumber,
          batch,
          ref.id,
          canonicalHash(request),
        ]
      )
      signal.throwIfAborted()
    })
  }
}
