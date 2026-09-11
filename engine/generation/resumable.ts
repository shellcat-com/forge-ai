import { z } from 'zod'
import { artifactRefSchema, artifactScopeSchema } from '../artifacts/store.ts'
import type { ArtifactRef, ArtifactScope, ArtifactStore } from '../artifacts/store.ts'
import { canonicalHash } from '../contracts/canonical.ts'
import { fileBatchSchema, planSchema, validateProposal } from '../contracts/source.ts'
import type { FileBatchV1, PlanV1 } from '../contracts/source.ts'
import { digest, uuid } from '../contracts/primitives.ts'
import type { GenerationRequest, ProviderAdapter } from '../contracts/provider.ts'
import { collectProduct } from './pipeline.ts'
import type { ProviderAttemptHooks } from './pipeline.ts'
import type { TemplateCatalog } from './catalog.ts'
import type { StoredSource } from './source.ts'
import { buildCandidate, prepareDiff, validateStoredSource } from './source.ts'

export const batchBindingSchema = z.strictObject({
  ...artifactScopeSchema.shape,
  credentialId: uuid,
  credentialRevision: z.number().int().positive(),
  provider: z.string().min(1).max(60),
  model: z.string().min(1).max(120),
  providerPolicyDigest: digest,
  promptVersion: z.string().min(1).max(120),
  repairNumber: z.number().int().min(0).max(2),
})
export type BatchBinding = z.infer<typeof batchBindingSchema>
export const batchScope = (b: BatchBinding): ArtifactScope => ({
  workspaceId: b.workspaceId,
  projectId: b.projectId,
  jobId: b.jobId,
})
const savedBatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: batchBindingSchema,
  requestId: uuid,
  requestDigest: digest,
  origin: z.enum(['provider', 'fixture']),
  batch: fileBatchSchema,
})

/** Refs must come from the authoritative job's adopted product list, never an
 * HTTP body. Store reads verify scope, immutable version, byte length and hash.
 * No plaintext source/batches are stored in control metadata or queue messages. */
export async function readSavedBatches(input: {
  store: ArtifactStore
  binding: BatchBinding
  refs: readonly ArtifactRef[]
  plan: PlanV1
  base: StoredSource
  catalog: TemplateCatalog
  expectedOrigin: 'provider' | 'fixture'
}) {
  const binding = batchBindingSchema.parse(input.binding)
  const refs = input.refs.map((r) => artifactRefSchema.parse(r))
  if (refs.length > 12 || new Set(refs.map((r) => r.id)).size !== refs.length)
    throw new Error('PROVIDER_BATCH_HISTORY_INVALID')
  const batches: FileBatchV1[] = []
  const requests = new Set<string>()
  for (const ref of refs) {
    if (
      ref.kind !== 'provider-product' ||
      ref.jobId !== binding.jobId ||
      ref.backendEvidence !== input.store.evidence
    )
      throw new Error('PROVIDER_BATCH_HISTORY_INVALID')
    const bytes = await input.store.read(batchScope(binding), ref)
    const saved = savedBatchSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    )
    if (
      canonicalHash(saved.binding) !== canonicalHash(binding) ||
      saved.origin !== input.expectedOrigin ||
      requests.has(saved.requestId) ||
      saved.batch.batchIndex !== batches.length ||
      batches.at(-1)?.finalBatch
    )
      throw new Error('PROVIDER_BATCH_HISTORY_INVALID')
    requests.add(saved.requestId)
    batches.push(saved.batch)
    validatePrefix(input.plan, input.base, batches, input.catalog)
  }
  return batches
}
function validatePrefix(
  plan: PlanV1,
  base: StoredSource,
  batches: FileBatchV1[],
  catalog: TemplateCatalog
) {
  const last = batches.at(-1)
  if (!last) return
  // Pure prefix validation only. The synthetic marker is never saved or returned.
  validateProposal(
    plan,
    base.manifest,
    [...batches.slice(0, -1), { ...last, finalBatch: true }],
    catalog.manifest.protectedPaths
  )
  if (
    last.finalBatch &&
    plan.fileTasks.some((t) => !batches.some((b) => b.changes.some((c) => c.path === t.path)))
  )
    throw new Error('PROVIDER_BATCH_INCOMPLETE')
}

