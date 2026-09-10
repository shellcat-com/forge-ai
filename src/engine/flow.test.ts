import { describe, expect, it, vi } from 'vitest'
import { EngineClient } from './client.ts'
import { EngineFlow } from './flow.ts'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const w = id(1), p = id(2), j = id(3), digest = 'a'.repeat(64), at = '2026-09-10T00:00:00Z'
const session = { schemaVersion: 1, origin: 'fixture', userId: id(4), csrfToken: 'a'.repeat(43), memberships: [{ workspace_id: w, role: 'editor' }] }
const capabilities = { schemaVersion: 1, origin: 'fixture', control: true, generation: false, execution: false, preview: false, fixtureWorkflows: true,
  modelPolicies: ['fixture-v1'], templates: ['next-postgres-v1'], externalGates: ['D1', 'D3', 'D4', 'D5', 'D7'] }
const project = { id: p, workspaceId: w, name: 'Synthetic project', brief: 'Synthetic project brief only', presetId: 'fixture', presetVersion: 1,
  templateId: 'next-postgres-v1', revision: 1, headSnapshotId: null, origin: 'fixture' }
const baseJob = { schemaVersion: 1, origin: 'fixture', id: j, workspaceId: w, projectId: p, state: 'QUEUED', stateVersion: 1, baseRevision: 1,
  baseSnapshotId: null, reviewDigest: null, review: null, candidateSnapshotId: null, cleanupPending: false, finishedAt: null }
const review = { schemaVersion: 1, workspaceId: w, projectId: p, jobId: j, baseRevision: 1, baseSnapshotId: null, templateDigest: digest, policyDigest: digest,
  expiresAt: '2099-01-01T00:00:00Z', planDigest: digest }
const envelope = (key: string, value: unknown) => ({ schemaVersion: 1, origin: 'fixture', [key]: value })
const history = [{ id: id(9), parent_id: null, manifest_digest: digest, status: 'verified', origin: 'fixture', created_at: at }]
const frame = (seq: number, type = 'job.state') => `id: ${j}:${seq}\nevent: ${type}\ndata: ${JSON.stringify({ schemaVersion: 1, workspaceId: w, projectId: p, jobId: j, seq, stateVersion: seq, at, type, data: {} })}\n\n`
function setup(override?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const calls: { path: string; init?: RequestInit }[] = []
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url); calls.push({ path, init })
    const response = override?.(path, init); if (response) return response
    if (path === '/api/v1/session') return Response.json(session)
    if (path === '/api/v1/capabilities') return Response.json(capabilities)
    if (path === `/api/v1/workspaces/${w}/projects`) return Response.json({ ...envelope('items', [project]), nextCursor: null })
    if (path === `/api/v1/projects/${p}/snapshots`) return Response.json(envelope('items', history))
    if (path === `/api/v1/projects/${p}` && init?.method === 'GET') return Response.json(envelope('project', project))
    if (path === `/api/v1/jobs/${j}`) return Response.json(envelope('job', baseJob))
    throw new Error('Unexpected synthetic route: ' + path)
  })
  return { flow: new EngineFlow(new EngineClient(transport)), transport, calls }
}
async function ready(flow: EngineFlow) { await flow.loadSession(); await flow.loadCapabilities(); await flow.loadProject(p) }

