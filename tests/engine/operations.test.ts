import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { summarizeCampaign, evaluateRestore } from '../../engine/operations/readiness.ts'
import { healthActions, telemetryEvent } from '../../engine/operations/telemetry.ts'
const hash = 'a'.repeat(64)
const at = '2026-09-10T00:00:00Z'
function campaign() {
  return { schemaVersion: 1, startedAt: at, finishedAt: at,
    environment: { hardware: 'synthetic input only', region: 'local', provider: 'fixture', model: 'fixture', runner: 'fixture', concurrency: 2, arrivalRatePerMinute: 1, approvedSpendMicros: 100 },
    corpusDigest: hash, templateDigest: hash, policyDigest: hash,
    samples: Array.from({ length: 30 }, (_, i) => ({ id: randomUUID(), corpusDigest: hash, templateDigest: hash, policyDigest: hash,
      origin: 'live', workload: ['task-board', 'task-board-priority', 'pomodoro-history'][i % 3], outcome: 'passed', repairs: 0, calls: 1,
      activeMs: 100, queueMs: 10, apiMs: 5, eventMs: 1, previewMs: 5, costMicros: 1, charge: 'measured', requiredChecksPassed: true })) }
}
describe('operations calculations (synthetic inputs, no measured capacity claim)', () => {
  it('excludes fixtures and reports no readiness from empty live denominator', () => {
    const c = campaign(); c.samples.forEach(s => { s.origin = 'fixture' })
    expect(summarizeCampaign(c)).toMatchObject({ attempts: 0, successRate: null, benchmarkThresholdMet: false, releaseReady: false, fixtureSamplesExcluded: 30 })
  })
  it('retains failed/timeout/cancelled attempts and reports denials separately', () => {
    const c = campaign(); c.samples[0].outcome = 'failed'; c.samples[1].outcome = 'timeout'; c.samples[2].outcome = 'cancelled'; c.samples[3].outcome = 'denied'
    const summary = summarizeCampaign(c)
    expect(summary.admitted).toBe(29); expect(summary.successRate).toBe(26 / 29)
    expect(summary.counts).toEqual({ passed: 26, failed: 1, timeout: 1, cancelled: 1, denied: 1 })
    expect(summary.benchmarkThresholdMet).toBe(false)
  })
  it('does not discard failures from latency samples or round charges', () => {
    const c = campaign(); c.samples[0].activeMs = 1_200_000; c.samples[0].outcome = 'timeout'; c.samples[1].activeMs = 1_200_000
    c.samples[2].charge = 'uncertain'; c.samples[3].costMicros = Number.MAX_SAFE_INTEGER
    const summary = summarizeCampaign(c)
    expect(summary.p95.activeMs).toBe(1_200_000); expect(summary.cost.unknownSamples).toBe(1)
    expect(summary.cost.knownMicros).toBe((BigInt(Number.MAX_SAFE_INTEGER) + 29n).toString())
    expect(summary.cost.overApprovedEnvelope).toBe(true)
  })
  it('rejects duplicate, mixed-policy or unsupported passing measurements', () => {
    const c = campaign(); c.samples[1].id = c.samples[0].id; expect(() => summarizeCampaign(c)).toThrow()
    const d = campaign(); d.samples[1].policyDigest = 'b'.repeat(64); expect(() => summarizeCampaign(d)).toThrow()
    const e = campaign(); e.samples[1].requiredChecksPassed = false; expect(() => summarizeCampaign(e)).toThrow()
  })
  it('returns uncertainty and threshold without claiming deployment readiness', () => {
    const result = summarizeCampaign(campaign())
    expect(result.benchmarkThresholdMet).toBe(true); expect(result.success95PercentInterval![0]).toBeLessThan(0.9)
    expect(result.releaseReady).toBe(false)
  })
  it('checks restored object versions and measured RPO/RTO; synthetic restore cannot pass release', () => {
    const drill = { schemaVersion: 1, origin: 'deployed-restore', startedAt: at, restoredAt: '2026-09-10T01:00:00Z',
      lastRecoverableCommitAt: '2026-09-09T23:50:00Z', failureAt: at, databaseIntegrityPassed: true, authorizationChecksPassed: true,
      objects: [{ artifactId: randomUUID(), expectedVersion: 'v1', restoredVersion: 'v1', expectedDigest: hash, restoredDigest: hash }] }
    expect(evaluateRestore(drill).targetMet).toBe(true)
    expect(evaluateRestore({ ...drill, startedAt: '2026-09-11T00:00:00Z', restoredAt: '2026-09-11T01:00:00Z' })).toMatchObject({ targetMet: false, rtoMs: 90_000_000, drillExecutionMs: 3_600_000 })
    expect(evaluateRestore({ ...drill, origin: 'synthetic-restore' }).targetMet).toBe(false)
    drill.objects[0].restoredVersion = 'v2'; expect(evaluateRestore(drill).targetMet).toBe(false)
  })
  it('strict telemetry refuses source, prompts and arbitrary error fields', () => {
    const safe = { schemaVersion: 1, at, event: 'provider.unavailable', requestId: randomUUID(), outcome: 'uncertain' }
    expect(telemetryEvent(safe)).not.toContain('secret')
    expect(() => telemetryEvent({ ...safe, CANARY_FIELD_NAME: true })).toThrow(/^INVALID_TELEMETRY_EVENT$/)
    for (const key of ['prompt', 'source', 'error', 'credentials']) expect(() => telemetryEvent({ ...safe, [key]: 'CANARY_SECRET' })).toThrow()
  })
  it('keeps read/cancel access during admission shutdown and flags unconfirmed cleanup', () => {
    expect(healthActions({ oldestQueuedMs: 121_000, cleanupPendingMs: 61_000, providerFailures: 3, integrityViolations: 1,
      unhealthyPreviewRoutes: 1, spendReservationExceeded: false, resourcePressure: false })).toMatchObject({
      disableNewExecution: true, revokeAffectedPreviews: true, keepReadsAndCancellationAvailable: true,
      alerts: ['QUEUE_AGE', 'CLEANUP_UNCONFIRMED', 'PROVIDER_OUTAGE', 'INTEGRITY_VIOLATION', 'UNHEALTHY_ROUTE'] })
  })
})
