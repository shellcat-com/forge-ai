import { authenticate, parseCommand, parseResult, SchedulerError } from './protocol.ts'
import type { StepCommand, StepResult } from './protocol.ts'

/** Implement in the canonical E1 composition, not as an unfenced runOnce wrapper.
 * In one authority transaction: bind dispatch to admitted tenant/job/deadline,
 * deduplicate (dispatchId, sequence), reacquire job/lease/actor/policy/credential/
 * capacity authority, and preserve unknown outcomes for reconciliation.
 * Replayed deliveries must never create new provider/runner operation identities.
 */
export interface BoundedControlStep {
  execute(command: Readonly<StepCommand>, signal: AbortSignal): Promise<StepResult>
}
export interface StepHandlerConfig {
  enabled: boolean
  origin: string
  secret: string
  control?: BoundedControlStep
  now?: () => number
}
const reply = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** No listener or default fixture is installed. Missing real composition fails closed. */
export function createWorkerStepHandler(config: StepHandlerConfig) {
  const now = config.now ?? Date.now
  return async (request: Request): Promise<Response> => {
    if (!config.enabled || !config.control) return reply(503, { error: 'WORKER_UNAVAILABLE' })
    let command: StepCommand
    try {
      command = parseCommand(
        await authenticate(request, config.origin, 'forge-worker-step-v1', config.secret, now())
      )
    } catch (error) {
      const status = error instanceof SchedulerError && error.code === 'UNAVAILABLE' ? 503 : 401
      return reply(status, { error: status === 503 ? 'WORKER_UNAVAILABLE' : 'REQUEST_REJECTED' })
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timeout = Math.min(50_000, Date.parse(command.expiresAt) - now())
    if (timeout <= 0 || request.signal.aborted) return reply(409, { error: 'DISPATCH_EXPIRED' })
    request.signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const expired = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new SchedulerError('UNAVAILABLE')),
          { once: true }
        )
        timer = setTimeout(abort, timeout)
      })
      const result = parseResult(
        await Promise.race([
          config.control.execute(Object.freeze(command), controller.signal),
          expired,
        ])
      )
      if (controller.signal.aborted || now() >= Date.parse(command.expiresAt))
        throw new SchedulerError('EXPIRED')
      return reply(200, result)
    } catch {
      // This is transport failure, not evidence that side effects stopped or cost is zero.
      return reply(503, { error: 'STEP_OUTCOME_UNAVAILABLE' })
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abort)
      controller.abort()
    }
  }
}
