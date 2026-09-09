import { describe, it, expect, vi } from 'vitest'
import { generate, models, endpoint } from './provider.mjs'
const request = { key: 'test-secret', model: models[0].id, prompt: 'Build a helpful support portal', name: 'portal', template: 'React + Express' }
describe('NVIDIA adapter', () => {
  it('sends credentials only to the fixed NVIDIA endpoint and returns normalized output', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '# Plan' }, finish_reason: 'stop' }] })))
    expect(await generate({ ...request, fetchImpl })).toEqual({ text: '# Plan', model: models[0].id, truncated: false })
    expect(fetchImpl.mock.calls[0][0]).toBe(`${endpoint}/chat/completions`)
    const options = fetchImpl.mock.calls[0][1]
    expect(options.headers.Authorization).toBe('Bearer test-secret')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body).max_tokens).toBe(4096)
  })
  it('rejects arbitrary models without sending the key', async () => {
    const fetchImpl = vi.fn()
    await expect(generate({ ...request, model: 'paid/unknown', fetchImpl })).rejects.toMatchObject({ status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each([401, 403, 404, 429, 500])('redacts provider errors for status %s', async status => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('test-secret private prompt', { status }))
    try { await generate({ ...request, fetchImpl }); expect.fail('must reject') } catch (error) {
      expect(error.message).not.toContain('test-secret')
      expect(error.message).not.toContain('private prompt')
      expect(error.status).toBe(status === 429 ? 429 : 502)
    }
  })
  it.each(['invalid json', '{}', '{"choices":[{"message":{"content":null}}]}'])('rejects malformed or empty responses', async body => {
    await expect(generate({ ...request, fetchImpl: async () => new Response(body) })).rejects.toMatchObject({ status: 502 })
  })
  it('reports truncation', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }))
    expect((await generate({ ...request, fetchImpl })).truncated).toBe(true)
  })
  it('propagates cancellation to the provider request', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.signal).toBe(controller.signal)
      controller.abort()
      options.signal.throwIfAborted()
    })
    await expect(generate({ ...request, signal: controller.signal, fetchImpl })).rejects.toThrow()
  })
})
