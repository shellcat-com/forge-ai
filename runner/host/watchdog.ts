import type { HostLeaseSupervisor } from './lifecycle.ts'

/** Run in the HOST supervisor process, independently of the control connection.
 * Ticks overlap only to discover newly expired leases; cleanup is coalesced by
 * operation in HostLeaseSupervisor. No invocation automatically starts guests. */
export async function watchHost(supervisor: HostLeaseSupervisor, signal: AbortSignal,
  onFailure: (error: Error) => void, intervalMs = 1000): Promise<void> {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 1000) throw new Error('Invalid watchdog interval')
  const ticks = new Set<Promise<unknown>>()
  const tick = () => {
    if (ticks.size >= 32) { onFailure(new Error('Host watchdog backlog; require host quarantine')); return }
    const pending = supervisor.tick().catch(() => onFailure(new Error('Host watchdog failed; require host quarantine'))).finally(() => ticks.delete(pending))
    ticks.add(pending)
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  try {
    await new Promise<void>(resolve => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => resolve(), { once: true })
    })
  } finally { clearInterval(timer); await Promise.allSettled(ticks) }
}
