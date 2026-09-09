import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { request } from 'node:http'
import { models } from './provider.mjs'
const servers = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))) })
async function setup(options = {}) {
  const app = createApp(options)
  servers.push(app)
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${app.address().port}`
  return (path, init = {}) => new Promise((resolve, reject) => {
    const req = request(`${url}${path}`, { method: init.method || 'GET', signal: init.signal, headers: { Host: '127.0.0.1:3001', ...init.headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve(new Response(text, { status: res.statusCode })))
    })
    req.on('error', reject)
    req.end(init.body)
  })
}
const body = JSON.stringify({ model: models[0].id, name: 'portal', prompt: 'Build a support portal with inboxes', template: 'React + Express' })
const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
const good = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Plan' }, finish_reason: 'stop' }] }))
describe('local API boundary', () => {
  it('never serializes a configured secret', async () => {
    const call = await setup({ key: 'private-secret' })
    const response = await call('/api/provider')
    const text = await response.text()
    expect(text).not.toContain('private-secret')
    expect(JSON.parse(text).configured).toBe(true)
  })
  it('keeps generation unavailable without a key', async () => {
    const fetchImpl = vi.fn()
    const call = await setup({ fetchImpl })
    expect((await call('/api/generate', post)).status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('denies cross-origin and DNS-rebinding requests', async () => {
    const call = await setup({ key: 'secret' })
    expect((await call('/api/generate', { ...post, headers: { ...post.headers, Origin: 'https://evil.example' } })).status).toBe(403)
    expect((await call('/api/provider', { headers: { Host: 'evil.example' } })).status).toBe(403)
    expect((await call('/api/provider', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
  })
  it('validates the body and model before spending quota', async () => {
    const fetchImpl = vi.fn(async () => good())
    const call = await setup({ key: 'secret', fetchImpl, dailyLimit: 1 })
    expect((await call('/api/generate', { ...post, body: 'invalid' })).status).toBe(400)
    expect((await call('/api/generate', { ...post, body: JSON.stringify({ ...JSON.parse(body), model: 'paid/model' }) })).status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect((await call('/api/generate', post)).status).toBe(200)
    expect((await call('/api/generate', post)).status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('caps input size', async () => {
    const call = await setup({ key: 'secret' })
    expect((await call('/api/generate', { ...post, body: JSON.stringify({ ...JSON.parse(body), prompt: 'a'.repeat(25000) }) })).status).toBe(413)
  })
  it('times out upstream requests without leaking errors', async () => {
    const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private-secret'))))
    const call = await setup({ key: 'secret', timeoutMs: 15, fetchImpl })
    const response = await call('/api/generate', post)
    expect(response.status).toBe(504)
    expect(await response.text()).not.toContain('private-secret')
  })
  it('bounds concurrency and cancels upstream on client disconnect', async () => {
    let started
    const ready = new Promise(resolve => { started = resolve })
    let aborted
    const cancelled = new Promise(resolve => { aborted = resolve })
    const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
      started()
      signal.addEventListener('abort', () => { aborted(); reject(new Error('cancelled')) })
    })
    const call = await setup({ key: 'secret', fetchImpl })
    const controller = new AbortController()
    const pending = call('/api/generate', { ...post, signal: controller.signal }).catch(() => null)
    await ready
    expect((await call('/api/generate', post)).status).toBe(429)
    controller.abort()
    await cancelled
    await pending
  })
})
