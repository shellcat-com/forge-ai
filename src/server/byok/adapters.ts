import type { ConnectionInput, ModelProfile, ModelResult, Usage } from '../../shared/byok'
import { boundedJson, jsonFrames } from '../providers/transport'
import { ByokError, checkResponse, createTransport } from './transport'
import type { ModelTransport } from './transport'
import { redactCredential } from './vault'
export interface ModelRequest {
  model: string
  prompt: string
  system: string
  maxTokens: number
  structured?: boolean
  research?: boolean
  stream?: boolean
}
type ObjectValue = Record<string, unknown>
const object = (v: unknown): ObjectValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as ObjectValue) : {}
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const string = (v: unknown) => (typeof v === 'string' ? v : '')
const number = (v: unknown) => (Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : undefined)
function usageOf(input: unknown, protocol: string): Usage {
  const u = object(input)
  let inputTokens = number(
    u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? u.prompt_eval_count
  )
  if (protocol === 'messages' && inputTokens !== undefined)
    inputTokens +=
      (number(u.cache_read_input_tokens) ?? 0) + (number(u.cache_creation_input_tokens) ?? 0)
  let outputTokens = number(
    u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? u.eval_count
  )
  if (protocol === 'gemini' && outputTokens !== undefined)
    outputTokens += number(u.thoughtsTokenCount) ?? 0
  return {
    classification:
      inputTokens !== undefined && outputTokens !== undefined ? 'measured' : 'unknown',
    inputTokens,
    outputTokens,
    cachedInputTokens: number(
      object(u.input_tokens_details).cached_tokens ??
        object(u.prompt_tokens_details).cached_tokens ??
        u.cache_read_input_tokens ??
        u.cachedContentTokenCount
    ),
    cacheWriteTokens: number(u.cache_creation_input_tokens),
    reasoningTokens: number(
      object(u.output_tokens_details).reasoning_tokens ??
        object(u.completion_tokens_details).reasoning_tokens ??
        u.thoughtsTokenCount
    ),
    ...(protocol === 'responses' ? { searchCalls: 0 } : {}),
  }
}
function source(input: unknown): { url: string; title: string } | undefined {
  const value = object(input)
  const raw = string(value.url ?? value.uri)
  try {
    const url = new URL(raw)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
    return { url: url.href, title: string(value.title).slice(0, 500) || url.hostname }
  } catch {
    return
  }
}
export class ModelAdapter {
  private readonly transport: ModelTransport
  constructor(
    readonly connection: Pick<ConnectionInput, 'provider' | 'protocol' | 'baseUrl'>,
    private readonly key?: string,
    transport?: ModelTransport
  ) {
    this.transport = transport ?? createTransport(connection)
  }
  private headers(): Record<string, string> {
    if (!this.key && this.connection.protocol !== 'ollama')
      throw new ByokError('AUTH', 'This connection needs a key.')
    if (this.connection.protocol === 'messages')
      return { 'x-api-key': this.key!, 'anthropic-version': '2023-06-01' }
    if (this.connection.protocol === 'gemini') return { 'x-goog-api-key': this.key! }
    return this.key ? { Authorization: `Bearer ${this.key}` } : {}
  }
  async discover(signal: AbortSignal): Promise<ModelProfile[]> {
    const p = this.connection.protocol
    const r = await this.transport(
      p === 'ollama' ? 'tags' : 'models',
      undefined,
      this.headers(),
      signal
    )
    checkResponse(r)
    const body = object(await boundedJson(r))
    return array(p === 'gemini' || p === 'ollama' ? body.models : body.data)
      .slice(0, 1000)
      .flatMap((item) => {
        const m = object(item),
          id = string(m.id ?? m.name).replace(/^models\//, '')
        if (!id || id.length > 200) return []
        if (p === 'gemini' && !array(m.supportedGenerationMethods).includes('generateContent'))
          return []
        return [
          {
            id,
            name: string(m.displayName ?? m.name ?? m.id).slice(0, 200),
            contextWindow: Math.min(
              2_000_000,
              Math.max(
                1024,
                number(m.context_window ?? m.context_length ?? m.inputTokenLimit) ?? 32768
              )
            ),
            maxOutputTokens: Math.min(
              200_000,
              Math.max(256, number(m.outputTokenLimit ?? m.max_completion_tokens) ?? 8192)
            ),
            capabilities: {
              text: true,
              structured: true,
              research: p === 'responses' && this.connection.provider === 'openai',
              streaming: p !== 'gemini',
            },
            verified: [],
          },
        ]
      })
  }
  async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResult> {
    signal.throwIfAborted()
    const p = this.connection.protocol
    if (request.research && (p !== 'responses' || this.connection.provider !== 'openai'))
      throw new ByokError('CAPABILITY', 'Research requires a tested OpenAI web-search model.')
    if (
      request.prompt.length + request.system.length > 500_000 ||
      !Number.isInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.maxTokens > 200_000
    )
      throw new ByokError('LIMIT', 'Request exceeds the model limits.')
    redactCredential(request.prompt + request.system, this.key)
    const messages = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ]
    let path: string, body: ObjectValue
    if (p === 'responses') {
      path = 'responses'
      body = {
        model: request.model,
        input: messages,
        max_output_tokens: request.maxTokens,
        store: false,
        stream: request.stream ?? true,
        ...(request.structured ? { text: { format: { type: 'json_object' } } } : {}),
        ...(request.research
          ? {
              tools: [{ type: 'web_search' }],
              tool_choice: 'required',
              max_tool_calls: 1,
              include: ['web_search_call.action.sources'],
            }
          : {}),
      }
    } else if (p === 'messages') {
      path = 'messages'
      body = {
        model: request.model,
        system: request.system,
        messages: messages.slice(1),
        max_tokens: request.maxTokens,
        stream: request.stream ?? true,
      }
    } else if (p === 'gemini') {
      path = `models/${encodeURIComponent(request.model)}:generateContent`
      body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          ...(request.structured ? { responseMimeType: 'application/json' } : {}),
        },
      }
    } else if (p === 'ollama') {
      path = 'chat'
      body = {
        model: request.model,
        messages,
        stream: request.stream ?? true,
        options: { num_predict: request.maxTokens },
        ...(request.structured ? { format: 'json' } : {}),
      }
    } else {
      path = 'chat/completions'
      body = {
        model: request.model,
        messages,
        stream: request.stream ?? true,
        ...(this.connection.provider === 'groq'
          ? { max_completion_tokens: request.maxTokens }
          : { max_tokens: request.maxTokens }),
        ...(request.structured ? { response_format: { type: 'json_object' } } : {}),
        ...(request.stream !== false ? { stream_options: { include_usage: true } } : {}),
        ...(this.connection.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
        ...(this.connection.provider === 'openrouter'
          ? { provider: { require_parameters: true, allow_fallbacks: false } }
          : {}),
      }
    }
    const response = await this.transport(path, body, this.headers(), signal)
    checkResponse(response)
    let result: ModelResult
    if (body.stream) result = await this.collectStream(response, p, signal)
    else result = this.normalize(await boundedJson(response), p)
    signal.throwIfAborted()
    redactCredential(JSON.stringify(result), this.key)
    if (!result.text.trim())
      throw new ByokError('EMPTY', 'The model returned no usable content.', 502)
    if (request.research && !result.sources.length)
      throw new ByokError('NO_SOURCES', 'Research did not return verifiable sources.', 502)
    if (request.structured) {
      try {
        JSON.parse(result.text)
      } catch {
        throw new ByokError('INVALID_OUTPUT', 'The model did not return valid JSON.', 502)
      }
    }
    return result
  }
  private normalize(input: unknown, p: string): ModelResult {
    const v = object(input),
      sources: ModelResult['sources'] = []
    let text = '',
      usage: Usage,
      finish = ''
    if (p === 'responses') {
      finish = string(v.status)
      usage = usageOf(v.usage, p)
      for (const item of array(v.output).map(object)) {
        if (item.type === 'web_search_call') {
          usage.searchCalls = (usage.searchCalls ?? 0) + 1
          for (const s of array(object(item.action).sources)) {
            const parsed = source(s)
            if (parsed) sources.push(parsed)
          }
        }
        if (item.type === 'function_call')
          throw new ByokError('TOOL', 'The model requested an unsupported tool.')
        for (const part of array(item.content).map(object)) {
          if (part.type === 'refusal')
            throw new ByokError('REFUSAL', 'The model declined this request.')
          if (part.type === 'output_text') text += string(part.text)
          for (const annotation of array(part.annotations)) {
            const s = source(annotation)
            if (s) sources.push(s)
          }
        }
      }
      if (finish !== 'completed')
        throw new ByokError('INCOMPLETE', 'The provider did not complete the response.', 502)
    } else if (p === 'messages') {
      finish = string(v.stop_reason)
      usage = usageOf(v.usage, p)
      for (const part of array(v.content).map(object)) {
        if (part.type === 'text') text += string(part.text)
        if (part.type === 'tool_use')
          throw new ByokError('TOOL', 'The model requested an unsupported tool.')
      }
      if (finish !== 'end_turn')
        throw new ByokError('INCOMPLETE', 'The model stopped before completing the response.', 502)
    } else if (p === 'gemini') {
      const c = object(array(v.candidates)[0])
      finish = string(c.finishReason)
      usage = usageOf(v.usageMetadata, p)
      for (const part of array(object(c.content).parts).map(object))
        if (!part.thought) text += string(part.text)
      if (finish !== 'STOP')
        throw new ByokError('INCOMPLETE', 'The model stopped before completing the response.', 502)
    } else if (p === 'ollama') {
      text = string(object(v.message).content)
      usage = usageOf(v, p)
      if (v.done !== true || v.done_reason === 'length')
        throw new ByokError('INCOMPLETE', 'The local model did not complete the response.', 502)
    } else {
      const c = object(array(v.choices)[0]),
        m = object(c.message)
      usage = usageOf(v.usage, p)
      if (array(m.tool_calls).length || m.function_call)
        throw new ByokError('TOOL', 'The model requested an unsupported tool.')
      if (m.refusal) throw new ByokError('REFUSAL', 'The model declined this request.')
      if (c.finish_reason !== 'stop')
        throw new ByokError('INCOMPLETE', 'The model stopped before completing the response.', 502)
      text = string(m.content)
    }
    return {
      text,
      usage,
      sources: sources.filter((s, i) => sources.findIndex((x) => x.url === s.url) === i),
      requestId: string(v.id).slice(0, 200) || undefined,
    }
  }
  private async collectStream(
    response: Response,
    p: string,
    signal: AbortSignal
  ): Promise<ModelResult> {
    let text = '',
      terminal = false,
      messageEnded = false,
      final: ModelResult | undefined,
      requestId: string | undefined
    let usage: Usage = { classification: 'unknown' },
      anthropicUsage: ObjectValue = {}
    for await (const raw of jsonFrames(response, p === 'ollama' ? 'ndjson' : 'sse')) {
      signal.throwIfAborted()
      const e = object(raw)
      if (e.error || e.type === 'error')
        throw new ByokError('STREAM_ERROR', 'The provider interrupted the response.', 502)
      if (
        terminal &&
        (e.type === 'response.output_text.delta' ||
          e.type === 'content_block_delta' ||
          object(e.message).content ||
          array(e.choices).some((c) => object(object(c).delta).content))
      )
        throw new ByokError('STREAM', 'Provider sent content after completion.')
      requestId = string(e.id ?? object(e.message).id).slice(0, 200) || requestId
      if (p === 'responses') {
        if (e.type === 'response.output_text.delta') text += string(e.delta)
        if (e.type === 'response.completed') {
          if (terminal) throw new ByokError('STREAM', 'Duplicate response completion.')
          final = this.normalize(e.response, p)
          terminal = true
        }
        if (['response.failed', 'response.incomplete'].includes(string(e.type)))
          throw new ByokError('INCOMPLETE', 'The model did not complete the response.', 502)
      } else if (p === 'messages') {
        if (e.type === 'message_start') anthropicUsage = object(object(e.message).usage)
        if (e.type === 'content_block_start' && object(e.content_block).type === 'tool_use')
          throw new ByokError('TOOL', 'The model requested an unsupported tool.')
        if (e.type === 'content_block_delta' && object(e.delta).type === 'text_delta')
          text += string(object(e.delta).text)
        if (e.type === 'message_delta') {
          anthropicUsage = { ...anthropicUsage, ...object(e.usage) }
          if (object(e.delta).stop_reason && object(e.delta).stop_reason !== 'end_turn')
            throw new ByokError(
              'INCOMPLETE',
              'The model stopped before completing the response.',
              502
            )
        }
        if (e.type === 'message_delta' && object(e.delta).stop_reason === 'end_turn')
          messageEnded = true
        if (e.type === 'message_stop') {
          if (!messageEnded) throw new ByokError('INCOMPLETE', 'Missing message completion.')
          terminal = true
          usage = usageOf(anthropicUsage, p)
        }
      } else if (p === 'ollama') {
        text += string(object(e.message).content)
        if (e.done) {
          if (e.done_reason === 'length')
            throw new ByokError('INCOMPLETE', 'The model output was truncated.')
          terminal = true
          usage = usageOf(e, p)
        }
      } else {
        if (e.usage) usage = usageOf(e.usage, p)
        for (const c of array(e.choices).map(object)) {
          if (array(object(c.delta).tool_calls).length || object(c.delta).function_call)
            throw new ByokError('TOOL', 'The model requested an unsupported tool.')
          if (object(c.delta).refusal)
            throw new ByokError('REFUSAL', 'The model declined the request.')
          text += string(object(c.delta).content)
          if (c.finish_reason) {
            if (c.finish_reason !== 'stop')
              throw new ByokError('INCOMPLETE', 'The model output was truncated or refused.')
            terminal = true
          }
        }
      }
      if (text.length > 500_000)
        throw new ByokError('LIMIT', 'The model response exceeded its size limit.')
    }
    if (!terminal)
      throw new ByokError(
        'INCOMPLETE',
        'The stream ended before completion; no output was applied.',
        502
      )
    return final ?? { text, usage, sources: [], requestId }
  }
}
