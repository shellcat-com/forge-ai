import { describe, it, expect, vi } from 'vitest'
import { EngineClient, EngineEventDecoder } from './client.ts'
const scope = { workspaceId: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002', jobId: '00000000-0000-4000-8000-000000000003' }
const frame = (seq: number, type = 'job.state', extra = {}) => `id: ${scope.jobId}:${seq}\nevent: ${type}\ndata: ${JSON.stringify({ schemaVersion: 1, ...scope, seq, stateVersion: seq, at: '2026-09-10T00:00:00Z', type, data: {}, ...extra })}\n\n`
describe('engine browser transport (synthetic HTTP)', () => {
  it('reconstructs split frames, ignores keepalives/duplicates and stops at terminal', () => {
    const d = new EngineEventDecoder(scope), first = frame(1)
    expect(d.push(': keepalive\n\n' + first.slice(0, 15))).toEqual([])
    expect(d.push(first.slice(15)).map(e => e.seq)).toEqual([1])
    expect(d.push(first)).toEqual([]); expect(d.push(frame(2, 'job.terminal'))).toHaveLength(1)
    expect(d.finished).toBe(true); expect(d.cursor).toBe(`${scope.jobId}:2`)
  })
  it('rejects gaps, cross-project events, envelope mismatch and oversized incomplete frames', () => {
    expect(() => new EngineEventDecoder(scope).push(frame(2))).toThrow('GAP')
    expect(() => new EngineEventDecoder(scope).push(frame(1, 'job.state', { projectId: scope.workspaceId }))).toThrow('FOREIGN')
    expect(() => new EngineEventDecoder(scope).push(frame(1).replace('event: job.state', 'event: check.result'))).toThrow('FOREIGN')
    expect(() => new EngineEventDecoder(scope).push('x'.repeat(256 * 1024 + 1))).toThrow('OVERFLOW')
  })
  it('rejects truncated EOF and aborts a stalled injected stream', async () => {
    const short = new EngineClient(async () => new Response(frame(1).slice(0, -2), { headers: { 'Content-Type': 'text/event-stream' } }))
    await expect(short.events(scope, 0, () => undefined, new AbortController().signal)).rejects.toThrow('TRUNCATED')
    let cancelled = false
    const stalled = new EngineClient(async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const controller = new AbortController()
    const reading = stalled.events(scope, 0, () => undefined, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(new Error('Stopped'))
    await expect(reading).rejects.toThrow('Stopped'); expect(cancelled).toBe(true)
  })
  it('sends same-origin cookie requests, CSRF and caller-stable idempotency key without automatic retries', async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = []
    const client = new EngineClient(async (url, init) => { calls.push([url, init]); return Response.json({ ok: true }) })
    client.setCsrf('a'.repeat(43))
    await client.mutate('/projects/id/jobs', 'POST', { schemaVersion: 1 }, 'stable-user-action-key', x => x)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject(['/api/v1/projects/id/jobs', { credentials: 'same-origin', redirect: 'error', headers: { 'X-CSRF-Token': 'a'.repeat(43), 'Idempotency-Key': 'stable-user-action-key' } }])
    await expect(client.read('//evil.example', x => x)).rejects.toThrow('INVALID_ENGINE_PATH')
  })
  it('combines caller cancellation with the fixed request deadline', async () => {
    const timer = new AbortController(), caller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal)
    try {
      const client = new EngineClient(() => new Promise<Response>(() => undefined))
      const reading = client.read('/session', x => x, caller.signal)
      timer.abort(new Error('Request deadline'))
      await expect(reading).rejects.toThrow('Request deadline')
      expect(caller.signal.aborted).toBe(false)
    } finally { timeout.mockRestore() }
  })
  it('rejects mutation without in-memory CSRF and clears it on revoked session', async () => {
    const client = new EngineClient(async () => Response.json({ error: { code: 'UNAUTHENTICATED', message: 'CANARY_SECRET' } }, { status: 401 }))
    await expect(client.mutate('/projects', 'POST', {}, 'stable-user-action-key', x => x)).rejects.toThrow('SESSION_REQUIRED')
    client.setCsrf('a'.repeat(43)); await expect(client.read('/session', x => x)).rejects.toThrow('UNAUTHENTICATED')
    await expect(client.mutate('/projects', 'POST', {}, 'stable-user-action-key', x => x)).rejects.toThrow('SESSION_REQUIRED')
  })
  it('reconnects with exact cursor and never turns disconnection into cancellation', async () => {
    const calls: string[] = [], seen: number[] = []
    const client = new EngineClient(async (url, init) => {
      calls.push(String(url)); expect(init?.headers).toEqual({ 'Last-Event-ID': `${scope.jobId}:1` })
      return new Response(frame(2, 'job.terminal'), { headers: { 'Content-Type': 'text/event-stream' } })
    })
    await client.events(scope, 1, e => seen.push(e.seq), new AbortController().signal)
    expect(seen).toEqual([2]); expect(calls).toEqual([`/api/v1/jobs/${scope.jobId}/events`])
  })
})
