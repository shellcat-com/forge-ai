import { z } from 'zod'
import type { GenerationRequest, ModelDescriptor } from '../contracts/provider.ts'
import { canonicalHash } from '../contracts/canonical.ts'
import { ChatCompletionsAdapter } from './chat-completions.ts'
import { providerDestination } from './destination.ts'
import { hostedProviderId } from './hosted-catalog.ts'
import { assertHostedRequestProfile } from './hosted-request.ts'

export const providerPolicySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  protocol: z.literal('chat-completions-json-v1'),
  endpoint: z.string(),
  model: z.string().regex(/^[a-zA-Z0-9._/:-]{1,120}$/),
  contextWindow: z.number().int().positive().max(2_000_000),
  maxOutputTokens: z.number().int().positive().max(200_000),
  // Bytes + framing upper bound is supported only for reviewed byte-fallback text tokenizers.
  tokenBound: z.literal('utf8-plus-chat-framing-v1'),
  framingTokensPerMessage: z.number().int().min(16).max(1024),
  framingTokensPerRequest: z.number().int().min(64).max(4096),
  price: z.strictObject({
    version: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
    currency: z.literal('USD'),
    inputMicrosPerMillion: z.number().int().nonnegative().max(1_000_000_000),
    outputMicrosPerMillion: z.number().int().nonnegative().max(1_000_000_000),
    validFrom: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    freeOnly: z.literal(true).optional(),
    entitlementDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).refine((p) => {
    const zero = p.inputMicrosPerMillion === 0 && p.outputMicrosPerMillion === 0
    if (zero) return p.freeOnly === true && !!p.entitlementDigest
      && Date.parse(p.expiresAt) > Date.parse(p.validFrom)
      && Date.parse(p.expiresAt) - Date.parse(p.validFrom) <= 86400000
    return p.inputMicrosPerMillion > 0 && p.outputMicrosPerMillion > 0
      && p.freeOnly === undefined && p.entitlementDigest === undefined
  }, 'Free policies require bounded entitlement evidence; mixed or implicit pricing is rejected'),
  acceptance: z.enum(['contract-tested', 'live-verified']),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
})
export type ProviderPolicy = z.infer<typeof providerPolicySchema>
export function inputTokenUpperBound(request: GenerationRequest, policy?: ProviderPolicy): number {
  return request.context.reduce(
    (sum, m) =>
      sum + Buffer.byteLength(m.content, 'utf8') + (policy?.framingTokensPerMessage ?? 32),
    policy?.framingTokensPerRequest ?? 256
  )
}
export function assertModelBounds(request: GenerationRequest, policy: ProviderPolicy) {
  const inputTokens = inputTokenUpperBound(request, policy)
  if (
    request.model !== policy.model ||
    request.maxOutputTokens > policy.maxOutputTokens ||
    inputTokens + request.maxOutputTokens > policy.contextWindow
  )
    throw new Error('PROVIDER_MODEL_BOUND')
  return inputTokens
}
/** No discovery-to-compatibility inference. Admin installs exact policies; only this
 * implemented text/JSON protocol is supported. Catalog reads never probe a key. */
export class ProviderRegistry {
  private readonly policies = new Map<string, ProviderPolicy>()
  constructor(policies: readonly ProviderPolicy[], approvedEndpoints: readonly string[]) {
    for (const input of policies) {
      const p = providerPolicySchema.parse(input)
      providerDestination(p.endpoint, approvedEndpoints)
      const hosted = hostedProviderId.safeParse(p.id)
      if (p.price.freeOnly && !hosted.success) throw new Error('PROVIDER_FREE_POLICY_UNSUPPORTED')
      if (hosted.success) assertHostedRequestProfile(hosted.data, p.endpoint, p.model)
      if (this.policies.has(p.id) || Date.parse(p.price.expiresAt) <= Date.parse(p.price.validFrom))
        throw new Error('PROVIDER_POLICY_INVALID')
      if (
        p.id === 'openai' &&
        (p.endpoint !== 'https://api.openai.com/v1/chat/completions' ||
          p.model !== 'gpt-4.1-2025-04-14' || p.contextWindow > 1047576 || p.maxOutputTokens > 32768)
      )
        throw new Error('PROVIDER_POLICY_INVALID')
      this.policies.set(p.id, structuredClone(p))
    }
  }
  policy(id: string, capability: 'plan' | 'files' | 'repair', now = Date.now()): ProviderPolicy {
    const p = this.policies.get(id)
    if (!p || !['plan', 'files', 'repair'].includes(capability))
      throw new Error('PROVIDER_CAPABILITY_UNAVAILABLE')
    if (now < Date.parse(p.price.validFrom) || now >= Date.parse(p.price.expiresAt))
      throw new Error('PROVIDER_PRICE_EXPIRED')
    return structuredClone(p)
  }
  status() {
    return [...this.policies.values()].map((p) => ({
      id: p.id,
      model: p.model,
      capabilities: ['plan', 'files', 'repair'],
      acceptance: p.acceptance,
      policyDigest: canonicalHash(p),
      liveEnabled: false,
    }))
  }
  adapter(
    id: string,
    getCredential: (signal: AbortSignal) => Promise<string | null>,
    fixtureFetch?: typeof fetch
  ) {
    const p = this.policy(id, 'files')
    const model: ModelDescriptor = {
      schemaVersion: 1,
      id: p.model,
      maxInputTokens: p.contextWindow,
      maxOutputTokens: p.maxOutputTokens,
      capabilities: { streaming: false, structuredOutput: true, toolCalls: false },
    }
    const hosted = hostedProviderId.safeParse(id)
    return new ChatCompletionsAdapter({
      id,
      endpoint: p.endpoint,
      approvedEndpoints: [p.endpoint],
      model,
      getCredential,
      policy: p,
      ...(hosted.success ? { hostedProfile: hosted.data } : {}),
      ...(fixtureFetch ? { fetch: fixtureFetch, evidenceOrigin: 'fixture' as const } : {}),
    })
  }
}
