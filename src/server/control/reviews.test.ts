/** Route composition doubles only; actual ownership/encryption/approval SQL is
 * covered by hosted-generation-gate.native.test.ts. No remote request is made. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  check: vi.fn(),
  end: vi.fn(),
  plan: vi.fn(),
  approve: vi.fn(),
}))
vi.mock('./hosted', () => ({ hostedActor: mocks.actor }))
vi.mock('../../../engine/artifacts/postgres-backend', () => ({
  PostgresCiphertextTransport: class {
    evidence = 'durable'
    pool = { end: mocks.end }
    check = mocks.check
  },
}))
vi.mock('../../../engine/control/hosted-reviews', () => ({
  HostedReviews: class {
    plan = mocks.plan
    approvePlan = mocks.approve
  },
}))
import { GET, POST } from '../../app/api/control/jobs/[id]/plan/route'
const id = randomUUID(),
  workspace = randomUUID(),
  token = 'synthetic-server-session',
  csrf = 'synthetic-server-csrf'
const globals = globalThis as unknown as { forgeHostedReviewReader?: unknown }
const context = () => ({ params: Promise.resolve({ id }) })
const request = (
  body: unknown = { schemaVersion: 1, stateVersion: 2, subjectDigest: 'a'.repeat(64) },
  key: string | null = randomUUID()
) =>
  new Request(`https://forge.example/api/control/jobs/${id}/plan`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
      origin: 'https://forge.example',
    },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  delete globals.forgeHostedReviewReader
  vi.stubEnv('FORGE_HOSTED_SOURCE_REVIEW', 'true')
  vi.stubEnv('FORGE_CONTROL_DATABASE_HOST', 'db.neon.tech')
  vi.stubEnv(
    'FORGE_OBJECT_READER_DATABASE_URL',
    'postgresql://synthetic_reader:synthetic-password@db.neon.tech/forge_control_v1?sslmode=verify-full'
  )
  vi.stubEnv('FORGE_OBJECT_KEY_REFERENCES_JSON', JSON.stringify({ test: 'FORGE_OBJECT_KEY_TEST' }))
  vi.stubEnv('FORGE_OBJECT_KEY_ID', 'test')
  vi.stubEnv('FORGE_OBJECT_KEY_TEST', '1'.repeat(64))
  mocks.actor.mockResolvedValue({
    sessionToken: token,
    csrfToken: csrf,
    workspaceId: workspace,
    control: { db: {}, bridge: {} },
  })
  mocks.check.mockResolvedValue(undefined)
  mocks.end.mockResolvedValue(undefined)
  mocks.plan.mockResolvedValue({
    schemaVersion: 1,
    origin: 'hosted',
    jobId: id,
    plan: { synthetic: true },
  })
  mocks.approve.mockResolvedValue({
    status: 200,
    body: { schemaVersion: 1, origin: 'hosted', jobId: id, state: 'GENERATING' },
  })
})
afterEach(() => {
  delete globals.forgeHostedReviewReader
  vi.unstubAllEnvs()
})
it('is unavailable by default before creating a reader or using account credentials', async () => {
  vi.stubEnv('FORGE_HOSTED_SOURCE_REVIEW', 'false')
  const response = await GET(new Request('https://forge.example'), context())
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.actor).not.toHaveBeenCalled()
  expect(mocks.check).not.toHaveBeenCalled()
})
it('uses only the authenticated server identity and checks the restricted reader once', async () => {
  const response = await GET(new Request('https://forge.example'), context())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.plan).toHaveBeenCalledWith(token, workspace, id)
  await GET(new Request('https://forge.example'), context())
  expect(mocks.check).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(await response.json())).not.toContain(token)
})
it('passes explicit approval and idempotency under mutation authorization without returning server tokens', async () => {
  const key = randomUUID(),
    body = { schemaVersion: 1, stateVersion: 2, subjectDigest: 'a'.repeat(64) },
    req = request(body, key)
  const response = await POST(req, context())
  expect(mocks.actor).toHaveBeenCalledWith(req, true)
  expect(mocks.approve).toHaveBeenCalledWith(token, workspace, csrf, id, key, body)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    origin: 'hosted',
    jobId: id,
    state: 'GENERATING',
  })
})
it('rejects missing retry identity and bounds approval bodies before service mutation', async () => {
  expect((await POST(request(undefined, null), context())).status).toBe(400)
  expect(mocks.approve).not.toHaveBeenCalled()
  expect((await POST(request({ large: 'x'.repeat(3000) }), context())).status).toBe(503)
  expect(mocks.approve).not.toHaveBeenCalled()
})
it('does not initialize private storage when account authorization fails', async () => {
  mocks.actor.mockRejectedValueOnce(new Error('synthetic private auth detail'))
  const response = await GET(new Request('https://forge.example'), context())
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private auth detail')
  expect(mocks.check).not.toHaveBeenCalled()
})
it('closes a rejected reader and permits a corrected configuration to retry without leaking driver details', async () => {
  mocks.check.mockRejectedValueOnce(new Error('synthetic-password private DSN'))
  const response = await GET(new Request('https://forge.example'), context())
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('synthetic-password')
  expect(mocks.end).toHaveBeenCalledTimes(1)
  expect(globals.forgeHostedReviewReader).toBeUndefined()
  expect((await GET(new Request('https://forge.example'), context())).status).toBe(200)
})
it('rejects a configured database destination that differs from the trusted host', async () => {
  vi.stubEnv('FORGE_CONTROL_DATABASE_HOST', 'other.neon.tech')
  const response = await GET(new Request('https://forge.example'), context())
  expect(response.status).toBe(503)
  expect(mocks.check).not.toHaveBeenCalled()
})
