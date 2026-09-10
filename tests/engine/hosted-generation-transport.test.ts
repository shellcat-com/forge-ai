/** Explicit provider HTTP fixtures: contract checks, no live model/price evidence. */
import { describe, expect, it, vi } from 'vitest'
import { ChatCompletionsAdapter } from '../../engine/providers/chat-completions.ts'
import { ProviderRegistry } from '../../engine/providers/registry.ts'
import { hostedCatalog } from '../../engine/providers/hosted-catalog.ts'
import type { HostedProviderId } from '../../engine/providers/hosted-catalog.ts'
import type { GenerationEvent } from '../../engine/contracts/provider.ts'
import { byokPolicy, byokRequest } from './byok-fixtures.ts'
import { plan } from './fixtures.ts'

const secret = 'synthetic-hosted-transport-key'
function setup(id: HostedProviderId, extra: Record<string, unknown> = {}, status = 200) {
  const provider = hostedCatalog.find((p) => p.id === id)!
  const request = { ...byokRequest(), model: provider.models[0] }
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: request.model,
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }],
          usage: { prompt_tokens: 20, completion_tokens: 30, cost: 0 },
          ...extra,
        }),
        { status, headers: { 'content-type': 'application/json' } }
      )
  )
  const getCredential = vi.fn(async () => secret)
  const options = {
    id,
    endpoint: provider.endpoint,
    approvedEndpoints: [provider.endpoint],
    hostedProfile: id,
    model: {
      schemaVersion: 1 as const,
      id: request.model,
      maxInputTokens: 16000,
      maxOutputTokens: 4000,
      capabilities: { streaming: false, structuredOutput: true, toolCalls: false },
    },
    getCredential,
    fetch: transport,
    evidenceOrigin: 'fixture' as const,
  }
  const adapter = new ChatCompletionsAdapter(options)
  const run = async () => {
    const events: GenerationEvent[] = []
    for await (const event of adapter.generate(request, new AbortController().signal))
      events.push(event)
    return events
  }
  return { adapter, options, request, transport, run, getCredential }
}

