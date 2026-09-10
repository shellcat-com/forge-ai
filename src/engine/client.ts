/** Same-origin RFC 0001 transport. Session cookies remain HttpOnly; the CSRF
 * value stays in this instance's memory and never enters browser persistence. */
export class EngineApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly retryable: boolean) {
    super(code)
  }
}
export interface EventEnvelope { schemaVersion: 1; workspaceId: string; projectId: string; jobId: string;
  seq: number; stateVersion: number; at: string; type: string; data: unknown }
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const safeInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const eventTypes = new Set(['job.state', 'plan.ready', 'changes.ready', 'approval.recorded', 'step.started', 'step.finished',
  'check.result', 'usage.updated', 'preview.state', 'job.terminal'])
export function parseEventEnvelope(raw: unknown): EventEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_ENGINE_EVENT')
  const r = raw as Record<string, unknown>
  const keys = ['schemaVersion', 'workspaceId', 'projectId', 'jobId', 'seq', 'stateVersion', 'at', 'type', 'data']
  if (Object.keys(r).some(k => !keys.includes(k)) || keys.some(k => !(k in r)) || r.schemaVersion !== 1
    || !['workspaceId', 'projectId', 'jobId'].every(k => typeof r[k] === 'string' && uuidPattern.test(r[k] as string))
    || !safeInteger(r.seq) || !safeInteger(r.stateVersion) || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))
    || typeof r.type !== 'string' || !eventTypes.has(r.type) || new TextEncoder().encode(JSON.stringify(r)).length > 8192)
    throw new Error('INVALID_ENGINE_EVENT')
  // Payload stays unknown until a renderer's specific decoder accepts it.
  return r as unknown as EventEnvelope
}

