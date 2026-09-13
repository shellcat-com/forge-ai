import { expect, it, vi } from 'vitest'
import { createAccountDeletion } from './account-deletion.mjs'
const user = { id: '11111111-1111-4111-8111-111111111111' }
const env = {
  FORGE_NEON_ADMIN_KEY: 'synthetic-project-key',
  FORGE_NEON_PROJECT_ID: 'test-project-123',
  FORGE_NEON_BRANCH_ID: 'br-test-123',
}
function setup() {
  const pool = {
    query: vi.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValue({ rowCount: 0 }),
  }
  const request = vi.fn().mockResolvedValue({ ok: true })
  return { pool, request, remove: createAccountDeletion({ env, pool, request }) }
}
it('uses only configured scope and the verified identity, then confirms managed deletion', async () => {
  const { remove, pool, request } = setup()
  expect(await remove(user, 'session-secret')).toEqual({ deleted: true })
  expect(pool.query).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining('"createdAt">now()-interval'),
    ['session-secret', user.id]
  )
  expect(request).toHaveBeenCalledWith(
    `https://console.neon.tech/api/v2/projects/test-project-123/branches/br-test-123/auth/users/${user.id}`,
    expect.objectContaining({ method: 'DELETE', redirect: 'error' })
  )
  expect(pool.query).toHaveBeenLastCalledWith('SELECT id FROM neon_auth."user" WHERE id=$1', [
    user.id,
  ])
})
it('refuses expired or non-fresh sessions before contacting the administrative API', async () => {
  const { pool, request, remove } = setup()
  pool.query.mockReset().mockResolvedValue({ rowCount: 0 })
  await expect(remove(user, 'old-session')).rejects.toMatchObject({ status: 403 })
  expect(request).not.toHaveBeenCalled()
})
it('does not claim deletion when the provider returns 404 or leaves the user present', async () => {
  const { pool, request, remove } = setup()
  pool.query.mockReset().mockResolvedValue({ rowCount: 1 })
  request.mockResolvedValue({ ok: false, status: 404 })
  await expect(remove(user, 'session')).rejects.toMatchObject({ status: 503 })
  request.mockResolvedValue({ ok: true })
  await expect(remove(user, 'session')).rejects.toMatchObject({ status: 503 })
})
it('resolves an uncertain response from database evidence without replaying the delete', async () => {
  const { request, remove } = setup()
  request.mockRejectedValue(new Error('timeout'))
  expect(await remove(user, 'session')).toEqual({ deleted: true })
  expect(request).toHaveBeenCalledTimes(1)
})
it('stays disabled without a key and rejects incomplete scope', () => {
  expect(createAccountDeletion({ env: {}, pool: {} })).toBeUndefined()
  expect(() =>
    createAccountDeletion({ env: { FORGE_NEON_ADMIN_KEY: 'synthetic' }, pool: {} })
  ).toThrow()
})
