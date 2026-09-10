import { exactOrigin, parseDispatch, readJson, signedRequest, TRIGGER_PATH } from './protocol.ts'
import type { Dispatch } from './protocol.ts'

/** An acknowledgement proves only that the workflow ID exists, not that a job ran. */
export type DeliveryOutcome = 'acknowledged' | 'rejected' | 'unknown' | 'disabled'

/** Call only for an immutable, admitted PostgreSQL outbox intent. No automatic retries. */
export async function deliverDispatch(
  dispatch: Dispatch,
  config: {
    enabled: boolean
    schedulerOrigin: string
    triggerSecret: string
  },
  dependencies: { fetch?: typeof fetch; now?: () => number } = {}
): Promise<DeliveryOutcome> {
  if (!config.enabled) return 'disabled'
  const now = dependencies.now ?? Date.now
  const metadata = parseDispatch(dispatch)
  const request = await signedRequest(
    exactOrigin(config.schedulerOrigin) + TRIGGER_PATH,
    'forge-scheduler-trigger-v1',
    metadata,
    config.triggerSecret,
    now()
  )
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(25_000, Date.parse(metadata.expiresAt) - now())
  )
  try {
    const response = await (dependencies.fetch ?? fetch)(request, {
      redirect: 'error',
      signal: controller.signal,
    })
    if ([401, 403, 409].includes(response.status)) {
      await response.body?.cancel()
      return 'rejected'
    }
    if (response.status !== 202 || response.redirected) {
      await response.body?.cancel()
      return 'unknown'
    }
    const body = await readJson(response)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unknown'
    const ack = body as Record<string, unknown>
    return Object.keys(ack).length === 2 &&
      ack.schemaVersion === 1 &&
      ack.dispatchId === metadata.dispatchId
      ? 'acknowledged'
      : 'unknown'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}
