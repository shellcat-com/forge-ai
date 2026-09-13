// Loaded only by scripts/serve-cloud-fixture.mjs. Not an authentication implementation.
import type { Connection, Me, Project } from '../../src/cloud/client.ts'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
let signedIn = false
let connected = false
let requestsToday = 0
const project: Project = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Synthetic customer portal',
  prompt: 'A synthetic project for reviewing support requests. No live customer data.',
  template: 'Next.js + Postgres',
  presetId: 'technical-mono',
  revision: 1,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:00:00Z',
  deletedAt: null,
}
const me: Me = {
  user: { id: 'synthetic-user', email: 'qa@example.test', name: 'Synthetic QA' },
  onboarding: {
    version: 1,
    stage: 3,
    revision: 1,
    completedAt: '2026-09-10T00:00:00Z',
    projectId: project.id,
    draft: {
      name: project.name,
      audience: 'QA',
      outcome: 'Verify the interface',
      features: 'View a brief',
      presetId: project.presetId,
    },
  },
}
export async function connect() {
  return {
    auth: {
      getSession: async () => ({
        data: signedIn ? { user: { ...me.user, emailVerified: true } } : null,
      }),
      signIn: {
        email: async ({ email }: { email: string }) => {
          if (email !== me.user.email) return { error: { status: 401 } }
          signedIn = true
          return { data: {} }
        },
      },
      signUp: { email: async () => ({ data: { user: { emailVerified: false } } }) },
      sendVerificationEmail: async () => ({}),
      emailOtp: {
        verifyEmail: async ({ otp }: { otp: string }) =>
          otp === '123456' ? { data: { status: true } } : { error: { status: 400 } },
      },
      signOut: async () => {
        signedIn = false
        return {}
      },
      listAccounts: async () => ({
        data: [{ providerId: 'credential', accountId: 'synthetic-user' }],
      }),
    },
    api: async (path: string, method = 'GET', body?: { key?: string; mode?: string }) => {
      if (!signedIn) throw new ApiError(401, 'Sign in to continue.')
      if (path === '/me') return structuredClone(me)
      if (path.startsWith('/projects?'))
        return { projects: [structuredClone(project)], nextOffset: null }
      if (path === '/projects/' + project.id) return structuredClone(project)
      if (path === '/connections') return { enabled: true, dailyLimit: 20, requestsToday, providers: [{ id: 'deepseek', name: 'DeepSeek', connected, fingerprint: connected ? 'synthetic123' : null, checkedAt: null, models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] }] }
      if (path === '/connections/deepseek') {
        if (method === 'DELETE') { connected = false; return { removed: true } }
        requestsToday++
        if (body?.key === 'invalid-test-key') throw new ApiError(502, 'Provider rejected the synthetic test key.')
        connected = true
        return { connected: true }
      }
      if (path === '/generate') {
        requestsToday++
        return body?.mode === 'website' ? { html: '<!doctype html><html><body><h1>Synthetic frontend</h1><button onclick="this.textContent=\'Clicked\'">Try interaction</button></body></html>' } : { text: 'Synthetic text plan. No provider was called.', truncated: false }
      }
      if (path === '/provider') return { configured: false, models: [] }
      if (path === '/projects/import') {
        signedIn = false
        throw new ApiError(401, 'Synthetic session expired. Sign in again.')
      }
      throw new Error('This action is not included in the synthetic browser fixture.')
    },
  } as unknown as Connection
}
