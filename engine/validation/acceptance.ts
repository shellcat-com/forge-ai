import { z } from 'zod'
import { digest } from '../contracts/primitives.ts'

export const acceptanceIds = Array.from({ length: 22 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`)
export type EvidenceMode = 'fixture' | 'unit' | 'embedded-postgres' | 'native-postgres' | 'live-provider' | 'microvm' | 'browser' | 'deployment' | 'load' | 'restore' | 'repository'
export type AcceptanceStatus = 'passed' | 'failed' | 'blocked' | 'not-run'
const modes = z.enum(['fixture', 'unit', 'embedded-postgres', 'native-postgres', 'live-provider', 'microvm', 'browser', 'deployment', 'load', 'restore', 'repository'])
export const evidenceSchema = z.strictObject({ id: z.string().min(1).max(200), scenario: z.string().regex(/^A(0[1-9]|1[0-9]|2[0-2])$/),
  result: z.enum(['passed', 'failed']), modes: z.array(modes).min(1), assertions: z.array(z.string().min(1)).min(1),
  sourceDigest: digest, templateDigest: digest, policyDigest: digest, artifactDigest: digest,
  environment: z.string().min(1).max(2000), runId: z.string().min(1).max(200),
  benchmarkVariant: z.enum(['task-board', 'pomodoro']).nullable() })
export type AcceptanceEvidence = z.infer<typeof evidenceSchema>
// Every named assertion denotes the complete scenario, not an assertion derived
// from guest stdout. The trusted evidence issuer owns each concrete harness.
export const acceptanceRequirements: Record<string, { modes: EvidenceMode[]; assertions: string[]; dependsOn: string[] }> = {
  A01: { modes: ['live-provider', 'microvm', 'native-postgres', 'browser'], assertions: ['source-reviewed', 'all-required-checks', 'task-crud', 'app-restart-persistence'], dependsOn: [] },
  A02: { modes: ['live-provider', 'microvm', 'native-postgres', 'browser'], assertions: ['approved-priority-diff', 'fresh-and-prior-migrations', 'priority-crud-regression'], dependsOn: ['A01'] },
  A03: { modes: ['deployment', 'microvm', 'native-postgres'], assertions: ['failed-head-unchanged', 'restore-new-history', 'acknowledged-data-reset'], dependsOn: ['A01'] },
  A04: { modes: ['microvm', 'native-postgres'], assertions: ['clean-lockfile-install', 'export-build-run', 'export-secret-exclusion'], dependsOn: ['A01'] },
  A05: { modes: ['deployment', 'native-postgres', 'microvm'], assertions: ['missing-stale-approval-denied', 'promotion-cancel-race', 'approved-byte-binding'], dependsOn: [] },
  A06: { modes: ['deployment', 'browser', 'native-postgres'], assertions: ['all-endpoints-two-tenant', 'revocation-within-target'], dependsOn: [] },
  A07: { modes: ['deployment', 'browser', 'native-postgres'], assertions: ['disconnect-continues', 'replay-deduplicates', 'idempotent-admission'], dependsOn: [] },
  A08: { modes: ['deployment', 'microvm', 'native-postgres'], assertions: ['all-five-crash-points', 'no-duplicate-charge-or-promotion', 'orphan-cleanup'], dependsOn: [] },
  A09: { modes: ['deployment', 'microvm'], assertions: ['stale-epoch-denied', 'expired-lease-cleanup', 'stale-upstream-denied'], dependsOn: [] },
  A10: { modes: ['deployment', 'microvm'], assertions: ['every-state-cancel-partition', 'route-revocation-target', 'fenced-commands', 'resource-baseline-or-quarantine'], dependsOn: [] },
  A11: { modes: ['live-provider'], assertions: ['all-provider-faults', 'bounded-redacted-errors', 'no-partial-execution', 'uncertain-billing-retained'], dependsOn: [] },
  A12: { modes: ['microvm', 'native-postgres'], assertions: ['complete-adversarial-corpus', 'no-host-control-access', 'no-check-or-network-expansion'], dependsOn: [] },
  A13: { modes: ['microvm'], assertions: ['cpu-ram-disk-process-hang', 'neighbor-responsive', 'bounded-logs', 'no-orphans'], dependsOn: [] },
  A14: { modes: ['deployment', 'browser'], assertions: ['host-ticket-cookie-session-csrf', 'no-platform-credentials', 'gateway-cookie-protected', 'domain-not-reused'], dependsOn: [] },
  A15: { modes: ['microvm'], assertions: ['trusted-checks-immutable', 'spoofed-output-fails', 'no-stdout-verification'], dependsOn: [] },
  A16: { modes: ['deployment', 'microvm', 'live-provider'], assertions: ['each-repair-reviewed', 'two-repairs-twelve-calls-cost-cap', 'last-passing-state'], dependsOn: ['A01'] },
  A17: { modes: ['native-postgres', 'deployment'], assertions: ['parallel-quota-race', 'deduplicated-ledger', 'ambiguous-charge-reserved'], dependsOn: [] },
  A18: { modes: ['deployment', 'microvm', 'restore', 'native-postgres'], assertions: ['expiry-delete-revoke-destroy', 'artifact-retention', 'restore-valid-objects', 'measured-rpo-rto'], dependsOn: [] },
  A19: { modes: ['browser', 'microvm', 'native-postgres'], assertions: ['actual-next-preview', 'all-themes-viewports', 'keyboard-crud-focus', 'zoom-200-reduced-motion', 'database-persistence'], dependsOn: ['A01'] },
  A20: { modes: ['deployment', 'load', 'microvm', 'native-postgres'], assertions: ['full-denominator-hardware-limits', 'steady-and-burst-load', 'staged-fault-campaign', 'measured-targets'], dependsOn: [] },
  A21: { modes: ['repository', 'browser'], assertions: ['npm-verify', 'local-brief-sample-export', 'loopback-restrictions'], dependsOn: [] },
  A22: { modes: ['live-provider', 'microvm', 'native-postgres'], assertions: ['frozen-corpus', 'quality-at-least-90-percent', 'cost-distribution', 'all-promoted-checks'], dependsOn: ['A01', 'A02'] },
}
export interface AcceptanceAssessment { id: string; status: AcceptanceStatus; evidenceIds: string[]; reasons: string[] }
export interface AcceptanceInput { evidenceIds: string[]; blockers: Partial<Record<string, string>>; sourceDigest: string; templateDigest: string; policyDigest: string }
/** Reporting only, never an authorization gate. Resolver must retrieve trusted,
 * authenticated collector evidence; never resolve client/model supplied records.
 * Fixture/unit/embedded records stay visible but cannot close live acceptance. */
export async function evaluateAcceptance(input: AcceptanceInput, resolveAuthenticatedEvidence: (id: string) => Promise<unknown | null>): Promise<AcceptanceAssessment[]> {
  [input.sourceDigest, input.templateDigest, input.policyDigest].forEach(d => digest.parse(d))
  if (input.evidenceIds.length > 10000 || new Set(input.evidenceIds).size !== input.evidenceIds.length) throw new Error('Invalid acceptance evidence inventory')
  const records: AcceptanceEvidence[] = []
  for (const id of input.evidenceIds) {
    const raw = await resolveAuthenticatedEvidence(id); if (raw === null) continue
    const record = evidenceSchema.parse(raw)
    if (record.id !== id) throw new Error('Evidence identity mismatch')
    // A22 is a release campaign over distinct generated snapshots. Every run
    // retains its own source digest; only template and policy are shared.
    if ((record.scenario === 'A22' || record.sourceDigest === input.sourceDigest) && record.templateDigest === input.templateDigest && record.policyDigest === input.policyDigest) records.push(record)
  }
  const rows = acceptanceIds.map(id => {
    const requirement = acceptanceRequirements[id]
    const all = records.filter(r => r.scenario === id)
    const real = all.filter(r => !r.modes.some(m => ['fixture', 'unit', 'embedded-postgres'].includes(m)))
    const coverage = new Set(real.filter(r => r.result === 'passed').flatMap(r => r.assertions))
    const presentModes = new Set(real.filter(r => r.result === 'passed').flatMap(r => r.modes))
    const reasons = [...requirement.modes.filter(m => !presentModes.has(m)).map(m => `Missing ${m} evidence`), ...requirement.assertions.filter(a => !coverage.has(a)).map(a => `Missing assertion: ${a}`)]
    if (id === 'A22') {
      const live = real.filter(r => r.modes.includes('live-provider'))
      if (live.some(r => r.result === 'passed' && !['microvm', 'native-postgres'].every(mode => r.modes.includes(mode as EvidenceMode)))) reasons.push('Successful benchmark run lacks real execution/database evidence')
      if (new Set(live.map(r => r.runId)).size !== live.length) reasons.push('Duplicate benchmark run evidence')
      if (live.length && live.filter(r => r.result === 'passed').length / live.length < 0.9) reasons.push('Live benchmark success rate below 90 percent')
      if (new Set(live.map(r => r.runId)).size < 30) reasons.push('Fewer than 30 distinct live-provider runs')
      if (!['task-board', 'pomodoro'].every(v => live.some(r => r.benchmarkVariant === v))) reasons.push('Reference variants incomplete')
    }
    if (all.length && !real.length) reasons.push('Only fixture/unit/embedded evidence; not live acceptance')
    if (input.blockers[id]) reasons.push(input.blockers[id]!)
    const hasFailure = id === 'A22' ? reasons.includes('Live benchmark success rate below 90 percent') : all.some(r => r.result === 'failed')
    const status: AcceptanceStatus = hasFailure ? 'failed' : input.blockers[id] ? 'blocked' : reasons.length ? 'not-run' : 'passed'
    return { id, status, evidenceIds: all.map(r => r.id), reasons }
  })
  for (const row of rows) for (const dependency of acceptanceRequirements[row.id].dependsOn) {
    if (rows.find(r => r.id === dependency)?.status !== 'passed' && row.status === 'passed') { row.status = 'blocked'; row.reasons.push(`Prerequisite ${dependency} has not passed`) }
  }
  return rows
}
export function milestoneReadiness(rows: AcceptanceAssessment[], decisions: Record<string, boolean>, prerequisites: { e1: boolean; e2: boolean; e3: boolean }): { e4: boolean; e5: boolean } {
  const passed = (id: string) => rows.filter(r => r.id === id).length === 1 && rows.find(r => r.id === id)?.status === 'passed'
  const e4 = prerequisites.e1 && prerequisites.e2 && prerequisites.e3 && acceptanceIds.filter(id => !['A20', 'A22'].includes(id)).every(passed)
  return { e4, e5: e4 && passed('A20') && passed('A22') && Array.from({ length: 8 }, (_, i) => `D${i + 1}`).every(id => decisions[id] === true) }
}
