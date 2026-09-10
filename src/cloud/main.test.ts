// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type * as Client from './client.ts'
const service = vi.hoisted(() => {
  const onboarding = {
    version: 1,
    stage: 0,
    revision: 1,
    completedAt: null as string | null,
    projectId: null as string | null,
    draft: { name: '', audience: '', outcome: '', features: '', presetId: 'technical-mono' },
  }
  return { onboarding, api: vi.fn(), signedIn: true }
})
vi.mock('./client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Client>()
  return {
    ...actual,
    connect: async () => ({
      auth: {
        getSession: async () => ({
          data: service.signedIn ? { user: { id: 'alice', emailVerified: true } } : null,
        }),
        signOut: async () => {
          service.signedIn = false
          return {}
        },
        listAccounts: async () => ({ data: [{ providerId: 'credential', accountId: 'alice' }] }),
      },
      api: service.api,
    }),
  }
})
it('guides a new user through persisted stages, creates the first brief and clears private UI at logout', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  document.body.innerHTML = '<div id="app" tabindex="-1"></div><dialog id="dialog"></dialog>'
  const dialog = document.querySelector('dialog')!
  dialog.showModal = () => {
    dialog.open = true
  }
  dialog.close = () => {
    dialog.open = false
  }
  location.hash = '#/login'
  service.api.mockImplementation(
    async (path: string, method: string, body: Record<string, unknown>) => {
      if (path === '/me')
        return {
          user: { id: 'alice', email: 'alice@example.test', name: 'Alice' },
          onboarding: structuredClone(service.onboarding),
        }
      if (path === '/onboarding') {
        if (method === 'PATCH')
          Object.assign(service.onboarding, body, { revision: service.onboarding.revision + 1 })
        return structuredClone(service.onboarding)
      }
      if (path === '/onboarding/complete') {
        Object.assign(service.onboarding, {
          stage: 3,
          completedAt: '2026-09-09T00:00:00Z',
          projectId: 'test-project',
        })
        return structuredClone(service.onboarding)
      }
      if (path === '/onboarding/start') {
        Object.assign(service.onboarding, {
          stage: 0,
          completedAt: null,
          projectId: null,
          revision: service.onboarding.revision + 1,
        })
        return structuredClone(service.onboarding)
      }
      if (path.startsWith('/projects')) return { projects: [], nextOffset: null }
      throw new Error('Unexpected test request ' + path)
    }
  )
  await import('./main.ts')
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your idea.'))
  for (const [name, value] of Object.entries({
    name: 'Customer portal',
    audience: 'Small teams',
    outcome: 'Track customer support',
    features: 'Search and edit requests',
  })) {
    const input = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!
    input.value = value
  }
  const submit = () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  submit()
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your direction.'))
  expect(service.onboarding.draft.name).toBe('Customer portal')
  submit()
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Review your brief.')
  )
  submit()
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Your workspace is ready.')
  )
  expect(service.api.mock.calls.filter((x) => x[0] === '/onboarding/complete')).toHaveLength(1)
  location.hash = '#/settings'
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your account.'))
  const callsBeforeTour = service.api.mock.calls.length
  document.querySelector<HTMLButtonElement>('[data-cloud="tour"]')!.click()
  await vi.waitFor(() => expect(dialog.textContent).toContain('Your saved projects'))
  await vi.waitFor(() =>
    expect(document.querySelector('main')?.getAttribute('aria-busy')).toBe('false')
  )
  dialog.querySelector<HTMLButtonElement>('[data-cloud="tour-next"]')!.click()
  await vi.waitFor(() => expect(dialog.textContent).toContain('Your brief and design'))
  expect(service.api.mock.calls.length).toBe(callsBeforeTour)
  dialog.close()
  location.hash = '#/new'
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your idea.'))
  expect(service.api.mock.calls.filter((x) => x[0] === '/onboarding/start')).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('[data-cloud="logout"]')!.click()
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Welcome to Forge.')
  )
  expect(document.body.textContent).not.toContain('Customer portal')
})
