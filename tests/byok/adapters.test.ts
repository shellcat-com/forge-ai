import { describe, it, expect, vi } from 'vitest'
import { ModelAdapter } from '../../src/server/byok/adapters'
import { providerDefaults } from '../../src/shared/byok'
import { validateDestination } from '../../src/server/byok/transport'
import { vault, credentialBinding } from '../../src/server/byok/vault'
import { randomUUID } from 'node:crypto'
const request = {
  model: 'test-model',
  prompt: 'Return JSON: {"ok":true}',
  system: 'Test',
  maxTokens: 1024,
  structured: true,
  stream: false,
}
const key = 'test-key-SENTINEL-abc123'
const text = '{"ok":true}'
const envelopes = {
  openai: {
    id: 'req1',
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  anthropic: {
    id: 'req1',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  deepseek: {
    id: 'req1',
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  },
  gemini: {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  },
  groq: {
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  },
  openrouter: {
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  },
  ollama: {
    done: true,
    done_reason: 'stop',
    message: { content: text },
    prompt_eval_count: 10,
    eval_count: 5,
  },
}
for (const provider of Object.keys(envelopes) as Array<keyof typeof envelopes>) {
  it(`normalizes ${provider} without leaking the key into the request body`, async () => {
    const transport = vi.fn(async () => Response.json(envelopes[provider]))
    const model = new ModelAdapter({ provider, ...providerDefaults[provider] }, key, transport)
    const result = await model.generate(request, new AbortController().signal)
    expect(result.text).toBe(text)
    expect(result.usage).toMatchObject({
      classification: 'measured',
      inputTokens: 10,
      outputTokens: 5,
    })
    const calls = transport.mock.calls as unknown[][]
    expect(JSON.stringify(calls[0][1])).not.toContain(key)
    if (provider === 'openrouter')
      expect(calls[0][1]).toMatchObject({
        provider: { require_parameters: true, allow_fallbacks: false },
      })
    if (provider === 'deepseek')
      expect(calls[0][1]).toMatchObject({ thinking: { type: 'disabled' } })
    if (provider === 'anthropic') expect(calls[0][2]).toMatchObject({ 'x-api-key': key })
  })
}
function stream(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const s of parts) c.enqueue(new TextEncoder().encode(s))
        c.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
it('parses split Responses stream frames and requires authoritative completion', async () => {
  const final = JSON.stringify({ type: 'response.completed', response: envelopes.openai })
  const adapter = new ModelAdapter(
    { provider: 'openai', ...providerDefaults.openai },
    key,
    async () =>
      stream([
        'data: {"type":"response.output_text.delta","del',
        'ta":"partial"}\n\ndata: ' + final.slice(0, 30),
        final.slice(30) + '\n\n',
      ])
  )
  expect(
    (await adapter.generate({ ...request, stream: true }, AbortSignal.timeout(1000))).text
  ).toBe(text)
})
it('rejects a stream disconnected before completion', async () => {
  const a = new ModelAdapter(
    { provider: 'deepseek', ...providerDefaults.deepseek },
    key,
    async () => stream(['data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'])
  )
  await expect(
    a.generate({ ...request, stream: true }, AbortSignal.timeout(1000))
  ).rejects.toMatchObject({ code: 'INCOMPLETE' })
})
for (const [status, code] of [
  [401, 'AUTH'],
  [429, 'RATE_LIMIT'],
  [402, 'CREDITS'],
  [503, 'PROVIDER'],
  [302, 'PROVIDER'],
] as const) {
  it(`classifies ${status} and does not retry`, async () => {
    const transport = vi.fn(async () => new Response('private provider error', { status }))
    const a = new ModelAdapter({ provider: 'openai', ...providerDefaults.openai }, key, transport)
    await expect(a.generate(request, AbortSignal.timeout(1000))).rejects.toMatchObject({ code })
    expect(transport).toHaveBeenCalledTimes(1)
  })
}
for (const content of [key, encodeURIComponent(key), Buffer.from(key).toString('base64')])
  it('discards credential echoes', async () => {
    const a = new ModelAdapter(
      { provider: 'deepseek', ...providerDefaults.deepseek },
      key,
      async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] })
    )
    await expect(
      a.generate({ ...request, structured: false }, AbortSignal.timeout(1000))
    ).rejects.toMatchObject({ code: 'SECRET_ECHO' })
  })
