import { generationEventSchema, generationRequestSchema, validateProviderResponse } from '../contracts/provider.ts'
import type { GenerationEvent, GenerationRequest, ProviderAdapter } from '../contracts/provider.ts'
import { fileBatchSchema, manifestSchema, planSchema, validateProposal } from '../contracts/source.ts'
import type { FileBatchV1, ManifestV1, PlanV1 } from '../contracts/source.ts'
import { canonicalHash } from '../contracts/canonical.ts'
import { commandPolicySchema } from '../contracts/review.ts'
import type { ExecutionReviewV1 } from '../contracts/review.ts'
import { limits } from '../contracts/primitives.ts'

export interface ProviderAttemptHooks {
  /** Durable E1 reservation/lease check BEFORE dispatch. Must atomically increment
   * the persisted job call count, cap at 12 and reserve bounded possible cost. */
  beforeDispatch(request: GenerationRequest): Promise<{ callNumber: number }>
  /** Persist usage even on failure. Uncertain classifications must retain liability. */
  recordUsage(requestId: string, event: Extract<GenerationEvent, { type: 'usage' }>): Promise<void>
  /** Persist a validated immutable output before advancing or requesting a batch. */
  persistProduct(request: GenerationRequest, product: { origin: 'provider' | 'fixture'; payload: PlanV1 | FileBatchV1 }): Promise<void>
}
export async function collectProduct(adapter: ProviderAdapter, requestInput: GenerationRequest, signal: AbortSignal, hooks: ProviderAttemptHooks) {
  const request = generationRequestSchema.parse(requestInput)
  signal.throwIfAborted()
  const reservation = await hooks.beforeDispatch(request)
  if (!Number.isSafeInteger(reservation.callNumber) || reservation.callNumber < 1 || reservation.callNumber > 12) throw new Error('Persisted provider call cap')
  signal.throwIfAborted()
  const events: GenerationEvent[] = []
  let bytes = 0
  let usageSeen = false
  let completed = false
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const remaining = Math.min(120000, Date.parse(request.deadlineAt) - Date.now())
  if (remaining <= 0 || signal.aborted) {
    signal.removeEventListener('abort', abort)
    throw new Error('Provider request expired before dispatch')
  }
  const timer = setTimeout(abort, remaining)
  let iterator: AsyncIterator<GenerationEvent> | undefined
  try {
    iterator = adapter.generate(request, controller.signal)[Symbol.asyncIterator]()
    while (true) {
      const next = await nextWithinDeadline(iterator.next(), controller.signal)
      if (next.done) break
      const input = next.value
      controller.signal.throwIfAborted()
      const event = generationEventSchema.parse(input)
      if (completed || events.length >= 4096) throw new Error('Provider terminal/event cap')
      if (event.type === 'usage') {
        if (usageSeen) throw new Error('Duplicate provider usage')
        await hooks.recordUsage(request.requestId, event)
        usageSeen = true
      }
      if (event.type === 'completed' || event.type === 'error') completed = true
      bytes += Buffer.byteLength(JSON.stringify(event))
      if (bytes > (request.stage === 'plan' ? limits.planBytes : limits.batchBytes) * 6 + 8192) throw new Error('Provider total event byte cap')
      events.push(event)
    }
    const result = validateProviderResponse(request, events)
    if (!usageSeen) {
      await hooks.recordUsage(request.requestId, { schemaVersion: 1, type: 'usage', usage: { classification: 'uncertain' } })
      usageSeen = true
    }
    controller.signal.throwIfAborted()
    await hooks.persistProduct(request, result)
    return result
  } catch (error) {
    if (!usageSeen) await hooks.recordUsage(request.requestId, { schemaVersion: 1, type: 'usage', usage: { classification: 'uncertain' } })
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.abort()
    // An adapter ignoring cancellation may hang its return too. Never await it;
    // retain uncertain usage and leave remote cancellation to E1 reconciliation.
    if (iterator?.return) void iterator.return().catch(() => undefined)
  }
}
function nextWithinDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Provider request cancelled or timed out'))
  let abort: () => void = () => undefined
  return new Promise<T>((resolve, reject) => {
    abort = () => reject(new Error('Provider request cancelled or timed out'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject)
  }).finally(() => signal.removeEventListener('abort', abort))
}
export async function generatePlan(adapter: ProviderAdapter, request: GenerationRequest, signal: AbortSignal, hooks: ProviderAttemptHooks,
  expected: { briefHash: string; templateDigest: string; presetDigest: string; commandPolicy: ExecutionReviewV1['commandPolicy'] }) {
  if (request.stage !== 'plan') throw new Error('Plan request stage')
  const policy = commandPolicySchema.parse(expected.commandPolicy)
  // Validate semantic bindings before persistProduct is allowed to adopt output.
  const result = await collectProduct(adapter, request, signal, { ...hooks, persistProduct: async (r, product) => {
    const plan = planSchema.parse(product.payload)
    if (plan.briefHash !== expected.briefHash || plan.templateDigest !== expected.templateDigest || plan.presetDigest !== expected.presetDigest)
      throw new Error('Plan content binding mismatch')
    if (canonicalHash(plan.resources) !== canonicalHash(policy.resources) || canonicalHash(plan.network) !== canonicalHash(policy.network)
      || canonicalHash([...plan.requiredChecks].sort()) !== canonicalHash([...policy.requiredChecks].sort())) throw new Error('Plan resource/network/check policy mismatch')
    if (plan.unsupportedRequirements.length) throw new Error('Unsupported requirements require revised plan')
    await hooks.persistProduct(r, product)
  } })
  return { origin: result.origin, plan: planSchema.parse(result.payload) }
}
/** Sequential assembly; approved plan/base come from E1 persisted context. There
 * are no automatic retries or hidden repairs, and no write/execution side effects. */
