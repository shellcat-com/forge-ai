// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { readDirection } from '../design/direction.ts'
const service = vi.hoisted(() => ({
  onboarding: { version: 1, stage: 1, revision: 1, completedAt: null as string | null, projectId: null, draft: { name: 'Garden', audience: 'Musicians', outcome: 'Explore music', features: 'Play and share loops', presetId: 'technical-mono' } },
  api: vi.fn(),
}))
vi.mock('./client.ts', () => ({
  ApiError: class extends Error {},
  connect: async () => ({
    auth: { getSession: async () => ({ data: { user: { id: 'design-test', emailVerified: true } } }) },
    api: service.api,
  }),
}))
it('saves custom account onboarding, keeps it across Back and feature edits, and submits custom project edits', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  document.body.innerHTML = '<div id="app" tabindex="-1"></div>'
  location.hash = '#/onboarding'
  service.api.mockImplementation(async (path, method, body) => {
    if (path === '/me') return { user: { id: 'design-test', email: 'test@example.test' }, onboarding: structuredClone(service.onboarding) }
    if (path === '/onboarding') {
      if (method === 'PATCH') Object.assign(service.onboarding, body, { revision: service.onboarding.revision + 1 })
      return structuredClone(service.onboarding)
    }
    if (path === '/projects/project-test') return { id: 'project-test', revision: 1, name: 'Garden', prompt: `Audience: Musicians\nCore features: ${service.onboarding.draft.features}`, template: 'React + Express', presetId: 'technical-mono' }
    if (path === '/onboarding/complete') {
      Object.assign(service.onboarding, { completedAt: '2026-09-11T12:00:00Z', stage: 3 })
      return structuredClone(service.onboarding)
    }
    if (path.startsWith('/projects?')) return { projects: [], nextOffset: null }
    if (path === '/provider') return { configured: false, models: [] }
    if (path === '/connections') return { enabled: false, providers: [] }
    throw new Error('Unexpected request: ' + path)
  })
  await import('./main.ts')
  await vi.waitFor(() => expect(document.querySelector('[name=designMode]')).not.toBeNull())
  expect(document.querySelector<HTMLInputElement>('[name=designMode]:checked')?.value).toBe('custom')
  document.querySelector<HTMLTextAreaElement>('[name=designStyle]')!.value = 'Botanical watercolor music app'
  const submit = () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  submit()
  await vi.waitFor(() => expect(service.onboarding.stage).toBe(2))
  expect(readDirection(service.onboarding.draft.features).direction?.style).toBe('Botanical watercolor music app')
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-cloud=back]')?.disabled).toBe(false))
  document.querySelector<HTMLButtonElement>('[data-cloud=back]')!.click()
  await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('[name=designStyle]')?.value).toBe('Botanical watercolor music app'))
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-cloud=back]')?.disabled).toBe(false))
  document.querySelector<HTMLButtonElement>('[data-cloud=back]')!.click()
  await vi.waitFor(() => expect(document.querySelector('[name=features]')).not.toBeNull())
  document.querySelector<HTMLTextAreaElement>('[name=features]')!.value = 'Play, share, and remix loops'
  submit()
  await vi.waitFor(() => expect(service.onboarding.stage).toBe(1))
  expect(readDirection(service.onboarding.draft.features)).toEqual({ brief: 'Play, share, and remix loops', direction: { mode: 'custom', style: 'Botanical watercolor music app', references: '' } })
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('form button.primary')?.disabled).toBe(false))
  submit()
  await vi.waitFor(() => expect(service.onboarding.stage).toBe(2))
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('form button.primary')?.disabled).toBe(false))
  submit()
  await vi.waitFor(() => expect(service.onboarding.completedAt).not.toBeNull())
  await vi.waitFor(() => expect(document.querySelector('form')).toBeNull())
  location.hash = '#/edit/project-test'
  await vi.waitFor(() => expect(document.querySelector('[data-form=project]')).not.toBeNull())
  expect(document.querySelector<HTMLInputElement>('[name=designMode]:checked')?.value).toBe('custom')
  document.querySelector<HTMLTextAreaElement>('[name=designStyle]')!.value = 'Kinetic typography and monochrome'
  submit()
  await vi.waitFor(() => expect(service.api.mock.calls.some(([path, method]) => path === '/projects/project-test' && method === 'PATCH')).toBe(true))
  const call = service.api.mock.calls.find(([path, method]) => path === '/projects/project-test' && method === 'PATCH')!
  expect(readDirection(call[2].brief.prompt).direction?.style).toBe('Kinetic typography and monochrome')
})
