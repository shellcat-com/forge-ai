import { z } from 'zod'
import { pinnedProviderFetch } from './destination.ts'

export const hostedProviderId = z.enum(['gemini', 'groq', 'openrouter'])
export type HostedProviderId = z.infer<typeof hostedProviderId>
export const hostedCatalog = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    catalog: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    models: ['gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    catalog: 'https://api.groq.com/openai/v1/models',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    catalog: 'https://openrouter.ai/api/v1/models',
    models: ['openai/gpt-oss-120b:free', 'openai/gpt-oss-20b:free'],
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
] as const
export const hostedConnectionPolicy = {
  policy(id: string, capability: 'plan' | 'files' | 'repair') {
    const found = hostedCatalog.find((p) => p.id === id)
    if (!found || !['plan', 'files', 'repair'].includes(capability))
      throw new Error('PROVIDER_UNSUPPORTED')
    return found
  },
}

export class ConnectionCheckError extends Error {
  constructor(
    readonly code:
      | 'KEY_REJECTED'
      | 'PROVIDER_LIMIT'
      | 'MODEL_UNAVAILABLE'
      | 'PROVIDER_UNAVAILABLE'
      | 'FREE_TIER_REQUIRED'
  ) {
    super(code)
  }
}
const modelData = z.object({
  data: z
    .array(
      z.object({
        id: z.string().max(200),
        active: z.boolean().optional(),
        supported_parameters: z.array(z.string()).optional(),
        pricing: z.record(z.string(), z.string()).optional(),
      })
    )
    .max(3000),
})

/** A bounded, authenticated metadata probe, not a generation test. Injected
 * transport is used only by explicit contract tests. No completion is billed. */
export async function checkHostedModel(
  input: {
    provider: string
    model: string
    key: string
    freeTierConfirmed: boolean
  },
  signal: AbortSignal,
  transport?: typeof fetch
) {
  const policy = hostedConnectionPolicy.policy(input.provider, 'files')
  if (!input.freeTierConfirmed) throw new ConnectionCheckError('FREE_TIER_REQUIRED')
  if (!policy.models.some((model) => model === input.model))
    throw new ConnectionCheckError('MODEL_UNAVAILABLE')
  const endpoints = [
    policy.catalog,
    ...(policy.id === 'openrouter' ? ['https://openrouter.ai/api/v1/key'] : []),
  ]
  const request = transport ?? pinnedProviderFetch(endpoints, 'GET')
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)])
  async function get(url: string): Promise<unknown> {
    bounded.throwIfAborted()
    const response = await request(url, {
      method: 'GET',
      redirect: 'error',
      signal: bounded,
      headers: { Authorization: `Bearer ${input.key}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ConnectionCheckError(
        response.status === 401 || response.status === 403
          ? 'KEY_REJECTED'
          : response.status === 429
            ? 'PROVIDER_LIMIT'
            : 'PROVIDER_UNAVAILABLE'
      )
    }
    if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) {
      await response.body?.cancel()
      throw new ConnectionCheckError('PROVIDER_UNAVAILABLE')
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        bounded.throwIfAborted()
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > 2 * 1024 * 1024) throw new ConnectionCheckError('PROVIDER_UNAVAILABLE')
        chunks.push(part.value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
  try {
    // OpenRouter's model list is public: a separate protected endpoint verifies the key.
    if (policy.id === 'openrouter') {
      const keyInfo = await get('https://openrouter.ai/api/v1/key')
      if (!z.object({ data: z.object({ label: z.string() }) }).safeParse(keyInfo).success)
        throw new ConnectionCheckError('KEY_REJECTED')
    }
    const catalog = modelData.parse(await get(policy.catalog))
    const model = catalog.data.find((m) => m.id === input.model && m.active !== false)
    if (!model) throw new ConnectionCheckError('MODEL_UNAVAILABLE')
    if (policy.id === 'openrouter') {
      if (
        !model.supported_parameters?.includes('response_format') ||
        !model.pricing ||
        !['prompt', 'completion'].every((name) => /^0(?:\.0+)?$/.test(model.pricing![name] ?? ''))
      )
        throw new ConnectionCheckError('FREE_TIER_REQUIRED')
      for (const value of Object.values(model.pricing))
        if (!/^0(?:\.0+)?$/.test(value)) throw new ConnectionCheckError('FREE_TIER_REQUIRED')
    }
    return {
      provider: policy.id,
      model: input.model,
      checkedAt: new Date().toISOString(),
      generationVerified: false as const,
    }
  } catch (error) {
    if (error instanceof ConnectionCheckError) throw error
    throw new ConnectionCheckError('PROVIDER_UNAVAILABLE')
  }
}
