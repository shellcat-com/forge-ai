import { describe, it, expect, vi } from 'vitest'
import { generate, deepseekModels } from './provider.mjs'
const request = { key: 'fake-local-secret', provider: 'deepseek', model: deepseekModels[0].id, name: 'Respawn', prompt: 'Build a gaming marketplace frontend', template: 'React + Express' }
const result = (content, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }))
describe('direct DeepSeek frontend generation', () => {
  it('sends the key only to the fixed direct endpoint, with the requested model', async () => {
    const html = '<!doctype html><html><body>Marketplace</body></html>'
    const fetchImpl = vi.fn(async () => result(html))
    expect(await generate({ ...request, mode: 'website', fetchImpl })).toEqual({ html, provider: 'DeepSeek', model: request.model })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options.redirect).toBe('error')
    expect(options.headers.Authorization).toBe('Bearer fake-local-secret')
    expect(JSON.parse(options.body).model).toBe(request.model)
  })
  it.each([['<!doctype html><html>partial', 'stop'], ['<!doctype html><html></html>', 'length'], ['# A plan instead', 'stop']])('rejects incomplete frontend output', async (content, finish) => {
    await expect(generate({ ...request, mode: 'website', fetchImpl: async () => result(content, finish) })).rejects.toMatchObject({ status: 502 })
  })
  it('does not transmit credentials with an arbitrary provider/model', async () => {
    const fetchImpl = vi.fn()
    await expect(generate({ ...request, model: 'untrusted-model', fetchImpl })).rejects.toMatchObject({ status: 400 })
    await expect(generate({ ...request, provider: 'https://elsewhere.example', fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('reports depleted balance without exposing the upstream response', async () => {
    await expect(generate({ ...request, fetchImpl: async () => new Response('fake-local-secret', {status:402}) })).rejects.toThrow('DeepSeek account has insufficient balance.')
  })
})
