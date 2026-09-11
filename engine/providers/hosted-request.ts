import type { GenerationRequest } from '../contracts/provider.ts'
import { hostedConnectionPolicy, hostedProviderId } from './hosted-catalog.ts'
import type { HostedProviderId } from './hosted-catalog.ts'

/** Reviewed request dialect, never a browser-selected endpoint or arbitrary extra
 * body. Metadata validation alone does not authorize generation or prove billing. */
export function assertHostedRequestProfile(
  profile: HostedProviderId,
  endpoint: string,
  model: string
) {
  const provider = hostedConnectionPolicy.policy(hostedProviderId.parse(profile), 'files')
  if (provider.endpoint !== endpoint || !provider.models.some((id) => id === model))
    throw new Error('PROVIDER_PROFILE_MISMATCH')
}

export function hostedRequestBody(profile: HostedProviderId, request: GenerationRequest) {
  const common = {
    model: request.model,
    messages: request.context,
    stream: false,
    response_format: { type: 'json_object' },
  }
  switch (profile) {
    case 'gemini':
      // The reviewed 2.5 Flash supports disabling thinking. This avoids consuming
      // the small source-output allowance with an unbounded default thinking budget.
      return { ...common, max_tokens: request.maxOutputTokens, reasoning_effort: 'none' }
    case 'groq':
      return {
        ...common,
        max_completion_tokens: request.maxOutputTokens,
        service_tier: 'on_demand',
        reasoning_effort: 'low',
      }
    case 'openrouter':
      return {
        ...common,
        max_tokens: request.maxOutputTokens,
        provider: {
          allow_fallbacks: false,
          require_parameters: true,
          max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
        },
      }
  }
}