describe('headless E4 flow against explicit E1 HTTP fixtures', () => {
  it('loads exact session/capabilities/projects and keeps credentials out of public state', async () => {
    const { flow } = setup(); await ready(flow); await flow.loadProjects(w)
    expect(flow.state.session?.memberships[0]).toEqual({ workspace_id: w, role: 'editor' })
    expect(JSON.stringify(flow.state)).not.toContain(session.csrfToken)
    expect(flow.state.capabilities?.generation).toBe(false)
    expect(flow.state.unavailable).toEqual({ preview: 'ENDPOINT_UNAVAILABLE', sourceExport: 'ENDPOINT_UNAVAILABLE' })
  })
  it('coalesces double clicks and returns completed intent without a duplicate mutation', async () => {
    let release!: (r: Response) => void
    const { flow, calls } = setup((path, init) => path.endsWith('/jobs') && init?.method === 'POST' ? new Promise(resolve => { release = resolve }) : undefined)
    await ready(flow)
    const a = flow.generate(id(20), 'Build a synthetic task board only'), b = flow.generate(id(20), 'Build a synthetic task board only')
    expect(a).toBe(b)
    release(Response.json({ ...envelope('job', baseJob), eventsUrl: `/api/v1/jobs/${j}/events` }))
    await a; await flow.generate(id(20), 'Build a synthetic task board only')
    expect(calls.filter(c => c.init?.method === 'POST')).toHaveLength(1)
    await expect(flow.generate(id(20), 'Different synthetic instruction')).rejects.toThrow('ACTION_ID_REUSED')
  })
  it('retains exact body, revision and key after an ambiguous failure even after project reload', async () => {
    let mutations = 0, revision = 1
    const { flow, calls } = setup((path, init) => {
      if (path === `/api/v1/projects/${p}` && init?.method === 'GET') return Response.json(envelope('project', { ...project, revision }))
      if (path.endsWith('/jobs') && init?.method === 'POST') { if (++mutations === 1) return Promise.reject(new TypeError('lost response')); return Response.json(envelope('job', baseJob)) }
      return undefined
    })
    await ready(flow)
    await expect(flow.generate(id(21), 'Build a synthetic task board only')).rejects.toThrow('lost response')
    expect(flow.state.pendingActions[0].status).toBe('ambiguous')
    revision = 2; await flow.loadProject(p)
    await flow.generate(id(21), 'Build a synthetic task board only')
    const attempts = calls.filter(c => c.init?.method === 'POST')
    expect(attempts).toHaveLength(2); expect(attempts[0].init?.body).toBe(attempts[1].init?.body)
    expect(attempts[0].init?.headers).toEqual(attempts[1].init?.headers)
    expect(JSON.parse(String(attempts[1].init?.body)).baseRevision).toBe(1)
  })
  it('sends exact optimistic revision and does not automatically retry a stale revision', async () => {
    const { flow, calls } = setup((_path, init) => init?.method === 'PATCH' ? Response.json({ error: { code: 'REVISION_MISMATCH' } }, { status: 412 }) : undefined)
    await ready(flow)
    await expect(flow.patchProject(id(22), { name: 'Changed' })).rejects.toThrow('REVISION_MISMATCH')
    await expect(flow.patchProject(id(22), { name: 'Changed' })).rejects.toThrow('REVISION_MISMATCH')
    expect(calls.filter(c => c.init?.method === 'PATCH')).toHaveLength(1)
    expect(calls.find(c => c.init?.method === 'PATCH')?.init?.headers).toMatchObject({ 'If-Match': '"1"' })
  })
  it('binds approval to the exact displayed digest/version and rejects stale review tokens', async () => {
    let stateVersion = 3
    const { flow, calls } = setup((path, init) => {
      if (path === `/api/v1/jobs/${j}`) return Response.json(envelope('job', { ...baseJob, state: 'AWAITING_PLAN_APPROVAL', stateVersion, reviewDigest: digest, review }))
      if (path.endsWith('/approvals') && init?.method === 'POST') return Response.json(envelope('job', { ...baseJob, state: 'GENERATING', stateVersion: 5 }))
      return undefined
    })
    await ready(flow); await flow.loadJob(j); const old = flow.reviewToken()
    stateVersion = 4; await flow.loadJob(j)
    expect(() => flow.approve(id(23), old, 'approve')).toThrow('STALE_FLOW_REVIEW')
    const current = flow.reviewToken(); await flow.approve(id(24), current, 'approve')
    expect(JSON.parse(String(calls.find(c => c.path.endsWith('/approvals'))?.init?.body))).toEqual({ schemaVersion: 1, kind: 'plan', subjectDigest: digest, stateVersion: 4, decision: 'approve' })
  })
  it('clears all scoped state and pending actions after a revoked session', async () => {
    const { flow } = setup((_path, init) => init?.method === 'POST' ? Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }) : undefined)
    await ready(flow)
    await expect(flow.generate(id(25), 'Build a synthetic task board only')).rejects.toThrow('UNAUTHENTICATED')
    expect(flow.state.session).toBeNull(); expect(flow.state.project).toBeNull(); expect(flow.state.pendingActions).toEqual([])
  })
  it('reloads authoritative state after disconnect and resumes only from delivered cursor without cancelling job', async () => {
    let connects = 0
    const { flow, calls } = setup((path, init) => {
      if (path.endsWith('/events')) {
        connects++; expect(init?.headers).toEqual(connects === 1 ? {} : { 'Last-Event-ID': `${j}:1` })
        return new Response(connects === 1 ? frame(1) : frame(2), { headers: { 'content-type': 'text/event-stream' } })
      }
      return undefined
    })
    await ready(flow); await flow.loadJob(j)
    await flow.watch(new AbortController().signal); expect(flow.state.stream).toBe('disconnected'); expect(flow.state.lastEventSeq).toBe(1)
    await flow.watch(new AbortController().signal); expect(flow.state.lastEventSeq).toBe(2)
    expect(calls.some(c => c.path.endsWith('/cancel'))).toBe(false)
  })
  it('refreshes review state while an event stream remains connected', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>, changed = false
    const { flow } = setup(path => {
      if (path.endsWith('/events')) return new Response(new ReadableStream({ start(c) { stream = c } }), { headers: { 'content-type': 'text/event-stream' } })
      if (path === `/api/v1/jobs/${j}` && changed) return Response.json(envelope('job', { ...baseJob, state: 'AWAITING_PLAN_APPROVAL', stateVersion: 3, reviewDigest: digest, review }))
      return undefined
    })
    await ready(flow); await flow.loadJob(j); const abort = new AbortController(); const watch = flow.watch(abort.signal)
    await vi.waitFor(() => expect(stream).toBeDefined()); changed = true
    stream.enqueue(new TextEncoder().encode(frame(1, 'plan.ready')))
    await vi.waitFor(() => expect(flow.state.job?.state).toBe('AWAITING_PLAN_APPROVAL'))
    expect(flow.reviewToken().kind).toBe('plan'); abort.abort(); await watch
  })
  it('refreshes project head and history after a terminal event', async () => {
    let ended = false
    const { flow } = setup(path => {
      if (path.endsWith('/events')) { ended = true; return new Response(frame(1, 'job.terminal'), { headers: { 'content-type': 'text/event-stream' } }) }
      if (ended && path === `/api/v1/jobs/${j}`) return Response.json(envelope('job', { ...baseJob, state: 'SUCCEEDED', stateVersion: 12, candidateSnapshotId: id(9), finishedAt: at }))
      if (ended && path === `/api/v1/projects/${p}`) return Response.json(envelope('project', { ...project, revision: 2, headSnapshotId: id(9) }))
      return undefined
    })
    await ready(flow); await flow.loadJob(j); await flow.watch(new AbortController().signal)
    expect(flow.state.project?.headSnapshotId).toBe(id(9)); expect(flow.state.history).toHaveLength(1); expect(flow.state.stream).toBe('terminal')
  })
  it('refreshes on expired replay cursor without inventing a checkpoint or retrying forever', async () => {
    const { flow, calls } = setup(path => path.endsWith('/events') ? Response.json({ error: { code: 'EVENT_CURSOR_EXPIRED' } }, { status: 410 }) : undefined)
    await ready(flow); await flow.loadJob(j)
    await expect(flow.watch(new AbortController().signal)).rejects.toThrow('EVENT_CURSOR_EXPIRED')
    expect(flow.state.stream).toBe('replay-required')
    await expect(flow.watch(new AbortController().signal)).rejects.toThrow('EVENT_REPLAY_REQUIRED')
    expect(calls.filter(c => c.path.endsWith('/events'))).toHaveLength(1)
  })
  it('requires explicit data-reset acknowledgement and uses the existing restoration endpoint', async () => {
    const { flow, calls } = setup((path, init) => path.endsWith('/restorations') && init?.method === 'POST' ? Response.json(envelope('job', baseJob)) : undefined)
    await ready(flow); await flow.loadHistory()
    expect(() => flow.restore(id(28), id(9), false as true)).toThrow()
    await flow.restore(id(28), id(9), true)
    expect(JSON.parse(String(calls.find(c => c.path.endsWith('/restorations'))?.init?.body))).toEqual({ schemaVersion: 1, snapshotId: id(9), expectedProjectRevision: 1, resetPreviewDataAcknowledged: true, maxCostMicros: 0 })
  })
  it('sends promotion binding and refreshes committed source history', async () => {
    let promoted = false
    const { flow, calls } = setup((path, init) => {
      if (path === `/api/v1/jobs/${j}`) return Response.json(envelope('job', { ...baseJob, state: 'AWAITING_PROMOTION', stateVersion: 10, reviewDigest: digest, candidateSnapshotId: id(9),
        review: { ...review, candidateDigest: digest, verificationDigest: digest } }))
      if (path.endsWith('/promote') && init?.method === 'POST') { promoted = true; return Response.json(envelope('job', { ...baseJob, state: 'SUCCEEDED', stateVersion: 11, finishedAt: at })) }
      if (promoted && path === `/api/v1/projects/${p}`) return Response.json(envelope('project', { ...project, revision: 2, headSnapshotId: id(9) }))
      return undefined
    })
    await ready(flow); await flow.loadJob(j); await flow.promote(id(29), flow.reviewToken())
    expect(JSON.parse(String(calls.find(c => c.path.endsWith('/promote'))?.init?.body))).toEqual({ schemaVersion: 1, snapshotId: id(9), verificationDigest: digest, stateVersion: 10, expectedProjectRevision: 1 })
    expect(flow.state.history).toHaveLength(1); expect(flow.state.project?.revision).toBe(2)
  })
  it('uses explicit cancellation only and preserves cleanup-pending state', async () => {
    const { flow, calls } = setup((path, init) => path.endsWith('/cancel') && init?.method === 'POST'
      ? Response.json(envelope('job', { ...baseJob, state: 'CANCELLING', stateVersion: 2, cleanupPending: true })) : undefined)
    await ready(flow); await flow.loadJob(j); await flow.cancel(id(31))
    expect(flow.state.job?.cleanupPending).toBe(true)
    expect(JSON.parse(String(calls.find(c => c.path.endsWith('/cancel'))?.init?.body))).toEqual({ schemaVersion: 1 })
  })
  it('reauthorizes after stream EOF and clears state when membership/session was revoked', async () => {
    let ended = false
    const { flow } = setup(path => {
      if (path.endsWith('/events')) { ended = true; return new Response('', { headers: { 'content-type': 'text/event-stream' } }) }
      if (ended && path === `/api/v1/jobs/${j}`) return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })
      return undefined
    })
    await ready(flow); await flow.loadJob(j)
    await expect(flow.watch(new AbortController().signal)).rejects.toThrow('UNAUTHENTICATED')
    expect(flow.state.session).toBeNull(); expect(flow.state.job).toBeNull()
  })
  it('rejects a foreign mutation result without caching it as completed', async () => {
    const { flow } = setup((path, init) => path.endsWith('/jobs') && init?.method === 'POST'
      ? Response.json(envelope('job', { ...baseJob, projectId: id(99) })) : undefined)
    await ready(flow)
    await expect(flow.generate(id(32), 'Build a synthetic task board only')).rejects.toThrow('FOREIGN_FLOW_RESULT')
    expect(flow.state.pendingActions[0].status).toBe('ambiguous'); expect(flow.state.job).toBeNull()
  })

  it('prevents delayed workspace/page and history reads from overwriting newer choices', async () => {
    const workspace = id(40)
    const pages = new Map<string, (r: Response) => void>()
    const histories: ((r: Response) => void)[] = []
    const { flow } = setup(path => {
      if (path === '/api/v1/session') return Response.json({ ...session, memberships: [...session.memberships, { workspace_id: workspace, role: 'editor' }] })
      if (path.includes('/workspaces/')) return new Promise(resolve => { pages.set(path, resolve) })
      if (path.endsWith('/snapshots')) return new Promise(resolve => { histories.push(resolve) })
      return undefined
    })
    await flow.loadSession()
    const oldPage = flow.loadProjects(w), rejectedPage = expect(oldPage).rejects.toThrow('STALE_FLOW_READ')
    const newPage = flow.loadProjects(workspace)
    pages.get(`/api/v1/workspaces/${workspace}/projects`)!(Response.json({ ...envelope('items', []), nextCursor: null }))
    await newPage
    pages.get(`/api/v1/workspaces/${w}/projects`)!(Response.json({ ...envelope('items', [project]), nextCursor: null }))
    await rejectedPage; expect(flow.state.workspaceId).toBe(workspace)
    await flow.loadProject(p)
    const oldHistory = flow.loadHistory(), rejectedHistory = expect(oldHistory).rejects.toThrow('STALE_FLOW_READ')
    const newHistory = flow.loadHistory()
    histories[1](Response.json(envelope('items', [{ ...history[0], id: id(41) }])))
    await newHistory
    histories[0](Response.json(envelope('items', history)))
    await rejectedHistory; expect(flow.state.history[0].id).toBe(id(41))
  })

})
