// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineApiError, EngineClient } from './client.ts'
import { EngineWorkspace } from './workspace.ts'
import type { SourceReader } from './workspace.ts'
import { engineView } from './view.ts'

// Every HTTP response, source read and event stream below is an explicit fixture.
// These tests execute no generated code and provide no live auth/provider/runner evidence.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const w = id(1), p = id(2), j = id(3), snapshot = id(9), digest = 'a'.repeat(64)
const attack = '</textarea><img src=x onerror="alert(1)"><script>alert(2)</script>'
const session = { schemaVersion: 1, origin: 'fixture', userId: id(4), csrfToken: 'a'.repeat(43), memberships: [{ workspace_id: w, role: 'editor' }] }
const capabilities = { schemaVersion: 1, origin: 'fixture', control: true, generation: false, execution: false, preview: false, fixtureWorkflows: true,
  modelPolicies: ['fixture-v1'], templates: ['next-postgres-v1'], externalGates: ['D1', 'D3', 'D4', 'D5', 'D7'] }
const project = { id: p, workspaceId: w, name: 'Synthetic project', brief: 'Synthetic project brief only', presetId: 'fixture', presetVersion: 1,
  templateId: 'next-postgres-v1', revision: 1, headSnapshotId: null, origin: 'fixture' }
const baseJob = { schemaVersion: 1, origin: 'fixture', id: j, workspaceId: w, projectId: p, state: 'QUEUED', stateVersion: 1, baseRevision: 1,
  baseSnapshotId: null, reviewDigest: null, review: null, candidateSnapshotId: null, cleanupPending: false, finishedAt: null }
const review = { schemaVersion: 1, workspaceId: w, projectId: p, jobId: j, baseRevision: 1, baseSnapshotId: null, templateDigest: digest, policyDigest: digest,
  expiresAt: '2099-01-01T00:00:00Z', planDigest: digest }
