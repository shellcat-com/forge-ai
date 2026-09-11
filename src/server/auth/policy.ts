/** Deployment configuration is authority; client headers cannot enable local mode. */
export function authMode(
  env: Readonly<Record<string, string | undefined>> = process.env
): 'local' | 'hosted' {
  const mode = env.FORGE_AUTH_MODE ?? (env.VERCEL ? 'hosted' : 'local')
  if (!['local', 'hosted'].includes(mode) || (env.VERCEL && env.FORGE_AUTH_MODE !== 'hosted'))
    throw new Error('Explicit hosted authentication is required on Vercel')
  return mode as 'local' | 'hosted'
}

export function signupPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env
): 'public' | 'invite' {
  const policy = env.FORGE_SIGNUP_POLICY ?? 'public'
  if (policy !== 'public' && policy !== 'invite') throw new Error('Invalid signup policy')
  return policy
}

export function hostedAuthOrigin(env = process.env): string {
  const value = env.BETTER_AUTH_URL ?? ''
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
    throw new Error('Configure an exact HTTPS BETTER_AUTH_URL')
  return value
}

export function assertAuthRequest(request: Request) {
  if (authMode() !== 'hosted') throw new Error('Hosted authentication is disabled')
  const origin = hostedAuthOrigin(),
    host = new URL(origin).host
  const path = new URL(request.url).pathname
  if (request.headers.get('host') !== host) throw new Error('Forbidden host')
  // OAuth callbacks and verification links are top-level cross-site GETs. Better
  // Auth validates one-use state/tokens and exact callback URLs independently.
  const callback =
    request.method === 'GET' &&
    (/^\/api\/auth\/callback\/(google|github)$/.test(path) ||
      path === '/api/auth/verify-email' ||
      /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{1,256}$/.test(path))
  const sentOrigin = request.headers.get('origin')
  if (
    (!callback && request.headers.get('sec-fetch-site') === 'cross-site') ||
    (sentOrigin && sentOrigin !== origin) ||
    (request.method !== 'GET' && sentOrigin !== origin)
  )
    throw new Error('Forbidden origin')
}