it('does not confuse web search citations with arbitrary model text', async () => {
  const a = new ModelAdapter({ provider: 'openai', ...providerDefaults.openai }, key, async () =>
    Response.json(envelopes.openai)
  )
  await expect(
    a.generate({ ...request, research: true }, AbortSignal.timeout(1000))
  ).rejects.toMatchObject({ code: 'NO_SOURCES' })
})
it('retains research citations and tool usage', async () => {
  const a = new ModelAdapter({ provider: 'openai', ...providerDefaults.openai }, key, async () =>
    Response.json({
      ...envelopes.openai,
      output: [
        ...envelopes.openai.output,
        {
          type: 'web_search_call',
          action: {
            sources: [
              { url: 'https://typescriptlang.org/docs/', title: 'Docs' },
              { url: 'javascript:alert(1)' },
            ],
          },
        },
      ],
    })
  )
  const result = await a.generate({ ...request, research: true }, AbortSignal.timeout(1000))
  expect(result.sources).toHaveLength(1)
  expect(result.usage.searchCalls).toBe(1)
})
for (const reason of ['length', 'tool_calls', 'content_filter'])
  it(`rejects incomplete or unsupported output: ${reason}`, async () => {
    const a = new ModelAdapter(
      { provider: 'deepseek', ...providerDefaults.deepseek },
      key,
      async () =>
        Response.json({ choices: [{ finish_reason: reason, message: { content: text } }] })
    )
    await expect(a.generate(request, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: 'INCOMPLETE',
    })
  })
describe('destination policies', () => {
  for (const url of [
    'http://public.example/v1/',
    'https://user:pass@public.example/v1/',
    'https://public.example/v1/?key=secret',
    'https://127.0.0.1/v1/',
    'https://public.example:444/v1/',
    'https://public.example/a/../v1/',
  ]) {
    it(`rejects unsafe base ${url}`, () =>
      expect(() =>
        validateDestination(
          { provider: 'custom', protocol: 'chat-completions', baseUrl: url },
          { FORGE_AUTH_MODE: 'hosted' }
        )
      ).toThrow())
  }
  it('permits local Ollama only in self-hosted mode', () => {
    expect(() =>
      validateDestination(
        { provider: 'ollama', ...providerDefaults.ollama },
        { FORGE_AUTH_MODE: 'local' }
      )
    ).not.toThrow()
    expect(() =>
      validateDestination(
        { provider: 'ollama', ...providerDefaults.ollama },
        { FORGE_AUTH_MODE: 'hosted' }
      )
    ).toThrow()
  })
  it('prevents pretending a custom endpoint is an official provider', () =>
    expect(() =>
      validateDestination({
        provider: 'openai',
        protocol: 'responses',
        baseUrl: 'https://example.com/v1/',
      })
    ).toThrow())
})
it('binds encrypted credentials to owner, destination and revision', async () => {
  const cipher = vault({
    FORGE_BYOK_ACTIVE_KEY: 'v1',
    FORGE_BYOK_KEYRING: JSON.stringify({ v1: 'ab'.repeat(32) }),
  })
  const binding = credentialBinding({
    owner_id: 'alice',
    id: randomUUID(),
    revision: 1,
    provider: 'openai',
    base_url: providerDefaults.openai.baseUrl,
  })
  const encrypted = await cipher.encrypt(binding, key)
  expect(JSON.stringify(encrypted)).not.toContain(key)
  expect(await cipher.decrypt(binding, encrypted)).toBe(key)
  await expect(cipher.decrypt({ ...binding, revision: 2 }, encrypted)).rejects.toThrow()
  await expect(
    cipher.decrypt({ ...binding, destination: 'https://example.com/' }, encrypted)
  ).rejects.toThrow()
})