const reviewing = { ...baseJob, state: 'AWAITING_PLAN_APPROVAL', stateVersion: 3, reviewDigest: digest, review, candidateSnapshotId: snapshot }
const envelope = (key: string, value: unknown) => ({ schemaVersion: 1, origin: 'fixture', [key]: value })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const workspaces: EngineWorkspace[] = []
afterEach(() => { workspaces.forEach(workspace => workspace.leave()); workspaces.length = 0; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks() })
function sources(overrides: Partial<SourceReader> = {}): SourceReader {
  return { review: vi.fn(async job => ({ reviewDigest: job.reviewDigest!, stateVersion: job.stateVersion, text: 'Synthetic review text' })),
    files: vi.fn(async () => [{ path: 'src/page.tsx', sha256: digest, bytes: 12 }]), file: vi.fn(async () => 'Synthetic source text'),
    export: vi.fn(async () => ({ bytes: new Uint8Array([1]), filename: 'fixture.zip' })), ...overrides }
}
function setup(source?: SourceReader, override?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const calls: { path: string; init?: RequestInit }[] = []
  const cancelled = vi.fn()
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url); calls.push({ path, init })
    const response = override?.(path, init); if (response) return response
    if (path === '/api/v1/session') return Response.json(session)
    if (path === '/api/v1/capabilities') return Response.json(capabilities)
    if (path === `/api/v1/workspaces/${w}/projects`) return Response.json({ ...envelope('items', [project]), nextCursor: null })
    if (path.startsWith(`/api/v1/projects/${p}/snapshots?`)) return Response.json({ ...envelope('items', []), nextCursor: null })
    if (path === `/api/v1/projects/${p}`) return Response.json(envelope('project', project))
    if (path === `/api/v1/jobs/${j}`) return Response.json(envelope('job', reviewing))
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } })
    throw new Error('Unexpected synthetic route: ' + path)
  })
  const changed = vi.fn(), navigate = vi.fn(), workspace = new EngineWorkspace(changed, navigate, source, new EngineClient(transport))
  workspaces.push(workspace)
  const mount = () => { document.body.innerHTML = workspace.render(); return document.body }
  const ready = async (parts = [p, j]) => {
    workspace.enter(parts)
    await vi.waitFor(() => expect(mount().querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false'))
  }
  return { workspace, calls, navigate, changed, cancelled, ready, mount }
}
const action = (name: string) => document.querySelector<HTMLButtonElement>(`[data-engine-action="${name}"]`)!
const data = (values: Record<string, string>) => { const form = new FormData(); Object.entries(values).forEach(([key, value]) => form.set(key, value)); return form }

describe('engine workspace with explicit control/source fixtures', () => {
  it('requires the server session even if local storage claims a signed-in identity', async () => {
    const getItem = vi.fn(() => JSON.stringify({ authenticated: true, user: { id: id(4) } }))
    vi.stubGlobal('localStorage', { getItem })
    const h = setup(undefined, path => path.endsWith('/session') ? Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }) : undefined)
    await h.ready([])
    expect(h.mount().textContent).toContain('A control session is required')
    expect(h.workspace.flow.state.session).toBeNull()
    expect(document.querySelector('[data-engine-form="create"]')).toBeNull()
    expect(h.calls).toHaveLength(1); expect(getItem.mock.calls.flat()).toEqual(expect.arrayContaining(['forge.theme'])); expect(getItem).not.toHaveBeenCalledWith('forge-auth')
  })
  it('keeps approval, export and private preview disabled without the source API', async () => {
    const h = setup(); await h.ready()
    expect(action('approve').disabled).toBe(true); expect(action('export').disabled).toBe(true)
    expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Private preview unavailable')?.disabled).toBe(true)
    await h.workspace.action('approve')
    expect(h.calls.some(c => c.init?.method === 'POST')).toBe(false)
    expect(h.mount().textContent).toContain('Synthetic control workflow')
  })
  it.each(['digest', 'stateVersion'] as const)('rejects a mismatched source review %s before enabling approval', async field => {
    const h = setup(sources({ review: async () => ({ reviewDigest: field === 'digest' ? 'b'.repeat(64) : digest, stateVersion: field === 'stateVersion' ? 4 : 3, text: attack }) }))
    await h.ready(); expect(action('approve').disabled).toBe(true)
    expect(h.mount().textContent).toContain('Approval remains disabled')
    await h.workspace.action('approve'); expect(h.calls.some(c => c.init?.method === 'POST')).toBe(false)
  })
  it('enables exact loaded review and sends its digest/state binding', async () => {
    const pending = deferred<{ reviewDigest: string; stateVersion: number; text: string }>()
    const h = setup(sources({ review: () => pending.promise }), (path, init) => path.endsWith('/approvals') && init?.method === 'POST'
      ? Response.json(envelope('job', { ...baseJob, state: 'FAILED', stateVersion: 4, finishedAt: '2026-09-10T00:00:00Z' })) : undefined)
    h.workspace.enter([p, j]); await vi.waitFor(() => { h.mount(); expect(action('approve')?.disabled).toBe(true) })
    pending.resolve({ reviewDigest: digest, stateVersion: 3, text: 'Exact synthetic review' })
    await vi.waitFor(() => { h.mount(); expect(action('approve').disabled).toBe(false) })
    await h.workspace.action('approve')
    const posted = h.calls.find(c => c.path.endsWith('/approvals'))!
    expect(JSON.parse(String(posted.init?.body))).toEqual({ schemaVersion: 1, kind: 'plan', subjectDigest: digest, stateVersion: 3, decision: 'approve' })
  })
  it('escapes project, prompt, review, filenames, source and errors as text', async () => {
    const h = setup(sources({ review: async () => ({ reviewDigest: digest, stateVersion: 3, text: attack }),
      files: async () => [{ path: attack, sha256: digest, bytes: 12 }], file: async () => attack }), path => path === `/api/v1/projects/${p}`
        ? Response.json(envelope('project', { ...project, name: attack, brief: attack })) : undefined)
    await h.ready(); await h.workspace.action('file', attack); h.mount()
    expect(action('file').dataset.id).toBe(attack)
    expect(document.querySelector('[aria-label="Source file content"]')?.textContent).toBe(attack)
    expect(document.querySelector('[aria-label="Plan review"]')?.textContent).toBe(attack)
    document.body.innerHTML = engineView({ flow: h.workspace.flow.state, busy: false, error: attack, reviewText: attack, reviewReady: true,
      files: [], selectedFile: null, fileText: null, exportAvailable: false, drafts: { name: attack, brief: attack, instruction: attack } })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(attack)
    expect(document.querySelector('script, img[onerror], [onerror]')).toBeNull()
  })
  it('retains an ambiguous generation prompt and retries the exact UUID/body without double mutation', async () => {
    const first = deferred<Response>(); let attempts = 0
    const h = setup(undefined, (path, init) => path.endsWith('/jobs') && init?.method === 'POST'
      ? ++attempts === 1 ? first.promise : Response.json(envelope('job', baseJob)) : undefined)
    await h.ready([p]); const prompt = 'Synthetic source request ' + attack
    const submit = h.workspace.submit('generate', data({ instruction: prompt }))
    await h.workspace.submit('generate', data({ instruction: 'Ignored simultaneous request' }))
    first.reject(new Error(attack)); await submit; h.mount()
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="instruction"]')?.value).toBe(prompt)
    expect(action('retry').disabled).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('[data-engine-form="generate"] button')?.disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(attack)
    await h.workspace.action('retry')
    const posts = h.calls.filter(c => c.init?.method === 'POST')
    expect(posts).toHaveLength(2); expect(posts[1].init?.body).toBe(posts[0].init?.body); expect(posts[1].init?.headers).toEqual(posts[0].init?.headers)
    expect(h.navigate).toHaveBeenCalledWith(`#/engine/${p}/${j}`)
  })
  it('does not navigate back after a generation response arrives after route leave', async () => {
    const pending = deferred<Response>()
    const h = setup(undefined, (path, init) => path.endsWith('/jobs') && init?.method === 'POST' ? pending.promise : undefined)
    await h.ready([p])
    const submit = h.workspace.submit('generate', data({ instruction: 'Synthetic delayed generation request only' }))
    h.workspace.leave(); pending.resolve(Response.json(envelope('job', baseJob))); await submit
    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.calls.some(c => c.path.endsWith('/cancel'))).toBe(false)
  })
  it('retains escaped project name and brief after an ambiguous create response', async () => {
    const h = setup(undefined, (path, init) => path.endsWith('/projects') && init?.method === 'POST' ? Promise.reject(new Error(attack)) : undefined)
    await h.ready([])
    await h.workspace.submit('create', data({ name: attack, brief: 'Synthetic brief ' + attack })); h.mount()
    expect(document.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(attack)
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="brief"]')?.value).toBe('Synthetic brief ' + attack)
    expect(document.querySelector('script, img[onerror]')).toBeNull()
    expect(action('retry').disabled).toBe(false)
    await h.workspace.submit('create', data({ name: 'Blocked new action', brief: 'Another synthetic brief' }))
    expect(h.calls.filter(c => c.init?.method === 'POST')).toHaveLength(1)
  })
  it('keeps viewer approval disabled and rejects a direct action without a mutation', async () => {
    const h = setup(sources(), path => path.endsWith('/session') ? Response.json({ ...session, memberships: [{ workspace_id: w, role: 'viewer' }] }) : undefined)
    await h.ready(); expect(action('approve').disabled).toBe(true)
    await h.workspace.action('approve')
    expect(h.calls.some(c => c.init?.method === 'POST')).toBe(false)
  })
  it('passes an abortable reader signal to source review and aborts it on route leave', async () => {
    const pending = deferred<{ reviewDigest: string; stateVersion: number; text: string }>()
    let signal: AbortSignal | undefined
    const h = setup(sources({ review: (_job, supplied) => { signal = supplied; return pending.promise } }))
    h.workspace.enter([p, j]); await vi.waitFor(() => expect(signal).toBeDefined())
    h.workspace.leave(); expect(signal?.aborted).toBe(true)
    pending.resolve({ reviewDigest: digest, stateVersion: 3, text: 'Obsolete review' })
    expect(h.calls.some(c => c.path.endsWith('/cancel'))).toBe(false)
  })
  it('retries an ambiguous source export with its exact UUID and snapshot without double submission', async () => {
    const pending = deferred<{ bytes: Uint8Array; filename: string }>()
    const exportFile = vi.fn<SourceReader['export']>().mockImplementationOnce(() => pending.promise).mockRejectedValueOnce(new Error('Second lost synthetic response'))
    const h = setup(sources({ export: exportFile }), path => path === `/api/v1/projects/${p}` ? Response.json(envelope('project', { ...project, headSnapshotId: snapshot })) : undefined)
    await h.ready([p]); expect(action('export').disabled).toBe(false)
    const first = h.workspace.action('export'); await h.workspace.action('export')
    expect(exportFile).toHaveBeenCalledTimes(1)
    pending.reject(new Error('Lost synthetic export response')); await first; h.mount()
    expect(action('retry').disabled).toBe(false); expect(action('export').disabled).toBe(true)
    await h.workspace.action('retry'); expect(exportFile).toHaveBeenCalledTimes(2)
    expect(exportFile.mock.calls[0]).toEqual(exportFile.mock.calls[1])
    expect(exportFile.mock.calls[0][0]).toBe(snapshot)
    expect(exportFile.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/)
    h.mount(); expect(action('retry').disabled).toBe(false)
  })
  it('downloads once with the original export UUID after an ambiguous response and refresh', async () => {
    const exportFile = vi.fn<SourceReader['export']>().mockRejectedValueOnce(new Error('Lost export response'))
      .mockResolvedValueOnce({ bytes: new Uint8Array([80, 75, 3, 4]), filename: 'fixture-source.zip' })
    const createObjectURL = vi.fn(() => 'blob:synthetic-fixture'), revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const h = setup(sources({ export: exportFile }), path => path === `/api/v1/projects/${p}` ? Response.json(envelope('project', { ...project, headSnapshotId: snapshot })) : undefined)
    await h.ready([p]); await h.workspace.action('export')
    await h.workspace.action('refresh'); h.mount(); expect(action('retry').disabled).toBe(false)
    await h.workspace.action('retry')
    expect(exportFile.mock.calls).toHaveLength(2); expect(exportFile.mock.calls[0]).toEqual(exportFile.mock.calls[1])
    expect(createObjectURL).toHaveBeenCalledTimes(1); expect(download).toHaveBeenCalledTimes(1)
    h.mount(); expect(document.querySelector('[data-engine-action="retry"]')).toBeNull()
  })
  it.each(['generate', 'create'] as const)('retries ambiguous %s after refresh with original scope, body and UUID', async kind => {
    let attempts = 0
    const h = setup(undefined, (path, init) => {
      if (init?.method !== 'POST' || !(path.endsWith('/jobs') || path.endsWith('/projects'))) return
      if (++attempts === 1) return Promise.reject(new Error('Lost mutation response'))
      return Response.json(kind === 'generate' ? envelope('job', baseJob) : envelope('project', project))
    })
    await h.ready(kind === 'generate' ? [p] : [])
    await h.workspace.submit(kind, data(kind === 'generate' ? { instruction: 'Synthetic source request retained across refresh' } : { name: 'Synthetic new project', brief: 'Synthetic brief retained across refresh' }))
    await h.workspace.action('refresh'); await h.workspace.action('retry')
    const posts = h.calls.filter(call => call.init?.method === 'POST')
    expect(posts).toHaveLength(2); expect(posts[0].path).toBe(posts[1].path)
    expect(posts[0].init?.body).toBe(posts[1].init?.body); expect(posts[0].init?.headers).toEqual(posts[1].init?.headers)
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(kind === 'generate' ? `#/engine/${p}/${j}` : `#/engine/${p}`)
  })
  it('clears scoped state, displayed source and approval after a source API 401', async () => {
    const read = vi.fn<SourceReader['file']>().mockResolvedValueOnce('SCOPED_SYNTHETIC_SOURCE')
      .mockRejectedValueOnce(new EngineApiError(401, 'UNAUTHENTICATED', false))
    const h = setup(sources({ file: read })); await h.ready()
    await h.workspace.action('file', 'src/page.tsx'); expect(h.mount().textContent).toContain('SCOPED_SYNTHETIC_SOURCE')
    await h.workspace.action('file', 'src/page.tsx'); h.mount()
    expect(h.workspace.flow.state).toMatchObject({ session: null, project: null, job: null, history: [], pendingActions: [] })
    expect(document.body.textContent).not.toContain('SCOPED_SYNTHETIC_SOURCE')
    expect(document.querySelector('[data-engine-action="approve"]')).toBeNull()
    expect(document.body.textContent).toContain('A control session is required')
  })
  it('returns an ambiguous retry to its original route before sending the same action', async () => {
    const other = id(70); let posts = 0
    const h = setup(undefined, (path, init) => {
      if (path === `/api/v1/projects/${other}`) return Response.json(envelope('project', { ...project, id: other }))
      if (path.startsWith(`/api/v1/projects/${other}/snapshots?`)) return Response.json({ ...envelope('items', []), nextCursor: null })
      if (path.endsWith('/jobs') && init?.method === 'POST') return ++posts === 1 ? Promise.reject(new Error('Lost original action')) : Response.json(envelope('job', baseJob))
    })
    await h.ready([p]); await h.workspace.submit('generate', data({ instruction: 'Synthetic source request in original project' }))
    await h.ready([other]); await h.workspace.action('retry')
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(`#/engine/${p}`); expect(posts).toBe(1)
    await h.ready([p]); await h.workspace.action('retry')
    expect(posts).toBe(2); const attempts = h.calls.filter(call => call.init?.method === 'POST')
    expect(attempts[0].path).toBe(attempts[1].path); expect(attempts[0].init?.headers).toEqual(attempts[1].init?.headers)
    expect(attempts[0].init?.body).toBe(attempts[1].init?.body)
    expect(h.navigate).toHaveBeenLastCalledWith(`#/engine/${p}/${j}`)
  })
  it('retains a late ambiguous generation after route leave and retries the original UUID on return', async () => {
    const pending = deferred<Response>(); let posts = 0
    const h = setup(undefined, (path, init) => path.endsWith('/jobs') && init?.method === 'POST'
      ? ++posts === 1 ? pending.promise : Response.json(envelope('job', baseJob)) : undefined)
    await h.ready([p]); const first = h.workspace.submit('generate', data({ instruction: 'Original synthetic instruction retained after navigation' }))
    h.workspace.leave(); await h.ready([p])
    await h.workspace.submit('generate', data({ instruction: 'Concurrent mutation must not be admitted' }))
    expect(posts).toBe(1)
    h.workspace.leave(); pending.reject(new Error('Late lost response')); await first
    await h.ready([p]); h.mount(); expect(action('retry').disabled).toBe(false)
    await h.workspace.action('retry'); expect(posts).toBe(2)
    const attempts = h.calls.filter(call => call.init?.method === 'POST')
    expect(attempts[0].path).toBe(attempts[1].path); expect(attempts[0].init?.headers).toEqual(attempts[1].init?.headers)
    expect(attempts[0].init?.body).toBe(attempts[1].init?.body)
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(`#/engine/${p}/${j}`)
  })
  it('retains a late ambiguous export key after route leave and return', async () => {
    const pending = deferred<{ bytes: Uint8Array; filename: string }>()
    const exportFile = vi.fn<SourceReader['export']>().mockImplementationOnce(() => pending.promise).mockRejectedValueOnce(new Error('Second lost response'))
    const h = setup(sources({ export: exportFile }), path => path === `/api/v1/projects/${p}` ? Response.json(envelope('project', { ...project, headSnapshotId: snapshot })) : undefined)
    await h.ready([p]); const first = h.workspace.action('export')
    h.workspace.leave(); pending.reject(new Error('Late lost export response')); await first
    await h.ready([p]); h.mount(); expect(action('retry').disabled).toBe(false)
    await h.workspace.action('retry')
    expect(exportFile).toHaveBeenCalledTimes(2); expect(exportFile.mock.calls[0]).toEqual(exportFile.mock.calls[1])
    expect(exportFile.mock.calls[0][0]).toBe(snapshot)
  })
  it('does not approve a newer authoritative review while the displayed source is older', async () => {
    let stateVersion = 3
    const h = setup(sources(), (path, init) => {
      if (path === `/api/v1/jobs/${j}`) return Response.json(envelope('job', { ...reviewing, stateVersion, reviewDigest: stateVersion === 3 ? digest : 'b'.repeat(64) }))
      if (path.endsWith('/approvals') && init?.method === 'POST') return Response.json(envelope('job', baseJob))
    })
    await h.ready(); expect(action('approve').disabled).toBe(false)
    stateVersion = 4; await h.workspace.flow.loadJob(j)
    h.mount(); expect(action('approve').disabled).toBe(true)
    await h.workspace.action('approve'); expect(h.calls.some(c => c.path.endsWith('/approvals'))).toBe(false)
  })
  it('ignores an obsolete failed source read after a newer review loaded', async () => {
    const old = deferred<{ reviewDigest: string; stateVersion: number; text: string }>(); let reads = 0
    const h = setup(sources({ review: () => ++reads === 1 ? old.promise : Promise.resolve({ reviewDigest: digest, stateVersion: 3, text: 'Current review' }) }))
    h.workspace.enter([p, j]); await vi.waitFor(() => expect(reads).toBe(1))
    h.workspace.leave(); await h.ready()
    expect(action('approve').disabled).toBe(false)
    old.reject(new Error('obsolete read')); await vi.waitFor(() => expect(reads).toBe(2)); await new Promise(resolve => setTimeout(resolve, 0))
    h.mount(); expect(action('approve').disabled).toBe(false); expect(document.querySelector('[role="alert"]')).toBeNull()
  })
  it('drops stale file content after navigating to a different selection', async () => {
    const old = deferred<string>(); const h = setup(sources({ file: () => old.promise })); await h.ready()
    const file = h.workspace.action('file', 'src/page.tsx')
    h.workspace.leave(); await h.ready([p]); old.resolve('OBSOLETE_PRIVATE_SOURCE'); await file
    expect(h.mount().textContent).not.toContain('OBSOLETE_PRIVATE_SOURCE')
  })
  it('aborts event readers on leaving without issuing job cancellation', async () => {
    const h = setup(sources()); await h.ready(); await vi.waitFor(() => expect(h.calls.some(c => c.path.endsWith('/events'))).toBe(true))
    const signal = h.calls.find(c => c.path.endsWith('/events'))!.init?.signal
    h.workspace.leave(); expect(signal?.aborted).toBe(true)
    await vi.waitFor(() => expect(h.cancelled).toHaveBeenCalledTimes(1))
    expect(h.calls.some(c => c.path.endsWith('/cancel'))).toBe(false)
  })
  it('aborts an in-flight initial read on leaving without cancelling any job', async () => {
    const old = deferred<Response>(); const h = setup(undefined, path => path.endsWith('/session') ? old.promise : undefined)
    h.workspace.enter([p, j]); const signal = h.calls[0].init?.signal
    h.workspace.leave(); expect(signal?.aborted).toBe(true)
    old.resolve(Response.json(session))
    expect(h.calls.some(c => c.path.endsWith('/cancel'))).toBe(false)
  })
})
