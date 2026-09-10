import { z } from 'zod'
import { priceAtRates } from '../../../engine/providers/accounting'
import type { Usage, Selection, RunSnapshot } from '../../shared/byok'
import { ByokError } from './transport'
const amount = z.number().int().min(0).max(1_000_000_000)
export const priceSchema = z.strictObject({
  connectionProvider: z.string(),
  baseUrl: z.string().url(),
  modelId: z.string(),
  version: z.string().min(1),
  expiresAt: z.string().datetime(),
  inputMicrosPerMillion: amount,
  outputMicrosPerMillion: amount,
  cachedInputMicrosPerMillion: amount,
  cacheWriteMicrosPerMillion: amount,
  searchMicrosPerCall: amount,
  inputTokenCeiling: z.number().int().min(1024).max(2_000_000),
})
export type Price = z.infer<typeof priceSchema>
export function priceFor(
  provider: string,
  baseUrl: string,
  model: string,
  environment: Record<string, string | undefined> = process.env
): Price | undefined {
  let policies: Price[]
  try {
    policies = z.array(priceSchema).parse(JSON.parse(environment.FORGE_BYOK_PRICES ?? '[]'))
  } catch {
    throw new ByokError('PRICE', 'Server pricing configuration is invalid.', 503)
  }
  const price = policies.find(
    (p) => p.connectionProvider === provider && p.baseUrl === baseUrl && p.modelId === model
  )
  if (price && Date.parse(price.expiresAt) > Date.now() + 120_000) return price
}
export function quote(price: Price, output: number, research: boolean) {
  // Reuse the foundation's exact, separately rounded microdollar arithmetic.
  return (
    priceAtRates(price.inputTokenCeiling, output, {
      version: price.version,
      validFrom: new Date(0).toISOString(),
      expiresAt: price.expiresAt,
      currency: 'USD',
      inputMicrosPerMillion: Math.max(
        price.inputMicrosPerMillion,
        price.cachedInputMicrosPerMillion,
        price.cacheWriteMicrosPerMillion
      ),
      outputMicrosPerMillion: price.outputMicrosPerMillion,
    }) + (research ? price.searchMicrosPerCall : 0)
  )
}
export function observedCost(
  price: Price,
  usage: Usage,
  maxOutput: number,
  research: boolean
): number | undefined {
  if (
    usage.classification !== 'measured' ||
    usage.inputTokens === undefined ||
    usage.outputTokens === undefined ||
    usage.inputTokens > price.inputTokenCeiling ||
    usage.outputTokens > maxOutput
  )
    return
  const cached = usage.cachedInputTokens ?? 0,
    write = usage.cacheWriteTokens ?? 0,
    search = usage.searchCalls ?? 0
  if (cached + write > usage.inputTokens || search > (research ? 1 : 0)) return
  const charge = (tokens: number, rate: number) =>
    Number((BigInt(tokens) * BigInt(rate) + 999999n) / 1000000n)
  return (
    charge(usage.inputTokens - cached - write, price.inputMicrosPerMillion) +
    charge(cached, price.cachedInputMicrosPerMillion) +
    charge(write, price.cacheWriteMicrosPerMillion) +
    charge(usage.outputTokens, price.outputMicrosPerMillion) +
    search * price.searchMicrosPerCall
  )
}
export function inputBound(system: string, prompt: string) {
  return Buffer.byteLength(system + prompt, 'utf8') + 1024
}
export function bindingFor(snapshot: RunSnapshot, s: Selection) {
  const result = snapshot.bindings.find(
    (b) => b.connectionId === s.connectionId && b.modelId === s.modelId
  )
  if (!result)
    throw new ByokError('ROUTING', 'The selected model is outside this run’s approved routing.')
  return result
}
