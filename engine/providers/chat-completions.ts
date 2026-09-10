import { z } from 'zod'
import { generationRequestSchema, modelDescriptorSchema } from '../contracts/provider.ts'
import type { CredentialStatus, GenerationEvent, GenerationRequest, ModelDescriptor, ProviderAdapter } from '../contracts/provider.ts'
import { fileBatchSchema, planSchema } from '../contracts/source.ts'
import { limits } from '../contracts/primitives.ts'

const envelope = z.object({ id: z.string().min(1).max(120).optional(),
  choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable().optional(),
    refusal: z.string().nullable().optional(), tool_calls: z.array(z.unknown()).optional(), function_call: z.unknown().optional() }) })).length(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).optional() })
type ErrorCode = Extract<GenerationEvent, { type: 'error' }>['code']
class TransportFailure extends Error {
  constructor(readonly code: ErrorCode, readonly retryable = false) { super(code) }
}
export interface ChatCompletionsOptions {
  /** Resolved operator configuration, never an HTTP request field. No default provider. */
  id: string
  endpoint: string
  approvedEndpoints: readonly string[]
  model: ModelDescriptor
  getCredential: (signal: AbortSignal) => Promise<string | null>
  /** Injected HTTP transport is for explicitly labelled transport tests only. */
  fetch?: typeof globalThis.fetch
  evidenceOrigin?: 'provider' | 'fixture'
  now?: () => number
}

/** Narrow nonstreaming chat-completions adapter. Operator must evaluate the exact
 * endpoint/model before enabling it. This class does not reserve funds or retry. */