export async function generateFileBatches(input: {
  adapter: ProviderAdapter; plan: PlanV1; base: ManifestV1; protectedPaths: readonly string[]; signal: AbortSignal; hooks: ProviderAttemptHooks
  request: (batchIndex: number, completedPaths: readonly string[]) => GenerationRequest
}) {
  const plan = planSchema.parse(input.plan)
  const base = manifestSchema.parse(input.base)
  const batches: FileBatchV1[] = []
  let origin: 'provider' | 'fixture' | undefined
  for (let index = 0; index < 12; index++) {
    const request = generationRequestSchema.parse(input.request(index, batches.flatMap(b => b.changes.map(c => c.path))))
    if (request.stage === 'plan') throw new Error('File request stage')
    const result = await collectProduct(input.adapter, request, input.signal, { ...input.hooks, persistProduct: async (r, product) => {
      const batch = fileBatchSchema.parse(product.payload)
      if (batch.batchIndex !== index || batch.planDigest !== canonicalHash(plan) || batch.baseManifestDigest !== canonicalHash(base)) throw new Error('Sequential batch binding mismatch')
      // A synthetic final marker permits pure validation of an incomplete prefix.
      // Never publish it: only the provider's exact validated product is persisted.
      validateProposal(plan, base, [...batches, { ...batch, finalBatch: true }], input.protectedPaths)
      if (origin && origin !== product.origin) throw new Error('Mixed provider/fixture provenance')
      if (batch.finalBatch && plan.fileTasks.some(task => ![...batches, batch].some(b => b.changes.some(c => c.path === task.path)))) throw new Error('Incomplete file tasks')
      await input.hooks.persistProduct(r, product)
    } })
    const batch = fileBatchSchema.parse(result.payload)
    origin = result.origin
    batches.push(batch)
    if (batch.finalBatch) return { origin, batches }
  }
  throw new Error('File generation call cap; incomplete proposal')
}