describe('hosted request dialects', () => {
  it.each(['gemini', 'groq', 'openrouter'] as const)(
    '%s sends one bounded JSON request and keeps fixture provenance',
    async (id) => {
      const f = setup(id)
      expect(await f.run()).toContainEqual(
        expect.objectContaining({ type: 'completed', origin: 'fixture' })
      )
      expect(f.transport).toHaveBeenCalledTimes(1)
      const call = (f.transport.mock.calls as unknown as [string, RequestInit][])[0]
      expect(call[0]).toBe(f.options.endpoint)
      expect(call[1]).toMatchObject({ method: 'POST', redirect: 'error' })
      const body = JSON.parse(String(call[1].body))
      expect(body).toMatchObject({
        model: f.request.model,
        stream: false,
        response_format: { type: 'json_object' },
      })
      expect(body.store).toBeUndefined()
      expect(body.models).toBeUndefined()
      expect(body.tools).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain(secret)
      if (id === 'groq') {
        expect(body).toMatchObject({ max_completion_tokens: 4000, service_tier: 'on_demand' })
        expect(body.max_tokens).toBeUndefined()
      } else {
        expect(body.max_tokens).toBe(4000)
        expect(body.max_completion_tokens).toBeUndefined()
        expect(body.service_tier).toBeUndefined()
      }
      if (id === 'gemini') expect(body.reasoning_effort).toBe('none')
      if (id === 'openrouter')
        expect(body.provider).toEqual({
          allow_fallbacks: false,
          require_parameters: true,
          max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
        })
    }
  )
  it.each(['gemini', 'groq', 'openrouter'] as const)(
    '%s rejects a returned model change and does not retry',
    async (id) => {
      const f = setup(id, { model: 'different-model' })
      expect(await f.run()).toContainEqual(
        expect.objectContaining({ type: 'error', code: 'INVALID_OUTPUT' })
      )
      expect(f.transport).toHaveBeenCalledTimes(1)
    }
  )
  it.each(['gemini', 'groq', 'openrouter'] as const)(
    '%s preserves a quota error without fallback',
    async (id) => {
      const f = setup(id, { error: { message: secret } }, 429)
      const events = await f.run()
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'RATE_LIMIT' }))
      expect(JSON.stringify(events)).not.toContain(secret)
      expect(f.transport).toHaveBeenCalledTimes(1)
    }
  )
  it('rejects reported nonzero OpenRouter cost without adopting the source', async () => {
    const f = setup('openrouter', {
      usage: { prompt_tokens: 20, completion_tokens: 30, cost: 0.01 },
    })
    const events = await f.run()
    expect(events.some((e) => e.type === 'completed')).toBe(false)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'usage', usage: { classification: 'uncertain' } })
    )
  })
  it('rejects a Groq tier switch', async () => {
    expect(await setup('groq', { service_tier: 'performance' }).run()).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'INVALID_OUTPUT' })
    )
  })
  it('rejects profile/endpoint/model mismatch before accessing a credential', () => {
    const f = setup('groq')
    expect(() => new ChatCompletionsAdapter({ ...f.options, hostedProfile: 'gemini' })).toThrow(
      'PROVIDER_PROFILE_MISMATCH'
    )
    expect(
      () =>
        new ChatCompletionsAdapter({
          ...f.options,
          model: { ...f.options.model, id: 'unreviewed-model' },
        })
    ).toThrow('PROVIDER_PROFILE_MISMATCH')
    expect(f.getCredential).not.toHaveBeenCalled()
  })
  it('registry selects the hosted dialect and rejects paid OpenRouter variants', async () => {
    const f = setup('openrouter')
    const policy = {
      ...byokPolicy,
      id: 'openrouter',
      model: f.request.model,
      endpoint: f.options.endpoint,
    }
    const registry = new ProviderRegistry([policy], [policy.endpoint])
    const adapter = registry.adapter('openrouter', f.getCredential, f.transport)
    for await (const event of adapter.generate(f.request, new AbortController().signal)) {
      if (event.type === 'completed') expect(event.origin).toBe('fixture')
    }
    const call = (f.transport.mock.calls as unknown as [string, RequestInit][])[0]
    expect(JSON.parse(String(call[1].body)).provider.allow_fallbacks).toBe(false)
    expect(
      () =>
        new ProviderRegistry(
          [{ ...policy, model: policy.model.replace(':free', '') }],
          [policy.endpoint]
        )
    ).toThrow('PROVIDER_PROFILE_MISMATCH')
  })
})

describe('explicit free-only price policies', () => {
  function freePolicy() {
    const p = hostedCatalog[1]
    return {
      ...byokPolicy,
      id: p.id,
      endpoint: p.endpoint,
      model: p.models[0],
      price: {
        ...byokPolicy.price,
        version: 'synthetic-free-evidence-v1',
        inputMicrosPerMillion: 0,
        outputMicrosPerMillion: 0,
        validFrom: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        freeOnly: true as const,
        entitlementDigest: 'b'.repeat(64),
      },
    }
  }
  it('accepts explicit expiring evidence without pretending a positive price', () => {
    const p = freePolicy()
    expect(
      new ProviderRegistry([p], [p.endpoint]).policy(p.id, 'files').price.inputMicrosPerMillion
    ).toBe(0)
  })
  it.each(['implicit', 'missing-evidence', 'mixed', 'long-lived', 'non-hosted'] as const)(
    'rejects %s zero pricing',
    (kind) => {
      const p = freePolicy()
      const price =
        kind === 'implicit'
          ? { ...p.price, freeOnly: undefined }
          : kind === 'missing-evidence'
            ? { ...p.price, entitlementDigest: undefined }
            : kind === 'mixed'
              ? { ...p.price, outputMicrosPerMillion: 1 }
              : kind === 'long-lived'
                ? { ...p.price, expiresAt: '2099-01-01T00:00:00Z' }
                : p.price
      expect(
        () =>
          new ProviderRegistry(
            [{ ...p, price, ...(kind === 'non-hosted' ? { id: 'unreviewed' } : {}) }],
            [p.endpoint]
          )
      ).toThrow()
    }
  )
})
