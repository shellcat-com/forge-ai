import {
  assertLifetime,
  exactOrigin,
  MAX_STEPS,
  parseDispatch,
  parseResult,
  readJson,
  REQUEST_TIMEOUT_MS,
  signedRequest,
  STEP_PATH,
} from './protocol.ts'
import type { StepResult } from './protocol.ts'

/** Structural SDK port keeps orchestration tests independent of Cloudflare fixtures. */
export interface DurableSteps {
  do<T>(
    name: string,
    config: { retries: { limit: number; delay: string; backoff: 'exponential' }; timeout: string },
    callback: () => Promise<T>
  ): Promise<T>
  sleep(name: string, duration: string): Promise<void>
}
export interface WorkflowConfig {
  enabled: boolean
  controlOrigin: string
  stepSecret: string
}
export async function runDispatch(
  payload: unknown,
  step: DurableSteps,
  config: WorkflowConfig,
  dependencies: { fetch?: typeof fetch; now?: () => number } = {}
): Promise<StepResult> {
  const dispatch = parseDispatch(payload)
  const now = dependencies.now ?? Date.now
  const fetcher = dependencies.fetch ?? fetch
  const blocked: StepResult = { schemaVersion: 1, state: 'blocked', retryAfterSeconds: 0 }
  if (!config.enabled) return blocked
  const url = exactOrigin(config.controlOrigin) + STEP_PATH
  for (let sequence = 0; sequence < MAX_STEPS; sequence++) {
    try {
      assertLifetime(dispatch, now())
    } catch {
      return blocked
    }
    const result = parseResult(
      await step.do(
        `control-${sequence}`,
        {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: '1 minute',
        },
        async () => {
          // Recomputed authentication freshness, but the same durable command identity on retry.
          const request = await signedRequest(
            url,
            'forge-worker-step-v1',
            { ...dispatch, sequence },
            config.stepSecret,
            now()
          )
          const controller = new AbortController()
          const timer = setTimeout(
            () => controller.abort(),
            Math.min(REQUEST_TIMEOUT_MS, Date.parse(dispatch.expiresAt) - now())
          )
          try {
            const response = await fetcher(request, {
              redirect: 'error',
              signal: controller.signal,
            })
            if (response.status === 401 || response.status === 403 || response.status === 409) {
              await response.body?.cancel()
              return blocked
            }
            if (response.status !== 200 || response.redirected) {
              await response.body?.cancel()
              throw new Error('CONTROL_STEP_UNAVAILABLE')
            }
            return parseResult(await readJson(response))
          } catch {
            throw new Error('CONTROL_STEP_UNAVAILABLE')
          } finally {
            clearTimeout(timer)
            controller.abort()
          }
        }
      )
    )
    if (result.state !== 'continue') return result
    if (
      sequence === MAX_STEPS - 1 ||
      now() + result.retryAfterSeconds * 1000 >= Date.parse(dispatch.expiresAt)
    )
      return blocked
    await step.sleep(`delay-${sequence}`, `${result.retryAfterSeconds} seconds`)
  }
  return blocked
}
