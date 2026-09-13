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
  return {
    onboarding,
    api: vi.fn(),
    signIn: vi.fn(),
    signedIn: false,
    signUp: vi.fn(async () => ({ data: { user: { emailVerified: false } } })),
    verifyEmail: vi.fn(),
    resend: vi.fn(async () => ({})),
  }
})
vi.mock('./client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Client>()
  return {
    ...actual,
    connect: async () => ({
      accountDeletionEnabled: true,
      auth: {
        signIn: { email: service.signIn },
        signUp: { email: service.signUp },
        emailOtp: { verifyEmail: service.verifyEmail },
        sendVerificationEmail: service.resend,
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
it('rejects failed login, signs in, creates and views a brief, and clears private UI on session expiry and logout', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
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
      if (path === '/projects/test-project')
        return {
          id: 'test-project',
          name: 'Customer portal',
          prompt: 'Track customer support',
          presetId: 'technical-mono',
          revision: 1,
          deletedAt: null,
        }
      if (path === '/connections') return { enabled: false, providers: [] }
      if (path === '/provider') return { configured: false, models: [] }
      if (path === '/account' && method === 'DELETE') return { deleted: true }
      if (path.startsWith('/projects')) return { projects: [], nextOffset: null }
      throw new Error('Unexpected test request ' + path)
    }
  )
  await import('./main.ts')
  const submit = () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  location.hash = '#/signup'
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Give your idea a home.')
  )
  document.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Alice'
  document.querySelector<HTMLInputElement>('[name="email"]')!.value = 'alice@example.test'
  document.querySelector<HTMLInputElement>('[name="password"]')!.value = 'synthetic-password'
  submit()
  await vi.waitFor(() => expect(document.querySelector('[name="otp"]')).not.toBeNull())
  expect(document.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe(
    'alice@example.test'
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  document.querySelector('form')!.dispatchEvent(
    new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: document.querySelector<HTMLButtonElement>('[data-verification="resend"]')!,
    })
  )
  await vi.waitFor(() =>
    expect(service.resend).toHaveBeenCalledWith({
      email: 'alice@example.test',
      callbackURL: location.origin + '/#/login',
    })
  )
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>('form button')!.disabled).toBe(false)
  )
  service.verifyEmail.mockResolvedValueOnce({ error: { status: 400 } })
  document.querySelector<HTMLInputElement>('[name="otp"]')!.value = '000000'
  submit()
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'could not be completed'
    )
  )
  expect(service.api).not.toHaveBeenCalled()
  service.verifyEmail.mockResolvedValueOnce({ data: { status: true } })
  document.querySelector<HTMLInputElement>('[name="otp"]')!.value = '123456'
  submit()
  await vi.waitFor(() => expect(location.hash).toBe('#/login'))
  expect(service.verifyEmail).toHaveBeenLastCalledWith({
    email: 'alice@example.test',
    otp: '123456',
  })
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Welcome to Forge.')
  )
  document.querySelector<HTMLInputElement>('[name="email"]')!.value = 'alice@example.test'
  document.querySelector<HTMLInputElement>('[name="password"]')!.value = 'synthetic-password'
  service.signIn.mockResolvedValueOnce({ error: { status: 401 } })
  submit()
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'could not be completed'
    )
  )
  expect(service.api).not.toHaveBeenCalled()
  expect(document.querySelector('[data-cloud="logout"]')).toBeNull()
  service.signIn.mockImplementation(async () => {
    service.signedIn = true
    return { data: {} }
  })
  submit()
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your idea.'))
  expect(document.body.textContent).not.toContain('could not be completed')
  for (const [name, value] of Object.entries({
    name: 'Customer portal',
    audience: 'Small teams',
    outcome: 'Track customer support',
    features: 'Search and edit requests',
  })) {
    const input = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!
    input.value = value
  }
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
  document.querySelector<HTMLAnchorElement>('a[href="#/project/test-project"]')!.click()
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Customer portal'))
  expect(document.body.textContent).toContain('Saved to your account')
  expect(document.body.textContent).toContain('Track customer support')
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
  await vi.waitFor(() =>
    expect(document.querySelector('main')?.getAttribute('aria-busy')).toBe('false')
  )
  dialog.close()
  document.querySelector<HTMLButtonElement>('[data-cloud="import-preview"]')!.click()
  await vi.waitFor(() => expect(dialog.textContent).toContain('alice@example.test'))
  await vi.waitFor(() =>
    expect(document.querySelector('main')?.getAttribute('aria-busy')).toBe('false')
  )
  // A session can expire while an account-specific dialog is open.
  const { ApiError } = await import('./client.ts')
  service.api.mockRejectedValueOnce(new ApiError(401, 'Sign in to continue.'))
  dialog.querySelector<HTMLButtonElement>('[data-cloud="import-confirm"]')!.click()
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Welcome to Forge.')
  )
  expect(dialog.open).toBe(false)
  expect(document.body.textContent).not.toContain('alice@example.test')
  expect(document.body.textContent).not.toContain('Customer portal')
  document.querySelector<HTMLInputElement>('[name="email"]')!.value = 'alice@example.test'
  document.querySelector<HTMLInputElement>('[name="password"]')!.value = 'synthetic-password'
  submit()
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your account.'))
  location.hash = '#/new'
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your idea.'))
  expect(service.api.mock.calls.filter((x) => x[0] === '/onboarding/start')).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('[data-cloud="logout"]')!.click()
  await vi.waitFor(() =>
    expect(document.querySelector('h1')?.textContent).toBe('Welcome to Forge.')
  )
  expect(document.body.textContent).not.toContain('Customer portal')
  document.querySelector<HTMLInputElement>('[name="email"]')!.value = 'alice@example.test'
  document.querySelector<HTMLInputElement>('[name="password"]')!.value = 'synthetic-password'
  submit()
  await vi.waitFor(() => expect(document.querySelector('[data-cloud="logout"]')).not.toBeNull())
  location.hash = '#/settings'
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Your account.'))
  expect(document.querySelector('[data-form="delete"] [name="password"]')).toBeNull()
  document.querySelector<HTMLInputElement>('[name="confirmation"]')!.value = 'DELETE'
  document
    .querySelector('[data-form="delete"]')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('Your account and saved briefs were deleted.')
  )
  expect(service.api).toHaveBeenCalledWith('/account', 'DELETE', { confirmation: 'DELETE' })
  expect(document.body.textContent).not.toContain('alice@example.test')
})
