import type { ArtifactStore, ArtifactScope } from '../artifacts/store.ts'
import type { PlanV1 } from '../contracts/source.ts'
import type { ProviderAdapter, GenerationRequest } from '../contracts/provider.ts'
import type { ProviderAttemptHooks } from './pipeline.ts'
import type { TemplateCatalog } from './catalog.ts'
import type { StoredSource } from './source.ts'
import { buildCandidate, prepareDiff } from './source.ts'
import { generateFileBatches } from './pipeline.ts'

/** One durable GENERATING_FILES or REPAIRING stage. The E1 adapter supplies
 * accountedProviderHooks and a fenced adopt callback. No runner/approval bypass. */
export async function generateAccountedSource(input: {
  adapter: ProviderAdapter
  store: ArtifactStore
  scope: ArtifactScope
  catalog: TemplateCatalog
  base: StoredSource
  plan: PlanV1
  baseSnapshotId: string | null
  signal: AbortSignal
  hooks: ProviderAttemptHooks
  repairNumber: number
  request: (batchIndex: number, completedPaths: readonly string[]) => GenerationRequest
  adopt: (candidate: StoredSource, diff: Awaited<ReturnType<typeof prepareDiff>>) => Promise<void>
}) {
  if (!Number.isSafeInteger(input.repairNumber) || input.repairNumber < 0 || input.repairNumber > 2)
    throw new Error('PROVIDER_REPAIR_CAP')
  let model: string | undefined, promptVersion: string | undefined
  const generated = await generateFileBatches({
    adapter: input.adapter,
    plan: input.plan,
    base: input.base.manifest,
    protectedPaths: input.catalog.manifest.protectedPaths,
    signal: input.signal,
    hooks: input.hooks,
    request: (index, completedPaths) => {
      const r = input.request(index, completedPaths)
      if (
        r.stage !== (input.repairNumber ? 'repair' : 'files') ||
        (model && r.model !== model) ||
        (promptVersion && r.promptVersion !== promptVersion)
      )
        throw new Error('PROVIDER_SOURCE_BINDING')
      model = r.model
      promptVersion = r.promptVersion
      return r
    },
  })
  input.signal.throwIfAborted()
  const candidate = await buildCandidate(input.store, input.scope, input.catalog, {
    base: input.base,
    plan: input.plan,
    batches: generated.batches,
    baseSnapshotId: input.baseSnapshotId,
    provenance: {
      origin: generated.origin,
      jobId: input.scope.jobId,
      provider: generated.origin === 'provider' ? input.adapter.id : null,
      model: generated.origin === 'provider' ? model! : null,
      promptVersion: promptVersion!,
    },
  })
  const diff = await prepareDiff(input.store, input.scope, input.base, candidate)
  input.signal.throwIfAborted()
  // Atomically validate current stage/epoch/cancellation and persist a NEW execution
  // review over candidate+diff. Every repair returns for approval before execution.
  await input.adopt(candidate, diff)
  return { origin: generated.origin, candidate, diff }
}
