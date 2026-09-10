import { createAuthClient } from '@neondatabase/auth'
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
export async function connect() {
  const response = await fetch('/api/config', { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Account services are unavailable. Please retry.')
  const config = await response.json()
  if (
    config.mode !== 'cloud' ||
    typeof config.authUrl !== 'string' ||
    !config.authUrl.startsWith('https://')
  )
    throw new Error('Account services need configuration.')
  const auth = createAuthClient(config.authUrl)
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const session = await auth.getSession({ query: { disableCookieCache: true } })
    if (session.error)
      throw new ApiError(
        session.error.status === 401 ? 401 : 503,
        'Could not check your session. Please retry.'
      )
    const sessionToken = session.data?.session.token
    if (!sessionToken) throw new ApiError(401, 'Sign in to continue.')
    const tokenResult = await auth.token()
    if (tokenResult.error)
      throw new ApiError(
        tokenResult.error.status === 401 ? 401 : 503,
        'Could not verify your session. Please retry.'
      )
    const token = tokenResult.data?.token
    if (!token) throw new ApiError(401, 'Sign in to continue.')
    const r = await fetch('/api' + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Forge-Session': sessionToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === '/generate' ? 130000 : 15000),
    })
    const result = await r.json()
    if (!r.ok) throw new ApiError(r.status, result.error || 'Request failed. Please retry.')
    return result as T
  }
  return { auth, api }
}
export type Connection = Awaited<ReturnType<typeof connect>>
export interface Brief {
  name: string
  prompt: string
  template: string
  presetId: string
}
export interface Project extends Brief {
  id: string
  revision: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface Onboarding {
  version: 1
  stage: number
  revision: number
  completedAt: string | null
  projectId: string | null
  draft: { name: string; audience: string; outcome: string; features: string; presetId: string }
}
export interface Me {
  user: { id: string; email: string; name: string }
  onboarding: Onboarding
}
