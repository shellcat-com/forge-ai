import { z } from 'zod'
import { canonicalHash } from '../contracts/canonical.ts'
import { generationRequestSchema, usageSchema } from '../contracts/provider.ts'
import type { GenerationRequest } from '../contracts/provider.ts'
import type { ProviderAttemptHooks } from '../generation/pipeline.ts'
import { assertModelBounds, providerPolicySchema } from './registry.ts'
import type { ProviderPolicy } from './registry.ts'

const safe = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const callTermsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    jobId: z.uuid(),
    stepId: z.uuid(),
    leaseEpoch: safe.positive(),
    requestId: z.uuid(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    credentialId: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
    credentialRevision: safe.positive(),
    provider: z.string(),
    model: z.string(),
    destination: z.string().url(),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    price: providerPolicySchema.shape.price,
    priceVersion: z.string(),
    priceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    inputTokenBound: safe.positive(),
    outputTokenBound: safe.positive(),
    maximumMicros: safe,
    repairNumber: safe.max(2),
    stage: z.enum(['plan', 'files', 'repair']),
    deadlineAt: z.iso.datetime(),
  })
  .refine((t) => (t.stage === 'repair') === t.repairNumber > 0, 'Repair stage binding')
  .refine(
    (t) =>
      t.priceVersion === t.price.version &&
      t.priceDigest === canonicalHash(t.price) &&
      t.maximumMicros === priceAtRates(t.inputTokenBound, t.outputTokenBound, t.price),
    'Price binding'
  )
export type CallTerms = z.infer<typeof callTermsSchema>
export interface CallScope {
  workspaceId: string
  projectId: string
  jobId: string
  requestId: string
}
export interface CallReceipt extends CallScope {
  termsDigest: string
  callNumber: number
}
export type CallSettlement =
  | {
      classification: 'measured'
      inputTokens: number
      outputTokens: number
      amountMicros: number
      usageDigest: string
    }
  | { classification: 'uncertain'; usageDigest: string }
export interface CallAccounting {
  /** Atomic durable subreservation under the job's already reserved global and
   * workspace envelope. Existing requestId returns no new dispatch permission. */
  reserve(terms: CallTerms): Promise<{ receipt: CallReceipt; created: boolean }>
  /** Fresh job/lease/cancellation/budget/credential-revision checks; one CAS winner. */
  dispatch(receipt: CallReceipt): Promise<boolean>
  /** Tenant/job scoped; authenticated late usage can settle expired leases without
   * authorizing source writes. Identical digest no-ops; conflicting measurements fail. */
  settle(receipt: CallReceipt, settlement: CallSettlement): Promise<void>
}
/** Exact integer ceiling in USD microdollars. Never float-price a token count. */
export function priceTokens(input: number, output: number, policy: ProviderPolicy): number {
  safe.parse(input)
  safe.parse(output)
  const price = providerPolicySchema.parse(policy).price
  return priceAtRates(input, output, price)
}
export function priceAtRates(
  input: number,
  output: number,
  price: ProviderPolicy['price']
): number {
  safe.parse(input)
  safe.parse(output)
  const amount =
    (BigInt(input) * BigInt(price.inputMicrosPerMillion) + 999999n) / 1000000n +
    (BigInt(output) * BigInt(price.outputMicrosPerMillion) + 999999n) / 1000000n
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PROVIDER_PRICE_OVERFLOW')
  return Number(amount)
}
export function callTerms(
  requestInput: GenerationRequest,
  policyInput: ProviderPolicy,
  binding: Pick<
    CallTerms,
    | 'workspaceId'
    | 'projectId'
    | 'jobId'
    | 'stepId'
    | 'leaseEpoch'
    | 'credentialId'
    | 'credentialRevision'
    | 'repairNumber'
  >,
  now = Date.now()
): CallTerms {
  const request = generationRequestSchema.parse(requestInput),
    policy = providerPolicySchema.parse(policyInput)
  if (
    now < Date.parse(policy.price.validFrom) ||
    now >= Date.parse(policy.price.expiresAt) ||
    Date.parse(request.deadlineAt) > Date.parse(policy.price.expiresAt) ||
    Date.parse(request.deadlineAt) <= now
  )
    throw new Error('PROVIDER_PRICE_EXPIRED')
  const inputTokenBound = assertModelBounds(request, policy)
  return callTermsSchema.parse({
    schemaVersion: 1,
    ...binding,
    requestId: request.requestId,
    requestDigest: canonicalHash(request),
    provider: policy.id,
    model: policy.model,
    destination: policy.endpoint,
    policyDigest: canonicalHash(policy),
    price: policy.price,
    priceVersion: policy.price.version,
    priceDigest: canonicalHash(policy.price),
    inputTokenBound,
    outputTokenBound: request.maxOutputTokens,
    maximumMicros: priceTokens(inputTokenBound, request.maxOutputTokens, policy),
    stage: request.stage,
    deadlineAt: request.deadlineAt,
  })
}
/** Hook instances are private to a single durable step. No retries or paid fallback.
 * Authorization/budget absence is a hard error before the adapter sees a key. */
export function accountedProviderHooks(input: {
  accounting: CallAccounting
  policy: ProviderPolicy
  binding: Parameters<typeof callTerms>[2]
  persistProduct: ProviderAttemptHooks['persistProduct']
}): ProviderAttemptHooks {
  const calls = new Map<string, { receipt: CallReceipt; terms: CallTerms }>()
  const policy = providerPolicySchema.parse(input.policy),
    binding = structuredClone(input.binding)
  return {
    async beforeDispatch(request) {
      const terms = callTerms(request, policy, binding)
      const reserved = await input.accounting.reserve(terms)
      if (
        !reserved.created ||
        reserved.receipt.termsDigest !== canonicalHash(terms) ||
        reserved.receipt.callNumber < 1 ||
        reserved.receipt.callNumber > 12
      )
        throw new Error('PROVIDER_CALL_ALREADY_RESERVED')
      calls.set(request.requestId, { receipt: reserved.receipt, terms })
      if (!(await input.accounting.dispatch(reserved.receipt)))
        throw new Error('PROVIDER_DISPATCH_DENIED')
      return { callNumber: reserved.receipt.callNumber }
    },
    async recordUsage(requestId, event) {
      const call = calls.get(requestId)
      if (!call) throw new Error('PROVIDER_CALL_NOT_RESERVED')
      const usage = usageSchema.parse(event.usage)
      const measurable =
        usage.classification === 'measured' &&
        usage.inputTokens !== undefined &&
        usage.outputTokens !== undefined &&
        usage.inputTokens <= call.terms.inputTokenBound &&
        usage.outputTokens <= call.terms.outputTokenBound
      const usageDigest = canonicalHash(usage)
      const settlement: CallSettlement = measurable
        ? {
            classification: 'measured',
            inputTokens: usage.inputTokens!,
            outputTokens: usage.outputTokens!,
            amountMicros: priceTokens(usage.inputTokens!, usage.outputTokens!, policy),
            usageDigest,
          }
        : { classification: 'uncertain', usageDigest }
      await input.accounting.settle(call.receipt, settlement)
    },
    async persistProduct(request, product) {
      const call = calls.get(request.requestId)
      if (!call || call.terms.requestDigest !== canonicalHash(request))
        throw new Error('PROVIDER_CALL_BINDING')
      // The callback must recheck the current E1 lease before adopting immutable source.
      await input.persistProduct(request, product)
    },
  }
}
