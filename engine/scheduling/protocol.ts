/** Metadata-only scheduling protocol. This grants transport access, never job authority. */
export const STEP_PATH = '/api/internal/worker-step'
export const TRIGGER_PATH = '/dispatch'
export const MAX_BODY_BYTES = 2048
export const MAX_STEPS = 30
export const MAX_DISPATCH_MS = 15 * 60_000
export const REQUEST_TIMEOUT_MS = 55_000
export type Purpose = 'forge-scheduler-trigger-v1' | 'forge-worker-step-v1'
export interface Dispatch {
  schemaVersion: 1
  dispatchId: string
  workspaceId: string
  jobId: string
  expiresAt: string
}
export interface StepCommand extends Dispatch {
  sequence: number
}
export interface StepResult {
  schemaVersion: 1
  state: 'continue' | 'complete' | 'awaiting-approval' | 'cancelled' | 'blocked'
  retryAfterSeconds: number
}
export class SchedulerError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'EXPIRED' | 'UNAVAILABLE') {
    super(code)
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SchedulerError('INVALID_REQUEST')
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k)))
    throw new SchedulerError('INVALID_REQUEST')
  return v
}
export function parseDispatch(value: unknown): Dispatch {
  const v = record(value, ['schemaVersion', 'dispatchId', 'workspaceId', 'jobId', 'expiresAt'])
  if (
    v.schemaVersion !== 1 ||
    ![v.dispatchId, v.workspaceId, v.jobId].every(
      (id) => typeof id === 'string' && uuid.test(id)
    ) ||
    typeof v.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    new Date(v.expiresAt).toISOString() !== v.expiresAt
  )
    throw new SchedulerError('INVALID_REQUEST')
  return {
    schemaVersion: 1,
    dispatchId: v.dispatchId as string,
    workspaceId: v.workspaceId as string,
    jobId: v.jobId as string,
    expiresAt: v.expiresAt,
  }
}
export function parseCommand(value: unknown): StepCommand {
  const v = record(value, [
    'schemaVersion',
    'dispatchId',
    'workspaceId',
    'jobId',
    'expiresAt',
    'sequence',
  ])
  const { sequence, ...dispatch } = v
  if (!Number.isInteger(sequence) || Number(sequence) < 0 || Number(sequence) >= MAX_STEPS)
    throw new SchedulerError('INVALID_REQUEST')
  return { ...parseDispatch(dispatch), sequence: Number(sequence) }
}
export function parseResult(value: unknown): StepResult {
  const v = record(value, ['schemaVersion', 'state', 'retryAfterSeconds'])
  if (
    v.schemaVersion !== 1 ||
    typeof v.state !== 'string' ||
    !['continue', 'complete', 'awaiting-approval', 'cancelled', 'blocked'].includes(v.state) ||
    !Number.isInteger(v.retryAfterSeconds) ||
    Number(v.retryAfterSeconds) < 0 ||
    Number(v.retryAfterSeconds) > 60 ||
    (v.state === 'continue' ? Number(v.retryAfterSeconds) < 5 : v.retryAfterSeconds !== 0)
  )
    throw new SchedulerError('INVALID_REQUEST')
  return v as unknown as StepResult
}
export function assertLifetime(dispatch: Dispatch, now: number) {
  const remaining = Date.parse(dispatch.expiresAt) - now
  if (!Number.isFinite(now) || remaining <= 0 || remaining > MAX_DISPATCH_MS)
    throw new SchedulerError('EXPIRED')
}
/** Only a trusted operator configures origins. No IPs, ports, paths or user destinations. */
export function exactOrigin(value: string): string {
  let u: URL
  try {
    u = new URL(value)
  } catch {
    throw new SchedulerError('UNAVAILABLE')
  }
  if (
    u.protocol !== 'https:' ||
    u.origin !== value ||
    u.username ||
    u.password ||
    u.port ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(u.hostname) ||
    /^[0-9.]+$/.test(u.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname)
  )
    throw new SchedulerError('UNAVAILABLE')
  return u.origin
}
async function key(hex: string) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new SchedulerError('UNAVAILABLE')
  const bytes = Uint8Array.from(hex.match(/../g)!, (x) => Number.parseInt(x, 16))
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}
const encoder = new TextEncoder()
const hexOf = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
async function signingInput(purpose: Purpose, url: string, stamp: string, bytes: Uint8Array) {
  const digest = hexOf(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return encoder.encode(`${purpose}\nPOST\n${url}\n${stamp}\n${digest}`)
}
export async function signedRequest(
  url: string,
  purpose: Purpose,
  payload: Dispatch | StepCommand,
  secret: string,
  now = Date.now()
): Promise<Request> {
  const body = JSON.stringify(
    purpose === 'forge-worker-step-v1' ? parseCommand(payload) : parseDispatch(payload)
  )
  const u = new URL(url)
  if (
    url !==
    exactOrigin(u.origin) + (purpose === 'forge-worker-step-v1' ? STEP_PATH : TRIGGER_PATH)
  )
    throw new SchedulerError('UNAVAILABLE')
  assertLifetime(payload, now)
  const stamp = String(Math.floor(now / 1000))
  const signature = hexOf(
    await crypto.subtle.sign(
      'HMAC',
      await key(secret),
      await signingInput(purpose, url, stamp, encoder.encode(body))
    )
  )
  return new Request(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'x-forge-time': stamp,
      'x-forge-signature': signature,
    },
    body,
  })
}
/** Bound chunked bodies too; Content-Length is never sufficient admission evidence. */
export async function readJson(response: Request | Response): Promise<unknown> {
  if (
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    response.headers.has('content-encoding')
  )
    throw new SchedulerError('INVALID_REQUEST')
  const reader = response.body?.getReader()
  if (!reader) throw new SchedulerError('INVALID_REQUEST')
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SchedulerError('INVALID_REQUEST')), 5000)
  })
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES || chunks.length >= MAX_BODY_BYTES)
        throw new SchedulerError('INVALID_REQUEST')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new SchedulerError('INVALID_REQUEST')
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
/** Verify exact URL and canonical metadata before handing it to control authority. */
export async function authenticate(
  request: Request,
  origin: string,
  purpose: Purpose,
  secret: string,
  now = Date.now()
): Promise<Dispatch | StepCommand> {
  const expected =
    exactOrigin(origin) + (purpose === 'forge-worker-step-v1' ? STEP_PATH : TRIGGER_PATH)
  const stamp = request.headers.get('x-forge-time') ?? ''
  const signature = request.headers.get('x-forge-signature') ?? ''
  if (
    request.method !== 'POST' ||
    request.url !== expected ||
    request.headers.has('origin') ||
    request.headers.has('cookie') ||
    (request.headers.has('host') && request.headers.get('host') !== new URL(expected).host) ||
    !/^\d{10}$/.test(stamp) ||
    !/^[0-9a-f]{64}$/.test(signature) ||
    !Number.isFinite(now) ||
    Math.abs(now - Number(stamp) * 1000) > 30_000
  )
    throw new SchedulerError('UNAUTHORIZED')
  // Strict JSON is canonicalized on both ends; alternate JSON bytes have no extra authority.
  const payload = await readJson(request)
  const parsed = purpose === 'forge-worker-step-v1' ? parseCommand(payload) : parseDispatch(payload)
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, (x) => Number.parseInt(x, 16))
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    signatureBytes,
    await signingInput(purpose, expected, stamp, encoder.encode(JSON.stringify(parsed)))
  )
  if (!valid) throw new SchedulerError('UNAUTHORIZED')
  assertLifetime(parsed, now)
  return parsed
}
