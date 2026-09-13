import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { createVercelHandler } from './vercel.mjs'

let server
afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    server = undefined
  }
})
const configured = {
  FORGE_AUTH_ENABLED: 'true',
  DATABASE_URL: 'postgresql://runtime:synthetic-password@database.test/forge',
  NEON_AUTH_BASE_URL: 'https://auth.test/auth',
  FORGE_APP_ORIGIN: 'https://forge.test',
  FORGE_AUTH_SOCIAL_PROVIDERS: 'google,unknown',
}
async function setup(
  env = configured,
  query = vi.fn(async () => ({ rows: [{ rolsuper: false, rolbypassrls: false }] }))
) {
  const end = vi.fn(async () => {})
  const Pool = vi.fn(function () {
    return { query, end, on: vi.fn() }
  })
  server = createServer(createVercelHandler({ env, Pool }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, Pool, query, end }
}
it('serves real account routes through a shared warm pool and rejects anonymous access', async () => {
  const { url, Pool, query } = await setup()
  const responses = await Promise.all([fetch(url + '/api/config'), fetch(url + '/api/me')])
  expect(await responses[0].json()).toEqual({
    mode: 'cloud',
    authUrl: configured.NEON_AUTH_BASE_URL,
    socialProviders: ['google'],
    accountDeletionEnabled: false,
  })
  expect(responses[1].status).toBe(401)
  expect(Pool).toHaveBeenCalledTimes(1)
  expect(query).toHaveBeenCalledTimes(1)
  expect(
    (await fetch(url + '/api/config', { headers: { Origin: 'https://other.test' } })).status
  ).toBe(403)
})
it.each([
  {},
  { ...configured, FORGE_AUTH_ENABLED: 'false' },
  { ...configured, FORGE_APP_ORIGIN: 'http://forge.test' },
  { ...configured, NEON_AUTH_BASE_URL: 'https://user:secret@auth.test/auth' },
  { ...configured, FORGE_HOSTED_PLANNING_ENABLED: 'true' },
])(
  'fails closed for invalid deployment configuration without creating a database pool',
  async (env) => {
    const { url, Pool } = await setup(env)
    const response = await fetch(url + '/api/config')
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('secret')
    expect(Pool).not.toHaveBeenCalled()
  }
)
it('closes a privileged database connection and permits a later corrected configuration', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ rolsuper: false, rolbypassrls: true }] })
    .mockResolvedValueOnce({ rows: [{ rolsuper: false, rolbypassrls: false }] })
  const { url, Pool, end } = await setup(configured, query)
  expect((await fetch(url + '/api/config')).status).toBe(503)
  expect(end).toHaveBeenCalledTimes(1)
  expect((await fetch(url + '/api/config')).status).toBe(200)
  expect(Pool).toHaveBeenCalledTimes(2)
})
it('does not return database connection errors or credentials to a caller', async () => {
  const { url, end } = await setup(
    configured,
    vi.fn(async () => {
      throw new Error(configured.DATABASE_URL)
    })
  )
  const response = await fetch(url + '/api/config')
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('synthetic-password')
  expect(end).toHaveBeenCalledTimes(1)
})
