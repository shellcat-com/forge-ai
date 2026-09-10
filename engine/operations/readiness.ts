import { z } from 'zod'
import { digest, timestamp, uint, uuid } from '../contracts/primitives.ts'

const sampleSchema = z.strictObject({
  id: uuid, corpusDigest: digest, templateDigest: digest, policyDigest: digest,
  origin: z.enum(['live', 'fixture']),
  workload: z.enum(['task-board', 'task-board-priority', 'pomodoro-history']),
  outcome: z.enum(['passed', 'failed', 'timeout', 'cancelled', 'denied']),
  repairs: uint.max(2), calls: uint.max(12),
  activeMs: uint, queueMs: uint, apiMs: uint, eventMs: uint,
  previewMs: uint.nullable(), costMicros: uint.nullable(),
  charge: z.enum(['measured', 'estimated', 'uncertain']),
  requiredChecksPassed: z.boolean(),
}).refine(s => s.outcome !== 'passed' || s.requiredChecksPassed, 'Passing run lacks required checks')
export const campaignSchema = z.strictObject({
  schemaVersion: z.literal(1), startedAt: timestamp, finishedAt: timestamp,
  environment: z.strictObject({ hardware: z.string().min(1).max(500), region: z.string().min(1).max(80),
    provider: z.string().min(1).max(120), model: z.string().min(1).max(120),
    runner: z.string().min(1).max(120), concurrency: uint.min(1),
    arrivalRatePerMinute: uint.min(1), approvedSpendMicros: uint }),
  corpusDigest: digest, templateDigest: digest, policyDigest: digest,
  samples: z.array(sampleSchema).max(100_000),
}).superRefine((c, ctx) => {
  if (Date.parse(c.finishedAt) < Date.parse(c.startedAt)) ctx.addIssue({ code: 'custom', message: 'Invalid campaign times' })
  if (new Set(c.samples.map(s => s.id)).size !== c.samples.length) ctx.addIssue({ code: 'custom', message: 'Duplicate sample' })
  if (c.samples.some(s => s.corpusDigest !== c.corpusDigest || s.templateDigest !== c.templateDigest || s.policyDigest !== c.policyDigest))
    ctx.addIssue({ code: 'custom', message: 'Mixed release or corpus' })
})

function p95(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}
function wilson(passed: number, total: number): [number, number] | null {
  if (!total) return null
  const z = 1.959963984540054, fraction = passed / total
  const divisor = 1 + z * z / total
  const center = (fraction + z * z / (2 * total)) / divisor
  const margin = z * Math.sqrt(fraction * (1 - fraction) / total + z * z / (4 * total * total)) / divisor
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}
/** Summarizes supplied measurements; never runs providers or treats a supplied
 * label as authenticated provenance. Release sign-off must verify raw evidence. */
export function summarizeCampaign(input: unknown) {
  const campaign = campaignSchema.parse(input)
  const live = campaign.samples.filter(s => s.origin === 'live')
  const admitted = live.filter(s => s.outcome !== 'denied')
  const passed = admitted.filter(s => s.outcome === 'passed')
  const counts = Object.fromEntries(['passed', 'failed', 'timeout', 'cancelled', 'denied'].map(outcome =>
    [outcome, live.filter(s => s.outcome === outcome).length]))
  const knownCost = live.reduce((n, s) => n + BigInt(s.costMicros ?? 0), 0n)
  const previews = admitted.flatMap(s => s.previewMs === null ? [] : [s.previewMs])
  return {
    schemaVersion: 1, evidence: 'supplied-measurements-not-attestation',
    releaseReady: false, // D1–D8, real isolation, acceptance and operator sign-off are separate gates.
    attempts: live.length, admitted: admitted.length, counts,
    fixtureSamplesExcluded: campaign.samples.length - live.length,
    admittedDemandRatio: live.length ? admitted.length / live.length : null,
    successRate: admitted.length ? passed.length / admitted.length : null,
    success95PercentInterval: wilson(passed.length, admitted.length),
    p95: { apiMs: p95(live.map(s => s.apiMs)), queueMs: p95(admitted.map(s => s.queueMs)),
      activeMs: p95(admitted.map(s => s.activeMs)), eventMs: p95(admitted.map(s => s.eventMs)),
      previewMs: p95(previews) },
    previewSamples: previews.length,
    cost: { knownMicros: knownCost.toString(), unknownSamples: live.filter(s => s.costMicros === null || s.charge === 'uncertain').length,
      estimatedSamples: live.filter(s => s.charge === 'estimated').length,
      overApprovedEnvelope: knownCost > BigInt(campaign.environment.approvedSpendMicros) },
    benchmarkThresholdMet: admitted.length >= 30 && passed.length / admitted.length >= 0.9
      && new Set(admitted.map(s => s.workload)).size === 3,
    environment: campaign.environment,
  }
}

const backupSchema = z.strictObject({ schemaVersion: z.literal(1),
  origin: z.enum(['synthetic-restore', 'deployed-restore']),
  startedAt: timestamp, restoredAt: timestamp, lastRecoverableCommitAt: timestamp, failureAt: timestamp,
  databaseIntegrityPassed: z.boolean(), authorizationChecksPassed: z.boolean(),
  objects: z.array(z.strictObject({ artifactId: uuid, expectedVersion: z.string().min(1).max(200),
    restoredVersion: z.string().min(1).max(200).nullable(), expectedDigest: digest, restoredDigest: digest.nullable() })).max(100_000),
}).refine(x => new Set(x.objects.map(o => o.artifactId)).size === x.objects.length, 'Duplicate artifact reference')
/** Caller must compute restored digests from actual bytes, not backup metadata. */
export function evaluateRestore(input: unknown) {
  const drill = backupSchema.parse(input)
  const rpoMs = Date.parse(drill.failureAt) - Date.parse(drill.lastRecoverableCommitAt)
  const drillExecutionMs = Date.parse(drill.restoredAt) - Date.parse(drill.startedAt)
  const rtoMs = Date.parse(drill.restoredAt) - Date.parse(drill.failureAt)
  if (rpoMs < 0 || drillExecutionMs < 0 || rtoMs < 0 || Date.parse(drill.startedAt) < Date.parse(drill.failureAt)) throw new Error('Invalid recovery timeline')
  const brokenArtifactIds = drill.objects.filter(o => o.expectedVersion !== o.restoredVersion || o.expectedDigest !== o.restoredDigest).map(o => o.artifactId)
  return { schemaVersion: 1, origin: drill.origin, rpoMs, rtoMs, drillExecutionMs, objectCount: drill.objects.length, brokenArtifactIds,
    targetMet: drill.origin === 'deployed-restore' && drill.objects.length > 0 && drill.databaseIntegrityPassed
      && drill.authorizationChecksPassed && brokenArtifactIds.length === 0 && rpoMs <= 900_000 && rtoMs <= 14_400_000 }
}
