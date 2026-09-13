import { HttpError } from './contracts.mjs'

// Use a project-scoped Neon key. It stays on the server; callers never supply
// a project, branch or user ID. Managed auth owns deletion and its cascades.
export function createAccountDeletion({ env = process.env, pool, request = fetch }) {
  const key = env.FORGE_NEON_ADMIN_KEY
  if (!key) return undefined
  const project = env.FORGE_NEON_PROJECT_ID
  const branch = env.FORGE_NEON_BRANCH_ID
  if (!/^[a-z0-9-]{1,100}$/.test(project || '') || !/^br-[a-z0-9-]{1,100}$/.test(branch || ''))
    throw new Error('Account deletion requires an explicit Neon project and branch.')
  return async (user, sessionToken) => {
    if (!/^[0-9a-f-]{36}$/i.test(user.id)) throw new HttpError(401, 'Sign in to continue.')
    const fresh = await pool.query(
      'SELECT id FROM neon_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now() AND "createdAt">now()-interval \'5 minutes\' AND "createdAt"<=now()',
      [sessionToken, user.id]
    )
    if (!fresh.rowCount)
      throw new HttpError(
        403,
        'Sign out and sign in again, then confirm deletion within five minutes.'
      )
    let response
    try {
      response = await request(
        `https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/auth/users/${encodeURIComponent(user.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        }
      )
    } catch {
      // A timeout can happen after deletion. Confirm the actual state below;
      // never replay an administrative request automatically.
    }
    const remaining = await pool.query('SELECT id FROM neon_auth."user" WHERE id=$1', [user.id])
    if (!remaining.rowCount) return { deleted: true }
    if (!response?.ok)
      throw new HttpError(503, 'Account deletion could not be completed. Please retry later.')
    throw new HttpError(503, 'Account deletion is not yet confirmed. Please retry later.')
  }
}