export class ChatCompletionsAdapter implements ProviderAdapter {
  readonly id: string
  private readonly endpoint: string
  private readonly model: ModelDescriptor
  private readonly transport: typeof globalThis.fetch
  private readonly origin: 'provider' | 'fixture'
  private readonly now: () => number
  constructor(private readonly options: ChatCompletionsOptions) {
    this.id = z.string().min(1).max(120).parse(options.id)
    const url = new URL(options.endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
      || !options.approvedEndpoints.includes(url.href)) throw new Error('Unapproved provider destination')
    this.endpoint = url.href
    this.model = modelDescriptorSchema.parse(options.model)
    if (this.model.capabilities.streaming || !this.model.capabilities.structuredOutput || this.model.capabilities.toolCalls)
      throw new Error('Adapter requires nonstreaming structured-only model policy')
    if (options.fetch && options.evidenceOrigin !== 'fixture') throw new Error('Injected transport must use fixture provenance')
    this.transport = options.fetch ?? globalThis.fetch
    this.origin = options.evidenceOrigin ?? 'provider'
    this.now = options.now ?? Date.now
  }
  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    signal.throwIfAborted()
    return [structuredClone(this.model)] // configured allowlist, not remote discovery
  }
  async validateCredentials(signal: AbortSignal): Promise<CredentialStatus> {
    signal.throwIfAborted()
    // Presence is not remote verification; this operation deliberately makes no
    // paid probe. Bound even a secret-store implementation that ignores abort.
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 10_000)
    try {
      const configured = !!(await abortable(this.options.getCredential(controller.signal), controller.signal))
      signal.throwIfAborted()
      return { schemaVersion: 1, configured, verified: false, checkedAt: new Date(this.now()).toISOString() }
    } catch {
      signal.throwIfAborted()
      return { schemaVersion: 1, configured: false, verified: false, errorCode: 'UNAVAILABLE', checkedAt: new Date(this.now()).toISOString() }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      controller.abort()
    }
  }
  async *generate(input: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent> {
    let dispatched = false
    let received = false
    let usageReported = false
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const request = generationRequestSchema.parse(input)
      if (signal.aborted) throw new TransportFailure('CANCELLED')
      const remaining = Math.min(120_000, Date.parse(request.deadlineAt) - this.now())
      if (remaining <= 0) throw new TransportFailure('TIMEOUT')
      timer = setTimeout(abort, remaining)
      if (request.model !== this.model.id || request.maxOutputTokens > this.model.maxOutputTokens)
        throw new TransportFailure('INVALID_OUTPUT')
      // UTF-8 bytes conservatively bound tokens; admission must price this same bound.
      const inputBound = Buffer.byteLength(JSON.stringify(request.context), 'utf8')
      if (inputBound > this.model.maxInputTokens) throw new TransportFailure('INVALID_OUTPUT')
      const credential = await abortable(this.options.getCredential(controller.signal), controller.signal)
      if (controller.signal.aborted) throw new TransportFailure(signal.aborted ? 'CANCELLED' : 'TIMEOUT')
      if (!credential || /[\r\n]/.test(credential)) throw new TransportFailure('AUTH')
      dispatched = true
      const response = await abortable(this.transport(this.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: request.model, messages: request.context, stream: false,
          max_tokens: request.maxOutputTokens, response_format: { type: 'json_object' } }) }), controller.signal)
      received = true
      if (!response.ok) {
        await response.body?.cancel()
        const code: ErrorCode = response.status === 401 || response.status === 403 ? 'AUTH'
          : response.status === 429 ? 'RATE_LIMIT' : 'UNAVAILABLE'
        throw new TransportFailure(code, response.status === 429 || response.status === 503)
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel()
        throw new TransportFailure('INVALID_OUTPUT')
      }
      const cap = (request.stage === 'plan' ? limits.planBytes : limits.batchBytes) * 6 + 8192
      const raw = await readBounded(response, cap, controller.signal)
      const parsed = envelope.parse(JSON.parse(raw))
      if (parsed.usage) {
        yield { schemaVersion: 1, type: 'usage', usage: { inputTokens: parsed.usage.prompt_tokens,
          outputTokens: parsed.usage.completion_tokens, classification: 'measured', ...(parsed.id ? { requestId: parsed.id } : {}) } }
        usageReported = true
      }
      const choice = parsed.choices[0]
      if (choice.message.tool_calls?.length || choice.message.function_call !== undefined)
        throw new TransportFailure('UNSUPPORTED_TOOL')
      if (choice.finish_reason !== 'stop' || choice.message.refusal || !choice.message.content)
        throw new TransportFailure('INVALID_OUTPUT')
      const content = choice.message.content
      if (Buffer.byteLength(content, 'utf8') > (request.stage === 'plan' ? limits.planBytes : limits.batchBytes))
        throw new TransportFailure('INVALID_OUTPUT')
      const payload = (request.outputSchemaId === 'PlanV1' ? planSchema : fileBatchSchema).parse(JSON.parse(content))
      if (!usageReported) yield { schemaVersion: 1, type: 'usage', usage: { classification: 'uncertain' } }
      yield { schemaVersion: 1, type: 'completed', finish: 'stop', origin: this.origin, payload,
        ...(parsed.id ? { requestId: parsed.id } : {}) }
    } catch (error) {
      if (dispatched && !usageReported) yield { schemaVersion: 1, type: 'usage', usage: { classification: 'uncertain' } }
      const failure = signal.aborted ? new TransportFailure('CANCELLED') : controller.signal.aborted ? new TransportFailure('TIMEOUT')
        : error instanceof TransportFailure ? error : new TransportFailure(received ? 'INVALID_OUTPUT' : 'UNAVAILABLE')
      yield { schemaVersion: 1, type: 'error', code: failure.code, retryable: failure.retryable }
    } finally {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      controller.abort()
    }
  }
}

async function readBounded(response: Response, cap: number, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > cap)) {
    await response.body?.cancel()
    throw new TransportFailure('INVALID_OUTPUT')
  }
  if (!response.body) throw new TransportFailure('INVALID_OUTPUT')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let result = ''
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > cap) throw new TransportFailure('INVALID_OUTPUT')
      result += decoder.decode(part.value, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Bounds dependencies even when their implementation ignores AbortSignal. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); return Promise.reject(new TransportFailure('CANCELLED')) }
  let abort: () => void = () => undefined
  return new Promise<T>((resolve, reject) => {
    abort = () => reject(new TransportFailure('CANCELLED'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject)
  }).finally(() => signal.removeEventListener('abort', abort))
}
