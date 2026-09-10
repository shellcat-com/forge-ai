import { it, expect, vi, beforeEach } from 'vitest'
const mock = vi.hoisted(() => ({
  docker: vi.fn(async () => ''),
  runtimeInstance: 'fixture-instance',
}))
vi.mock('../../src/server/workspaces/docker', () => mock)
import { createAppPostgres, snapshotAppPostgres } from '../../src/server/workspaces/postgres'
const image = 'sha256:' + 'a'.repeat(64),
  name = 'forge-run-00000000-0000-4000-8000-000000000000'
beforeEach(() => mock.docker.mockClear())
it('creates an unprivileged private database without host ports or mounts', async () => {
  const db = await createAppPostgres(name, name + '-net', image, null)
  expect(db.url).toMatch(/^postgresql:\/\/app_runtime:/)
  const calls = mock.docker.mock.calls as unknown[][],
    args = calls[0][0] as string[]
  expect(args).toContain('--read-only')
  expect(args).toContain('--cap-drop=ALL')
  expect(args).toContain('postgres')
  expect(args).not.toContain('--publish')
  expect(args).not.toContain('--volume')
  expect(args).toContain(image)
  expect(JSON.stringify(calls)).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE')
})
it('rejects a mutable image before allocation', async () => {
  await expect(createAppPostgres(name, name + '-net', 'postgres:latest', null)).rejects.toThrow(
    'immutable'
  )
  expect(mock.docker).not.toHaveBeenCalled()
})
it('restores snapshots as the application role and removes temporary archives', async () => {
  await createAppPostgres(
    name,
    name + '-net',
    image,
    Buffer.from('fixture archive').toString('base64')
  )
  const calls = mock.docker.mock.calls as unknown[][]
  const restore = calls.find((c) => (c[0] as string[]).includes('pg_restore'))![0] as string[]
  expect(restore).toContain('app_runtime')
  expect(restore).toContain('--no-owner')
  expect(restore).toContain('--exit-on-error')
  expect(calls.at(-1)![0] as string[]).toContain('rm')
})
it('fails on an empty backup instead of declaring a successful snapshot', async () => {
  await expect(snapshotAppPostgres(name)).rejects.toThrow('Invalid PostgreSQL snapshot')
})
