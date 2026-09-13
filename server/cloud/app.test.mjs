import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudApp } from './app.mjs'
import { HttpError } from './contracts.mjs'
let server
afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    server = undefined
  }
})
async function setup(planner, socialProviders = [], deleteAccount) {
  const store = {
    onboarding: vi.fn(async () => ({ stage: 0 })),
    list: vi.fn(async () => ({ projects: [], nextOffset: null })),
    create: vi.fn(),
    mutate: vi.fn(),
    import: vi.fn(),
  }
  server = createCloudApp({
    store,
    planner,
    socialProviders,
    deleteAccount,
    origin: 'https://forge.test',
    authUrl: 'https://auth.test/auth',
    verify: async (token) => {
      if (token !== 'Bearer valid') throw new HttpError(401, 'Sign in to continue.')
      return { id: 'alice' }
    },
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { store, url: `http://127.0.0.1:${server.address().port}` }
}
const headers = {
  Origin: 'https://forge.test',
  Authorization: 'Bearer valid',
  'Content-Type': 'application/json',
}
describe('cloud API boundary', () => {
  it('binds deletion to the verified caller and refuses injected identities or missing confirmation', async () => {
    const remove = vi.fn(async () => ({ deleted: true }))
    const { url } = await setup(undefined, [], remove)
    for (const body of [{}, { confirmation: 'DELETE', userId: 'someone-else' }]) {
      expect(
        (
          await fetch(url + '/api/account', {
            method: 'DELETE',
            headers,
            body: JSON.stringify(body),
          })
        ).status
      ).toBe(422)
    }
    expect(remove).not.toHaveBeenCalled()
    const response = await fetch(url + '/api/account', {
      method: 'DELETE',
      headers: { ...headers, 'X-Forge-Session': 'synthetic-session' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    })
    expect(await response.json()).toEqual({ deleted: true })
    expect(remove).toHaveBeenCalledWith({ id: 'alice' }, 'synthetic-session')
  })
  it('advertises only explicitly configured OAuth providers', async () => {
    const { url } = await setup(undefined, ['google', 'unknown', 'google'])
    expect(await (await fetch(url + '/api/config')).json()).toEqual({
      mode: 'cloud',
      authUrl: 'https://auth.test/auth',
      socialProviders: ['google'],
      accountDeletionEnabled: false,
    })
  })
  it('defaults to email when no OAuth providers have been configured', async () => {
    const { url } = await setup()
    expect(await (await fetch(url + '/api/config')).json()).toMatchObject({ socialProviders: [] })
  })
  it('distinguishes anonymous, bad origin, invalid JSON and invalid project', async () => {
    const { url } = await setup()
    expect((await fetch(url + '/api/me')).status).toBe(401)
    expect(
      (
        await fetch(url + '/api/projects', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://evil.test' },
          body: '{}',
        })
      ).status
    ).toBe(403)
    expect(
      (await fetch(url + '/api/projects', { method: 'POST', headers, body: 'bad' })).status
    ).toBe(400)
    expect(
      (await fetch(url + '/api/projects', { method: 'POST', headers, body: '{}' })).status
    ).toBe(422)
  })
  it('uses verified identity and never accepts ownership from the client', async () => {
    const { url, store } = await setup()
    expect((await fetch(url + '/api/projects', { headers })).status).toBe(200)
    expect(store.list).toHaveBeenCalledWith('alice', { offset: 0, search: '', deleted: false })
    const body = {
      name: 'Test',
      prompt: 'A long enough test brief for a project.',
      template: 'Next.js + Postgres',
      presetId: 'technical-mono',
      userId: 'bob',
    }
    expect(
      (await fetch(url + '/api/projects', { method: 'POST', headers, body: JSON.stringify(body) }))
        .status
    ).toBe(422)
    expect(store.create).not.toHaveBeenCalled()
  })
  it('requires a revision for writes and refuses unauthenticated planning', async () => {
    const { url } = await setup()
    expect(
      (
        await fetch(url + '/api/projects/3e816246-bb46-4823-9dca-95608fa26447', {
          method: 'DELETE',
          headers,
          body: '{}',
        })
      ).status
    ).toBe(422)
    expect(
      (
        await fetch(url + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status
    ).toBe(401)
  })
  it('plans only an owned, current, non-deleted saved brief', async () => {
    const planner = { run: vi.fn(async () => ({ text: 'Plan' })) }
    const { url, store } = await setup(planner)
    const input = {
      projectId: '3e816246-bb46-4823-9dca-95608fa26447',
      revision: 1,
      model: 'test-model',
    }
    const request = () =>
      fetch(url + '/api/generate', { method: 'POST', headers, body: JSON.stringify(input) })
    store.mutate.mockRejectedValueOnce(new HttpError(404, 'Project not found.'))
    expect((await request()).status).toBe(404)
    expect(planner.run).not.toHaveBeenCalled()
    store.mutate.mockResolvedValue({ revision: 2, deletedAt: null })
    expect((await request()).status).toBe(409)
    expect(planner.run).not.toHaveBeenCalled()
    const saved = { revision: 1, deletedAt: null, prompt: 'Saved brief' }
    store.mutate.mockResolvedValue(saved)
    expect((await request()).status).toBe(200)
    expect(store.mutate).toHaveBeenCalledWith('alice', input.projectId, 'get', {})
    expect(planner.run).toHaveBeenCalledWith(
      saved,
      input.model,
      expect.objectContaining({ aborted: false })
    )
  })
})