/** Bounded incremental SSE decoder. No event data is interpreted as HTML. */
export class EngineEventDecoder {
  private pending = ''
  private last: number
  private terminal = false
  constructor(private readonly scope: { workspaceId: string; projectId: string; jobId: string }, lastSeq = 0) {
    if (!Number.isSafeInteger(lastSeq) || lastSeq < 0 || !Object.values(scope).every(v => uuidPattern.test(v))) throw new Error('INVALID_EVENT_SCOPE')
    this.last = lastSeq
  }
  get cursor(): string | undefined { return this.last ? `${this.scope.jobId}:${this.last}` : undefined }
  get finished(): boolean { return this.terminal }
  finish(): void { if (this.pending.trim()) throw new Error('TRUNCATED_ENGINE_STREAM') }
  push(chunk: string): EventEnvelope[] {
    this.pending += chunk
    if (new TextEncoder().encode(this.pending).length > 256 * 1024) throw new Error('ENGINE_STREAM_OVERFLOW')
    const events: EventEnvelope[] = []
    for (;;) {
      const end = /\r?\n\r?\n/.exec(this.pending)
      if (!end || end.index === undefined) break
      const frame = this.pending.slice(0, end.index)
      this.pending = this.pending.slice(end.index + end[0].length)
      const ids: string[] = [], types: string[] = [], data: string[] = []
      for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue
        const split = line.indexOf(':')
        const name = split < 0 ? line : line.slice(0, split)
        const value = split < 0 ? '' : line.slice(split + 1).replace(/^ /, '')
        if (name === 'id') ids.push(value)
        if (name === 'event') types.push(value)
        if (name === 'data') data.push(value)
      }
      if (!data.length) continue
      if (ids.length !== 1 || types.length !== 1) throw new Error('INVALID_ENGINE_FRAME')
      const event = parseEventEnvelope(JSON.parse(data.join('\n')))
      if (event.workspaceId !== this.scope.workspaceId || event.projectId !== this.scope.projectId || event.jobId !== this.scope.jobId
        || ids[0] !== `${event.jobId}:${event.seq}` || types[0] !== event.type) throw new Error('FOREIGN_ENGINE_EVENT')
      if (event.seq <= this.last) continue
      if (this.terminal || event.seq !== this.last + 1) throw new Error('ENGINE_EVENT_GAP')
      this.last = event.seq; this.terminal = event.type === 'job.terminal'; events.push(event)
    }
    return events
  }
}
const maxAttachmentBytes = 32 * 1024 * 1024
const responseLimit = (limit: number) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxAttachmentBytes) throw new Error('INVALID_ENGINE_RESPONSE_LIMIT')
  return limit
}
const validatePath = (path: string) => {
  const pathname = path.split('?')[0]
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n\0#]/.test(path)
    || pathname.includes('..') || /%2f|%5c|%2e/i.test(pathname)) throw new Error('INVALID_ENGINE_PATH')
  return `/api/v1${path}`
}
export interface EngineAttachment { bytes: Uint8Array; sha256: string; manifestDigest: string }
export class EngineClient {
  private csrf: string | null = null
  constructor(private readonly transport: typeof fetch = fetch) {}
  setCsrf(value: string | null): void {
    if (value !== null && !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('INVALID_CSRF')
    this.csrf = value
  }
  private async request(path: string, init: RequestInit, limit = 256 * 1024): Promise<unknown> {
    const response = await abortable(this.transport(validatePath(path), { ...init, credentials: 'same-origin', redirect: 'error', cache: 'no-store' }), init.signal)
    if (response.status === 401) this.csrf = null
    if (response.status === 204) return null
    const body = await boundedResponse(response, response.ok ? responseLimit(limit) : 256 * 1024, init.signal)
    let result: unknown
    try { result = JSON.parse(body) } catch { throw new EngineApiError(response.status, 'INVALID_ENGINE_RESPONSE', false) }
    if (!response.ok) {
      const error = (result as { error?: { code?: unknown; retryable?: unknown } })?.error
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'ENGINE_UNAVAILABLE'
      if (response.status === 401) this.csrf = null
      throw new EngineApiError(response.status, code, error?.retryable === true)
    }
    return result
  }
  async read<T>(path: string, decode: (input: unknown) => T, signal?: AbortSignal, options: { maxBytes?: number } = {}): Promise<T> {
    return decode(await this.request(path, { method: 'GET', signal: requestDeadline(signal) }, responseLimit(options.maxBytes ?? 256 * 1024)))
  }
  /** Keep this key with the pending user action and reuse it after an ambiguous
   * transport failure. Never auto-retry a mutation under a new key. */
  async mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, idempotencyKey: string,
    decode: (input: unknown) => T, options: { signal?: AbortSignal; revision?: number } = {}): Promise<T> {
    if (!this.csrf) throw new EngineApiError(401, 'SESSION_REQUIRED', false)
    if (!/^[!-~]{16,128}$/.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY')
    const encoded = JSON.stringify(body)
    if (new TextEncoder().encode(encoded).length > 64 * 1024) throw new Error('ENGINE_REQUEST_TOO_LARGE')
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, 'Idempotency-Key': idempotencyKey }
    if (options.revision !== undefined) {
      if (!safeInteger(options.revision)) throw new Error('INVALID_REVISION')
      headers['If-Match'] = `"${options.revision}"`
    }
    return decode(await this.request(path, { method, headers, body: encoded, signal: requestDeadline(options.signal) }))
  }
  /** Bounded source-only attachment transport. Digest values are untrusted until
   * the SourceReader compares them with its manifest and actual bytes. */
  async attachment(path: string, options: { method?: 'GET' | 'POST'; mediaType: 'text/plain' | 'application/zip';
    idempotencyKey?: string; signal?: AbortSignal; maxBytes?: number }): Promise<EngineAttachment> {
    const limit = responseLimit(options.maxBytes ?? maxAttachmentBytes), signal = requestDeadline(options.signal)
    const method = options.method ?? 'GET', headers: Record<string, string> = {}
    if (!['GET', 'POST'].includes(method) || !['text/plain', 'application/zip'].includes(options.mediaType)) throw new Error('INVALID_ENGINE_ATTACHMENT_OPTIONS')
    if (method === 'POST') {
      if (!this.csrf) throw new EngineApiError(401, 'SESSION_REQUIRED', false)
      if (!options.idempotencyKey || !/^[!-~]{16,128}$/.test(options.idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY')
      Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, 'Idempotency-Key': options.idempotencyKey })
    }
    const response = await abortable(this.transport(validatePath(path), { method, headers, ...(method === 'POST' ? { body: JSON.stringify({ schemaVersion: 1 }) } : {}),
      signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' }), signal)
    if (response.status === 401) this.csrf = null
    if (!response.ok) {
      let result: unknown
      try { result = JSON.parse(await boundedResponse(response, 256 * 1024, signal)) } catch { throw new EngineApiError(response.status, 'ENGINE_UNAVAILABLE', false) }
      const error = (result as { error?: { code?: unknown; retryable?: unknown } })?.error
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'ENGINE_UNAVAILABLE'
      throw new EngineApiError(response.status, code, error?.retryable === true)
    }
    const sha256 = response.headers.get(method === 'POST' ? 'X-Artifact-Sha256' : 'X-Source-Sha256'), manifestDigest = response.headers.get('X-Manifest-Digest')
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== options.mediaType || !sha256 || !manifestDigest
      || !/^[a-f0-9]{64}$/.test(sha256) || !/^[a-f0-9]{64}$/.test(manifestDigest)
      || method === 'POST' && !/^attachment(?:;|$)/i.test(response.headers.get('content-disposition') ?? '')) {
      void response.body?.cancel().catch(() => undefined); throw new Error('INVALID_ENGINE_ATTACHMENT')
    }
    return { bytes: await boundedBytes(response, limit, signal), sha256, manifestDigest }
  }
  /** Disconnect aborts only this reader; cancellation is a separate mutation. */
  async events(scope: { workspaceId: string; projectId: string; jobId: string }, lastSeq: number,
    onEvent: (event: EventEnvelope) => void, signal: AbortSignal): Promise<void> {
    const decoder = new EngineEventDecoder(scope, lastSeq)
    const response = await abortable(this.transport(validatePath(`/jobs/${scope.jobId}/events`), { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
      headers: decoder.cursor ? { 'Last-Event-ID': decoder.cursor } : {} }), signal)
    if (!response.ok) throw new EngineApiError(response.status, response.status === 410 ? 'EVENT_CURSOR_EXPIRED' : response.status === 401 ? 'UNAUTHENTICATED' : 'ENGINE_STREAM_UNAVAILABLE', false)
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('INVALID_ENGINE_STREAM')
    const reader = response.body.getReader(), text = new TextDecoder('utf-8', { fatal: true })
    try {
      while (!decoder.finished) {
        signal.throwIfAborted()
        const next = await abortable(reader.read(), signal)
        signal.throwIfAborted()
        if (next.done) break
        for (const event of decoder.push(text.decode(next.value, { stream: true }))) onEvent(event)
      }
      for (const event of decoder.push(text.decode())) onEvent(event)
      decoder.finish()
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
}
async function boundedBytes(response: Response, limit: number, signal?: AbortSignal | null): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => undefined); throw new Error('ENGINE_RESPONSE_TOO_LARGE')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const next = await abortable(reader.read(), signal); signal?.throwIfAborted(); if (next.done) break
      size += next.value.byteLength; if (size > limit) throw new Error('ENGINE_RESPONSE_TOO_LARGE')
      chunks.push(next.value)
    }
    const result = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
}
async function boundedResponse(response: Response, limit: number, signal?: AbortSignal | null): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader(), text = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, output = ''
  try {
    for (;;) {
      const next = await abortable(reader.read(), signal); signal?.throwIfAborted(); if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit) throw new Error('ENGINE_RESPONSE_TOO_LARGE')
      output += text.decode(next.value, { stream: true })
    }
    return output + text.decode()
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
}

function abortable<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work
  if (signal.aborted) { void work.catch(() => undefined); return Promise.reject(signal.reason) }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason) }
    signal.addEventListener('abort', aborted, { once: true })
    work.then(value => { signal.removeEventListener('abort', aborted); resolve(value) },
      error => { signal.removeEventListener('abort', aborted); reject(error) })
  })
}

function requestDeadline(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(15_000)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}
