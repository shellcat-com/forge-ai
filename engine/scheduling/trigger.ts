import { authenticate, parseDispatch, SchedulerError } from './protocol.ts'
import type { Dispatch } from './protocol.ts'

export interface DispatchBinding {
  create(input: { id: string; params: Dispatch }): Promise<unknown>
  get(id: string): Promise<{ status(): Promise<{ status: string }> }>
}
// A timeout means an unknown outcome: it cannot cancel Cloudflare creation.
// The E1 outbox must reconcile the same ID, never create a replacement here.
async function bounded<T>(operation: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DISPATCH_OUTCOME_UNAVAILABLE')), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
export function createTriggerHandler(config: {
  enabled: boolean
  origin: string
  secret: string
  workflow: DispatchBinding
  now?: () => number
}) {
  const reply = (status: number, body: unknown) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
  return async (request: Request) => {
    if (!config.enabled) return reply(503, { error: 'SCHEDULER_UNAVAILABLE' })
    let dispatch: Dispatch
    try {
      dispatch = parseDispatch(
        await authenticate(
          request,
          config.origin,
          'forge-scheduler-trigger-v1',
          config.secret,
          (config.now ?? Date.now)()
        )
      )
    } catch (error) {
      return reply(error instanceof SchedulerError && error.code === 'UNAVAILABLE' ? 503 : 401, {
        error: 'REQUEST_REJECTED',
      })
    }
    try {
      await bounded(
        () => config.workflow.create({ id: dispatch.dispatchId, params: dispatch }),
        10_000
      )
      return reply(202, { schemaVersion: 1, dispatchId: dispatch.dispatchId })
    } catch {
      // Only immutable E1 outbox intents may supply IDs. A lookup resolves a
      // duplicate/unknown create; delivery acknowledgement is not job success.
      try {
        const { status } = await bounded(async () => {
          const instance = await config.workflow.get(dispatch.dispatchId)
          return instance.status()
        }, 5000)
        if (
          [
            'queued',
            'running',
            'paused',
            'errored',
            'terminated',
            'complete',
            'waiting',
            'waitingForPause',
          ].includes(status)
        )
          return reply(202, { schemaVersion: 1, dispatchId: dispatch.dispatchId })
      } catch {
        /* Retain the outbox intent when creation and lookup are both uncertain. */
      }
      return reply(503, { error: 'DISPATCH_OUTCOME_UNAVAILABLE' })
    }
  }
}
