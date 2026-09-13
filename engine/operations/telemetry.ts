import { z } from 'zod'
import { timestamp, uint, uuid } from '../contracts/primitives.ts'

const eventSchema = z.strictObject({ schemaVersion: z.literal(1), at: timestamp,
  event: z.enum(['stage.completed', 'lease.lost', 'provider.unavailable', 'cleanup.pending', 'quota.denied',
    'preview.unhealthy', 'authorization.denied', 'integrity.violation']),
  requestId: uuid, jobId: uuid.optional(), operationId: uuid.optional(),
  durationMs: uint.optional(), count: uint.optional(),
  outcome: z.enum(['passed', 'failed', 'blocked', 'uncertain']),
})
/** Strict structural telemetry: unknown fields reject instead of attempting to
 * redact arbitrary prompts, source or provider error messages. IDs are trace
 * fields; never use them as metric labels. */
export function telemetryEvent(input: unknown): string {
  const result = eventSchema.safeParse(input)
  if (!result.success) throw new Error('INVALID_TELEMETRY_EVENT')
  return JSON.stringify(result.data)
}
export const healthSchema = z.strictObject({ oldestQueuedMs: uint, cleanupPendingMs: uint,
  providerFailures: uint, integrityViolations: uint, unhealthyPreviewRoutes: uint,
  spendReservationExceeded: z.boolean(), resourcePressure: z.boolean() })
export function healthActions(input: unknown) {
  const h = healthSchema.parse(input)
  const alerts: string[] = []
  if (h.oldestQueuedMs > 120_000) alerts.push('QUEUE_AGE')
  if (h.cleanupPendingMs > 60_000) alerts.push('CLEANUP_UNCONFIRMED')
  if (h.providerFailures >= 3) alerts.push('PROVIDER_OUTAGE')
  if (h.integrityViolations > 0) alerts.push('INTEGRITY_VIOLATION')
  if (h.unhealthyPreviewRoutes > 0) alerts.push('UNHEALTHY_ROUTE')
  if (h.spendReservationExceeded) alerts.push('RESERVATION_EXCEEDED')
  if (h.resourcePressure) alerts.push('RESOURCE_PRESSURE')
  return { alerts, disableNewExecution: h.integrityViolations > 0 || h.spendReservationExceeded || h.resourcePressure,
    revokeAffectedPreviews: h.integrityViolations > 0 || h.unhealthyPreviewRoutes > 0,
    keepReadsAndCancellationAvailable: true }
}