export interface ResumableFilesInput {
  adapter: ProviderAdapter
  store: ArtifactStore
  catalog: TemplateCatalog
  binding: BatchBinding
  base: StoredSource
  plan: PlanV1
  baseSnapshotId: string | null
  savedProducts: readonly ArtifactRef[]
  expectedOrigin: 'provider' | 'fixture'
  signal: AbortSignal
  hooks: ProviderAttemptHooks
  request(batchIndex: number, completedPaths: readonly string[]): GenerationRequest
  /** Check current parent account/session, key revision, lease and cancellation.
   * Persist/adopt callbacks must repeat these checks in their DB transaction. */
  assertCurrent(): Promise<void>
  saveProduct(request: GenerationRequest, ref: ArtifactRef): Promise<void>
  scan(source: StoredSource): Promise<void>
  adopt(candidate: StoredSource, diff: Awaited<ReturnType<typeof prepareDiff>>): Promise<void>
}
export type ResumableFilesResult =
  | { state: 'continue'; products: ArtifactRef[]; nextBatchIndex: number }
  | { state: 'candidate'; products: ArtifactRef[]; candidate: StoredSource; diff: ArtifactRef }

/** Exactly zero or one accounted provider call per durable worker step. A final
 * saved batch can be assembled after a restart without reissuing any model call.
 * An unknown dispatch without a saved product remains uncertain in E1; callers
 * must reconcile it, not give this function a new operation ID and retry it. */
export async function generateResumableFiles(
  input: ResumableFilesInput
): Promise<ResumableFilesResult> {
  const binding = batchBindingSchema.parse(input.binding)
  const scope: ArtifactScope = {
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    jobId: binding.jobId,
  }
  const plan = planSchema.parse(input.plan)
  if (
    input.adapter.id !== binding.provider ||
    plan.templateDigest !== input.base.manifest.template.digest ||
    plan.presetDigest !== input.base.manifest.presetDigest ||
    plan.unsupportedRequirements.length ||
    (input.expectedOrigin === 'provider' &&
      (input.store.evidence !== 'durable' || input.catalog.evidence !== 'release'))
  )
    throw new Error('PROVIDER_SOURCE_CONFIGURATION')
  input.signal.throwIfAborted()
  await input.assertCurrent()
  await validateStoredSource(input.store, scope, input.base, input.catalog)
  const batches = await readSavedBatches({ ...input, binding, refs: input.savedProducts })
  const products = [...input.savedProducts]
  if (!batches.at(-1)?.finalBatch) {
    if (batches.length >= 12) throw new Error('PROVIDER_CALL_CAP')
    const request = input.request(
      batches.length,
      batches.flatMap((b) => b.changes.map((c) => c.path))
    )
    if (
      request.model !== binding.model ||
      request.promptVersion !== binding.promptVersion ||
      request.stage !== (binding.repairNumber ? 'repair' : 'files')
    )
      throw new Error('PROVIDER_SOURCE_BINDING')
    await input.assertCurrent()
    const result = await collectProduct(input.adapter, request, input.signal, {
      ...input.hooks,
      persistProduct: async (r, product) => {
        if (product.origin !== input.expectedOrigin) throw new Error('PROVIDER_SOURCE_ORIGIN')
        const batch = fileBatchSchema.parse(product.payload)
        if (batch.batchIndex !== batches.length) throw new Error('PROVIDER_BATCH_ORDER')
        validatePrefix(plan, input.base, [...batches, batch], input.catalog)
        input.signal.throwIfAborted()
        await input.assertCurrent()
        // The accounting hook validates this exact request/product before storage.
        await input.hooks.persistProduct(r, product)
        const ref = await input.store.putJson(
          scope,
          'provider-product',
          savedBatchSchema.parse({
            schemaVersion: 1,
            binding,
            requestId: r.requestId,
            requestDigest: canonicalHash(r),
            origin: product.origin,
            batch,
          })
        )
        input.signal.throwIfAborted()
        await input.assertCurrent()
        await input.saveProduct(r, ref)
        products.push(ref)
      },
    })
    batches.push(fileBatchSchema.parse(result.payload))
  }
  input.signal.throwIfAborted()
  if (!batches.at(-1)?.finalBatch)
    return { state: 'continue', products, nextBatchIndex: batches.length }
  await input.assertCurrent()
  const candidate = await buildCandidate(input.store, scope, input.catalog, {
    base: input.base,
    plan,
    batches,
    baseSnapshotId: input.baseSnapshotId,
    provenance: {
      origin: input.expectedOrigin,
      jobId: binding.jobId,
      provider: input.expectedOrigin === 'provider' ? binding.provider : null,
      model: input.expectedOrigin === 'provider' ? binding.model : null,
      promptVersion: binding.promptVersion,
    },
  })
  await input.scan(candidate)
  input.signal.throwIfAborted()
  const diff = await prepareDiff(input.store, scope, input.base, candidate)
  await input.assertCurrent()
  input.signal.throwIfAborted()
  await input.adopt(candidate, diff)
  return { state: 'candidate', products, candidate, diff: diff.artifact }
}
