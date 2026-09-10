import { generate, models, ProviderError } from '../provider.mjs'
import { HttpError } from './contracts.mjs'

// Single-instance staging budget. Use a shared quota before scaling replicas.
export function createPlanner({
  key = '',
  enabled = false,
  dailyLimit = 20,
  now = Date.now,
  timeoutMs = 120000,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000)
    throw new Error('Invalid planning budget.')
  let day = '',
    calls = 0,
    active = false
  return {
    configuration: () => ({
      configured: enabled && Boolean(key),
      models: enabled && key ? models : [],
      scope: 'Text planning only; no files, execution or deployment.',
      dailyLimit,
    }),
    async run(brief, model, signal) {
      if (!enabled || !key) throw new HttpError(503, 'Hosted text planning is not configured.')
      if (!models.some((m) => m.id === model))
        throw new HttpError(422, 'Choose an available model.')
      const today = new Date(now()).toISOString().slice(0, 10)
      if (day !== today) {
        day = today
        calls = 0
      }
      if (active || calls >= dailyLimit)
        throw new HttpError(
          429,
          'Planning is busy or its daily budget is exhausted. Try again later.'
        )
      active = true
      calls++
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) controller.abort()
      const timer = setTimeout(abort, timeoutMs)
      try {
        return await generate({ ...brief, model, key, fetchImpl, signal: controller.signal })
      } catch (error) {
        throw new HttpError(
          controller.signal.aborted ? 504 : error instanceof ProviderError ? error.status : 502,
          controller.signal.aborted
            ? 'Planning timed out or was cancelled. Your saved brief is unchanged.'
            : 'The planning provider could not complete this request. Your saved brief is unchanged.'
        )
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        active = false
      }
    },
  }
}
