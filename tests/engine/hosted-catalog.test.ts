import { expect, it, vi } from 'vitest'
import { checkHostedModel, hostedCatalog } from '../../engine/providers/hosted-catalog'
import { providerDestination } from '../../engine/providers/destination'

const key = 'synthetic-provider-key-for-tests'
const input = { provider: 'groq', model: 'openai/gpt-oss-20b', key, freeTierConfirmed: true }
it.each(hostedCatalog)(
  'checks $id through exact metadata endpoints without generating or returning secrets',
  async (provider) => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('error')
      expect(init?.body).toBeUndefined()
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`)
      expect(String(url)).not.toContain(key)
      return String(url).endsWith('/key')
        ? Response.json({ data: { label: 'synthetic', is_free_tier: true } })
        : Response.json({
            data: [
              {
                id: provider.models[0],
                supported_parameters: ['response_format'],
                pricing: { prompt: '0', completion: '0', request: '0' },
              },
            ],
          })
    })
    const result = await checkHostedModel(
      { ...input, provider: provider.id, model: provider.models[0] },
      new AbortController().signal,
      transport
    )
    expect(result).toMatchObject({
      provider: provider.id,
      model: provider.models[0],
      generationVerified: false,
    })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(transport).toHaveBeenCalledTimes(provider.id === 'openrouter' ? 2 : 1)
  }
)
it('rejects unknown providers/models and missing free-tier consent before network access', async () => {
  const transport = vi.fn<typeof fetch>()
  for (const change of [
    { provider: 'other' },
    { model: 'paid-model' },
    { freeTierConfirmed: false },
  ])
    await expect(
      checkHostedModel({ ...input, ...change }, new AbortController().signal, transport)
    ).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
})
it.each([401, 403, 429, 500])(
  'returns safe errors for provider HTTP %s without leaking its response',
  async (status) => {
    const transport = vi.fn<typeof fetch>(async () => new Response(`rejected: ${key}`, { status }))
    await expect(checkHostedModel(input, new AbortController().signal, transport)).rejects.toThrow(
      status === 429 ? 'PROVIDER_LIMIT' : status < 429 ? 'KEY_REJECTED' : 'PROVIDER_UNAVAILABLE'
    )
  }
)
it('does not treat a public OpenRouter catalog as proof that a key works', async () => {
  const transport = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/key') ? new Response(null, { status: 401 }) : Response.json({ data: [] })
  )
  await expect(
    checkHostedModel(
      { ...input, provider: 'openrouter', model: 'openai/gpt-oss-120b:free' },
      new AbortController().signal,
      transport
    )
  ).rejects.toThrow('KEY_REJECTED')
  expect(transport).toHaveBeenCalledTimes(1)
})
it('rejects a free-labelled model if the provider reports any nonzero price', async () => {
  const transport = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/key')
      ? Response.json({ data: { label: 'synthetic' } })
      : Response.json({
          data: [
            {
              id: 'openai/gpt-oss-120b:free',
              supported_parameters: ['response_format'],
              pricing: { prompt: '0', completion: '0', request: '0.01' },
            },
          ],
        })
  )
  await expect(
    checkHostedModel(
      { ...input, provider: 'openrouter', model: 'openai/gpt-oss-120b:free' },
      new AbortController().signal,
      transport
    )
  ).rejects.toThrow('FREE_TIER_REQUIRED')
})
it('allows only reviewed provider paths in addition to the existing explicit endpoint policy', () => {
  for (const provider of hostedCatalog) {
    expect(providerDestination(provider.endpoint, [provider.endpoint]).href).toBe(provider.endpoint)
    expect(() => providerDestination(provider.endpoint, [])).toThrow()
    for (const url of [
      `${provider.endpoint}?key=x`,
      `${provider.endpoint}/other`,
      provider.endpoint.replace('https:', 'http:'),
    ])
      expect(() => providerDestination(url, [url])).toThrow()
  }
})
