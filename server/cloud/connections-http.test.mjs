import { afterEach, expect, it, vi } from 'vitest'
import { createCloudApp } from './app.mjs'
import { HttpError } from './contracts.mjs'
let server
const headers = { Origin: 'https://forge.test', Authorization: 'Bearer valid', 'Content-Type': 'application/json' }
const projectId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
afterEach(async () => {
  server?.closeAllConnections()
  if (server) await new Promise(resolve => server.close(resolve))
})
async function setup() {
  const connections = { save: vi.fn(async () => ({ connected: true })), remove: vi.fn(async () => ({ removed: true })), configuration: vi.fn(async () => ({ enabled: true, providers: [] })), run: vi.fn(async () => ({ text: 'Plan' })) }
  const store = { mutate: vi.fn(async () => ({ revision: 1, deletedAt: null, prompt: 'Owned saved brief' })) }
  server = createCloudApp({ connections, store, origin: 'https://forge.test', authUrl: 'https://auth.test', verify: async token => { if (token !== 'Bearer valid') throw new HttpError(401, 'Sign in.'); return { id: 'alice' } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const post = (path, body, h = headers) => fetch(url + path, { method: 'POST', headers: h, body: JSON.stringify(body) })
  return { url, post, connections, store }
}
it('authenticates key access, rejects foreign origins, custom endpoints and supplied owners', async () => {
  const { url, post, connections } = await setup()
  expect((await fetch(url + '/api/connections')).status).toBe(401)
  expect((await post('/api/connections/deepseek', { key: 'synthetic-key', requestId }, { ...headers, Authorization: '' })).status).toBe(401)
  expect((await post('/api/connections/deepseek', { key: 'synthetic-key', requestId }, { ...headers, Origin: 'https://evil.test' })).status).toBe(403)
  for (const extra of [{ userId: 'bob' }, { endpoint: 'http://127.0.0.1' }]) expect((await post('/api/connections/deepseek', { key: 'synthetic-key', requestId, ...extra })).status).toBe(422)
  expect(connections.save).not.toHaveBeenCalled()
  expect((await post('/api/connections/deepseek', { key: 'synthetic-key', requestId })).status).toBe(200)
  expect(connections.save).toHaveBeenCalledWith('alice', 'deepseek', 'synthetic-key', requestId, expect.any(AbortSignal))
  expect((await fetch(url + '/api/connections/deepseek', { method: 'DELETE', headers, body: '{}' })).status).toBe(200)
  expect(connections.remove).toHaveBeenCalledWith('alice', 'deepseek')
})
it('generates only from an owned current brief and requires a deduplication ID', async () => {
  const { post, connections, store } = await setup()
  const body = { projectId, requestId, revision: 1, provider: 'deepseek', model: 'deepseek-flash', mode: 'website' }
  store.mutate.mockRejectedValueOnce(new HttpError(404, 'Project not found.'))
  expect((await post('/api/generate', body)).status).toBe(404)
  store.mutate.mockResolvedValueOnce({ revision: 2, deletedAt: null })
  expect((await post('/api/generate', body)).status).toBe(409)
  store.mutate.mockResolvedValueOnce({ revision: 1, deletedAt: 'today' })
  expect((await post('/api/generate', body)).status).toBe(409)
  expect((await post('/api/generate', { ...body, requestId: undefined })).status).toBe(422)
  expect(connections.run).not.toHaveBeenCalled()
  expect((await post('/api/generate', body)).status).toBe(200)
  expect(connections.run).toHaveBeenCalledWith('alice', expect.objectContaining({ prompt: 'Owned saved brief' }), body, expect.any(AbortSignal))
})
