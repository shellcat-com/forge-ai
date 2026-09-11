import { deliverDispatch } from './delivery.ts'
import type { Dispatch } from './protocol.ts'
import type { PostgresSchedulerOutbox } from './outbox.ts'

/** One durable claim + one external delivery + one fenced acknowledgement.
 * No network operation is inside a database transaction. Call only with an
 * already admitted intent, approved origins and an actual allowance gate.
 */
export async function deliverOutboxIntent(
  store: PostgresSchedulerOutbox,
  dispatch: Dispatch,
  config: Parameters<typeof deliverDispatch>[1],
  dependencies: Parameters<typeof deliverDispatch>[2] = {}
): Promise<'disabled' | 'idle' | 'recorded' | 'unresolved'> {
  if (!config.enabled) return 'disabled'
  const claim = await store.claimDelivery(dispatch)
  if (!claim) return 'idle'
  let outcome: 'acknowledged' | 'rejected' | 'unknown' = 'unknown'
  try {
    const delivered = await deliverDispatch(claim.dispatch, config, dependencies)
    if (delivered !== 'disabled') outcome = delivered
  } catch {
    // A thrown/ambiguous transport result is not permission for a replacement ID.
  }
  try {
    await store.recordDelivery(claim, outcome)
    return outcome === 'unknown' ? 'unresolved' : 'recorded'
  } catch {
    // Preserve claim for reconciliation; never repeat HTTP after a receipt failure.
    return 'unresolved'
  }
}
