/** Real loopback HTTP/native PostgreSQL; provider, identity and execution are explicit fixtures. */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { unzipSync } from 'fflate'
import { createControlServer } from '../../engine/control/http.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { EngineClient } from '../../src/engine/client.ts'
import { EngineFlow } from '../../src/engine/flow.ts'
import { EngineSourceReader } from '../../src/engine/source-client.ts'
import { createE2ControlHarness } from '../harness/e2-control.ts'
import type { E2Actor } from '../harness/e2-control.ts'

let harness: Awaited<ReturnType<typeof createE2ControlHarness>>
let server: ReturnType<typeof createControlServer>
let origin: string
beforeAll(async () => {
  harness = await createE2ControlHarness('http://127.0.0.1:0', { id: 'technical-mono', version: 1 })
  const options = { enabled: true, origin: 'http://127.0.0.1:0' }
  server = createControlServer(harness.service, options)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  options.origin = origin; harness.sessions.origin = origin
}, 30000)
beforeEach(async () => { await harness.reset() })
afterAll(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  await harness?.close()
})
function client(actor: E2Actor) {
  // Test-only cookie jar: the production browser sends its HttpOnly cookie.
  return new EngineClient(async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('cookie', actor.cookie); headers.set('origin', origin)
    return fetch(new URL(String(input), origin), { ...init, headers })
  })
}
async function request(actor: E2Actor, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('cookie', actor.cookie); headers.set('origin', origin)
  return fetch(origin + '/api/v1' + path, { ...init, headers })
}
it('connects browser transport to displayed reviews, source, promotion, history and export over the existing control service', async () => {
  const actor = await harness.actor()
  const transport = client(actor), flow = new EngineFlow(transport), reader = new EngineSourceReader(transport)
  await flow.loadSession(); await flow.loadCapabilities()
  await flow.loadProjects(actor.workspace)
  const project = await flow.createProject(randomUUID(), actor.workspace, { name: 'Native HTTP source fixture', brief: 'Render an explicitly synthetic source candidate.', presetId: 'technical-mono' })
  const admitted = await flow.generate(randomUUID(), project.brief, 0)
  const job = { id: admitted.id, projectId: project.id }
  expect(flow.state.capabilities).toMatchObject({ generation: false, execution: false, preview: false })
  await harness.reach(actor, job.id, 'AWAITING_PLAN_APPROVAL')
  await flow.reload(job.projectId, job.id)
  const plan = await reader.review(flow.state.job!)
  expect(plan.text).toContain('"userStories"')
  await flow.approve(randomUUID(), flow.reviewToken(), 'approve')
  await harness.reach(actor, job.id, 'AWAITING_EXECUTION_APPROVAL')
  await flow.reload(job.projectId, job.id)
  const changes = await reader.review(flow.state.job!)
  expect(changes.text).toContain('Synthetic candidate source')
  const snapshot = flow.state.job!.candidateSnapshotId!
  expect(await reader.files(snapshot)).toHaveLength(20)
  expect(await reader.file(snapshot, 'app/page.tsx')).toContain('Synthetic candidate source')
  await flow.approve(randomUUID(), flow.reviewToken(), 'approve')
  await harness.reach(actor, job.id, 'AWAITING_PROMOTION')
  await flow.reload(job.projectId, job.id)
  expect((await reader.review(flow.state.job!)).text).toContain('FIXTURE VERIFICATION')
  await flow.promote(randomUUID(), flow.reviewToken())
  await flow.reload(job.projectId, job.id)
  expect(flow.state.project?.headSnapshotId).toBe(snapshot)
  const action = randomUUID(), archive = await reader.export(snapshot, action)
  const replay = await reader.export(snapshot, action)
  expect(sha256(replay.bytes)).toBe(sha256(archive.bytes))
  expect(Object.keys(unzipSync(archive.bytes))).toHaveLength(20)
  const rows = await harness.db.admin.query('SELECT artifact_id FROM forge_control.source_exports WHERE snapshot_id=$1', [snapshot])
  expect(rows.rows).toHaveLength(1)
  const attachment = await request(actor, `/artifacts/${rows.rows[0].artifact_id}`)
  expect(attachment.status).toBe(200)
  expect(attachment.headers.get('content-disposition')).toMatch(/^attachment;/)
  expect(attachment.headers.get('cache-control')).toBe('no-store')
  expect(sha256(new Uint8Array(await attachment.arrayBuffer()))).toBe(sha256(archive.bytes))
}, 30000)
it('enforces source tenant boundaries, CSRF and exact file queries without exposing object locations', async () => {
  const actor = await harness.actor(), foreign = await harness.actor(), job = await harness.job(actor)
  await harness.reach(actor, job.id, 'SUCCEEDED')
  const snapshot = (await harness.state(actor, job.id)).candidateSnapshotId!
  for (const path of [`/jobs/${job.id}/plan`, `/jobs/${job.id}/changes`, `/snapshots/${snapshot}/files`, `/snapshots/${snapshot}/file?path=app%2Fpage.tsx`]) {
    const response = await request(foreign, path)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toMatch(/storageKey|object_key|objects\//)
  }
  expect((await request(actor, `/snapshots/${snapshot}/file?path=app%2Fpage.tsx&path=package.json`)).status).toBe(422)
  expect((await request(actor, `/snapshots/${snapshot}/file?path=..%2Fsecret`)).status).toBe(422)
  const rejected = await request(actor, `/snapshots/${snapshot}/exports`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: '{"schemaVersion":1}' })
  expect(rejected.status).toBe(403)
  const text = await request(actor, `/snapshots/${snapshot}/file?path=app%2Fpage.tsx`)
  expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(text.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(text.headers.get('x-content-type-options')).toBe('nosniff')
  const bytes = new Uint8Array(await text.arrayBuffer())
  expect(text.headers.get('x-source-sha256')).toBe(sha256(bytes))
  await harness.db.admin.query('DELETE FROM forge_control.memberships WHERE user_id=$1', [actor.id])
  expect((await request(actor, `/snapshots/${snapshot}/files`)).status).toBe(404)
}, 30000)
