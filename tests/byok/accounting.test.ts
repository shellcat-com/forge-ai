import { it, expect } from 'vitest'
import { quote, observedCost } from '../../src/server/byok/accounting'
import { routingSchema, singleModelRouting } from '../../src/shared/byok'
import { randomUUID } from 'node:crypto'
const price = {
  connectionProvider: 'test',
  baseUrl: 'https://example.com/v1/',
  modelId: 'test',
  version: 'test',
  expiresAt: '2099-01-01T00:00:00Z',
  inputMicrosPerMillion: 2000000,
  outputMicrosPerMillion: 8000000,
  cachedInputMicrosPerMillion: 1000000,
  cacheWriteMicrosPerMillion: 3000000,
  searchMicrosPerCall: 10000,
  inputTokenCeiling: 32768,
}
it('conservatively reserves cache writes, output and a search tool call', () =>
  expect(quote(price, 1024, true)).toBe(116496))
it('does not count reasoning output twice', () =>
  expect(
    observedCost(
      price,
      {
        classification: 'measured',
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 40,
        cachedInputTokens: 20,
        searchCalls: 1,
      },
      1024,
      true
    )
  ).toBe(10580))
it('retains uncertainty for missing usage, tool overruns and token overruns', () => {
  expect(observedCost(price, { classification: 'unknown' }, 1024, false)).toBeUndefined()
  expect(
    observedCost(
      price,
      { classification: 'measured', inputTokens: 100, outputTokens: 50, searchCalls: 2 },
      1024,
      true
    )
  ).toBeUndefined()
  expect(
    observedCost(
      price,
      { classification: 'measured', inputTokens: 100, outputTokens: 1025 },
      1024,
      false
    )
  ).toBeUndefined()
})
it('requires explicit cost acknowledgement and bounded Auto candidates', () => {
  const profile = singleModelRouting({ connectionId: randomUUID(), modelId: 'test' })
  profile.limits.acknowledgeUnknownCost = false
  expect(routingSchema.safeParse(profile).success).toBe(false)
  profile.limits.acknowledgeUnknownCost = true
  profile.mode = 'auto'
  expect(routingSchema.safeParse(profile).success).toBe(false)
  profile.mode = 'manual'
  profile.limits.maxCalls = 13
  expect(routingSchema.safeParse(profile).success).toBe(false)
})
