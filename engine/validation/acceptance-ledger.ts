import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { sha256 } from '../contracts/canonical.ts'
import { digest, timestamp } from '../contracts/primitives.ts'
import { acceptanceIds, acceptanceRequirements } from './acceptance.ts'

const decisionIds = Array.from({ length: 8 }, (_, i) => `D${i + 1}`)
export const acceptanceDecisionDependencies: Record<string, readonly string[]> = {
  A01: ["D1", "D2", "D3", "D4", "D5", "D7"],
  A02: ["D1", "D2", "D3", "D4", "D5", "D7"],
  A03: ["D1", "D2", "D5", "D7"],
  A04: ["D2", "D5", "D7"],
  A05: ["D1", "D2", "D5", "D7"],
  A06: ["D1", "D5", "D6"],
  A07: ["D1", "D5"],
  A08: ["D2", "D3", "D4", "D5", "D7"],
  A09: ["D2", "D5", "D7"],
  A10: ["D2", "D5", "D6", "D7"],
  A11: ["D3", "D4"],
  A12: ["D2", "D7"],
  A13: ["D2", "D7"],
  A14: ["D1", "D5", "D6"],
  A15: ["D2", "D7"],
  A16: ["D1", "D2", "D3", "D4", "D5", "D7"],
  A17: ["D4", "D5"],
  A18: ["D2", "D5", "D6", "D8"],
  A19: ["D2", "D6", "D7"],
  A20: ["D1", "D2", "D4", "D5", "D6", "D7", "D8"],
  A21: [],
  A22: ["D2", "D3", "D4", "D7"],
}
const evidencePath = z.string().max(300).regex(/^(?:docs\/reports\/evidence\/|runner\/evidence\/|tests\/harness\/evidence\/)[A-Za-z0-9_./-]+$/)
  .refine(path => path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'), 'Invalid evidence path')
const digests = z.strictObject({ source: digest.nullable(), template: digest.nullable(), policy: digest.nullable() })
const supportSchema = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/),
  status: z.enum(['passed', 'failed', 'blocked', 'not-run']),
  provenance: z.enum(['unit-fixture', 'native-postgres-synthetic', 'platform-scaffold-browser', 'platform-scaffold-build', 'candidate-dependency-audit', 'prior-repository-verification', 'repository-verification', 'existing-forge-browser']),
  artifactPath: evidencePath.nullable(), artifactSha256: digest.nullable(), environment: z.string().min(1).max(2000),
  description: z.string().min(1).max(3000), digests,
  testCounts: z.strictObject({ total: z.number().int().min(1), passed: z.number().int().min(0), failed: z.number().int().min(0), skipped: z.number().int().min(0) }).nullable(),
  current: z.boolean().optional(),
  acceptanceChecks: z.array(z.enum(['npm-verify', 'local-brief', 'sample', 'export', 'loopback-constraints', 'e1-fixture-suite'])).max(6).optional(),
  supersedesEvidenceIds: z.array(z.string()).max(30).optional(),
  scope: z.array(z.string().min(1).max(300)).min(1).max(100),
})
const rowSchema = z.strictObject({ id: z.string().regex(/^A(?:0[1-9]|1[0-9]|2[0-2])$/), scenario: z.string().min(1).max(200),
  releaseStatus: z.enum(['passed', 'failed', 'blocked', 'not-run']),
  prerequisites: z.array(z.string().regex(/^A(?:0[1-9]|1[0-9]|2[0-2])$/)),
  blockingDecisions: z.array(z.string().regex(/^D[1-8]$/)), blockers: z.array(z.string().min(1).max(1000)).max(20),
  supportingEvidenceIds: z.array(z.string()).max(30), supportSummary: z.string().min(1).max(2000), releaseEvidenceIds: z.array(z.string()).max(30),
  releaseDigests: digests, missingAssertions: z.array(z.string()).max(30),
})
export const acceptanceLedgerSchema = z.strictObject({ schemaVersion: z.literal(1),
  purpose: z.literal('implementation-checkpoint-not-release-attestation'), recordedAt: timestamp,
  rfc: z.literal('docs/rfcs/0001-app-generation-vertical-slice.md'),
  decisions: z.array(z.strictObject({ id: z.string().regex(/^D[1-8]$/), status: z.literal('OPEN'), closureEvidence: z.null() })).length(8),
  milestones: z.strictObject({ E1: z.enum(['in-progress', 'fixture-verified']), E2: z.literal('blocked'), E3: z.literal('blocked'), E4: z.literal('blocked'), E5: z.literal('blocked') }),
  milestoneEvidenceIds: z.strictObject({ E1: z.array(z.string()).min(1).max(30) }).optional(),
  limitations: z.array(z.string().min(1).max(2000)).min(1).max(30), support: z.array(supportSchema).max(100), rows: z.array(rowSchema).length(22),
})
export type AcceptanceLedger = z.infer<typeof acceptanceLedgerSchema>
const sameSet = (actual: readonly string[], expected: readonly string[]) => actual.length === new Set(actual).size && actual.length === expected.length && expected.every(id => actual.includes(id))
/** A checkpoint, not an attestation format. This module deliberately cannot
 * establish a passed live-engine release row, even from JSON claiming 'real'.
 * A21 existing-Forge compatibility can pass from explicit current repository
 * and browser evidence. E1 fixture-verified never asserts live authentication.
 * Future live evidence must flow through authenticated acceptance collectors. */
export function validateAcceptanceLedger(input: unknown): AcceptanceLedger {
  const ledger = acceptanceLedgerSchema.parse(input)
  if (!sameSet(ledger.decisions.map(d => d.id), decisionIds) || !sameSet(ledger.rows.map(r => r.id), acceptanceIds)) throw new Error('Incomplete or duplicate acceptance matrix')
  const support = new Map(ledger.support.map(e => [e.id, e]))
  if (support.size !== ledger.support.length) throw new Error('Duplicate supporting evidence')
  for (const item of ledger.support) {
    if ((item.artifactPath === null) !== (item.artifactSha256 === null)) throw new Error('Partial artifact reference')
    if (['passed', 'failed'].includes(item.status) && !item.artifactPath) throw new Error('Measured support requires a real artifact reference')
    if (item.testCounts) {
      const count = item.testCounts
      if (count.passed + count.failed + count.skipped !== count.total || item.status === 'passed' && count.failed > 0 || item.status === 'failed' && count.failed === 0) throw new Error('Contradictory supporting test result')
      if (!['unit-fixture', 'native-postgres-synthetic', 'repository-verification'].includes(item.provenance)) throw new Error('Invalid test result provenance')
    }
  }
  for (const item of ledger.support) {
    if (item.acceptanceChecks && new Set(item.acceptanceChecks).size !== item.acceptanceChecks.length) throw new Error('Duplicate support check')
    if (item.supersedesEvidenceIds && (new Set(item.supersedesEvidenceIds).size !== item.supersedesEvidenceIds.length || item.supersedesEvidenceIds.some(id => id === item.id || !support.has(id)))) throw new Error('Invalid superseded evidence reference')
  }
  const e1Evidence = ledger.milestoneEvidenceIds?.E1 ?? []
  if (new Set(e1Evidence).size !== e1Evidence.length || e1Evidence.some(id => !support.has(id))) throw new Error('Invalid E1 supporting evidence')
  if (ledger.milestones.E1 === 'fixture-verified' && !e1Evidence.some(id => {
    const item = support.get(id)!
    return item.current === true && item.status === 'passed' && item.provenance === 'native-postgres-synthetic' && item.acceptanceChecks?.includes('e1-fixture-suite')
      && item.scope.includes('tests/engine/control.native.test.ts') && item.testCounts !== null && item.testCounts.failed === 0 && item.testCounts.passed > 0
  })) throw new Error('E1 fixture verification requires current native synthetic suite evidence')
  for (const row of ledger.rows) {
    const requirements = acceptanceRequirements[row.id]
    if (!sameSet(row.prerequisites, requirements.dependsOn) || !sameSet(row.missingAssertions, row.id === 'A21' && row.releaseStatus === 'passed' ? [] : requirements.assertions)) throw new Error('Changed or concealed acceptance prerequisites/assertions')
    if (row.releaseStatus === 'passed' && row.id !== 'A21' || row.releaseEvidenceIds.length) throw new Error('Checkpoint support cannot establish live release acceptance')
    if (Object.values(row.releaseDigests).some(value => value !== null)) throw new Error('Unavailable release digests must remain null')
    if (row.releaseStatus === 'blocked' && !row.blockers.length || row.blockingDecisions.length && row.releaseStatus !== 'blocked') throw new Error('Unrecorded or concealed blocker')
    if (!sameSet(row.blockingDecisions, acceptanceDecisionDependencies[row.id])) throw new Error('Invalid decision dependency')
    if (row.supportingEvidenceIds.length !== new Set(row.supportingEvidenceIds).size || row.supportingEvidenceIds.some(id => !support.has(id))) throw new Error('Invalid supporting evidence reference')
    if (row.id === 'A21' && row.releaseStatus === 'passed') {
      if (row.blockers.length) throw new Error('Passed A21 still has blockers')
      const selected = row.supportingEvidenceIds.map(id => support.get(id)!)
      const current = selected.filter(item => item.current === true)
      if (current.some(item => item.status !== 'passed')) throw new Error('Current failed or incomplete evidence blocks A21')
      const repository = current.filter(item => item.status === 'passed' && item.provenance === 'repository-verification')
      const browser = current.filter(item => item.status === 'passed' && item.provenance === 'existing-forge-browser')
      if (!repository.some(item => item.acceptanceChecks?.includes('npm-verify') && item.acceptanceChecks.includes('loopback-constraints'))
        || !browser.some(item => ['local-brief', 'sample', 'export'].every(check => item.acceptanceChecks?.some(value => value === check)))) throw new Error('A21 requires current repository and existing-Forge browser coverage')
      const historicalFailures = ledger.support.filter(item => item.status === 'failed' && item.provenance === 'repository-verification')
      if (historicalFailures.some(item => item.current === true || repository.some(success => success.artifactSha256 === item.artifactSha256 || success.artifactPath === item.artifactPath) || !repository.some(success => success.supersedesEvidenceIds?.includes(item.id)))) throw new Error('Historical failure needs explicit successful supersession')
    }
    if (row.releaseStatus === 'failed' && !row.supportingEvidenceIds.some(id => support.get(id)?.status === 'failed')) throw new Error('Failed acceptance requires failed evidence')
    if (row.prerequisites.some(id => ledger.rows.find(prior => prior.id === id)?.releaseStatus !== 'passed') && row.releaseStatus !== 'blocked') throw new Error('Unmet prerequisite must block dependent acceptance')
  }
  return ledger
}
/** Hash verification proves local evidence bytes match this ledger, not that a
 * provider/runner claim inside them is authenticated. It grants no authority. */
export async function verifyLedgerArtifacts(ledgerInput: unknown, evidenceRoot: string): Promise<number> {
  const ledger = validateAcceptanceLedger(ledgerInput)
  let verified = 0
  for (const item of ledger.support) {
    if (!item.artifactPath) continue
    const path = resolve(evidenceRoot, item.artifactPath)
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size > 20 * 1024 * 1024) throw new Error('Evidence artifact unavailable or oversized')
    const bytes = await readFile(path)
    if (bytes.length > 20 * 1024 * 1024 || sha256(bytes) !== item.artifactSha256) throw new Error(`Evidence artifact hash mismatch: ${item.id}`)
    if (item.provenance === 'repository-verification' && item.current === true && item.status === 'passed' && item.acceptanceChecks?.includes('npm-verify')) {
      const log = bytes.toString('utf8')
      if (!['verify', 'lint', 'typecheck', 'test', 'build'].every(stage => new RegExp(`> forge-ai@[^\\r\\n]+ ${stage}\\r?\\n`).test(log))
        || /\b[1-9][0-9]* failed\b|^\s*FAIL\b/m.test(log) || !/\bTests\s+[^\r\n]*\bpassed\b/.test(log) || !/built in [^\r\n]+/.test(log)) throw new Error('Current repository artifact does not show successful complete npm verify')
    }
    if (item.provenance === 'existing-forge-browser' && item.current === true && item.status === 'passed') {
      const report = z.object({ origin: z.literal('existing-forge-browser'), checks: z.array(z.object({ name: z.string(), status: z.literal('passed') })) }).parse(JSON.parse(bytes.toString('utf8')))
      const names = report.checks.map(check => check.name)
      if (!names.includes('local brief creation') || !names.includes('sample walkthrough') || !names.includes('design package export') || !names.includes('brief export')) throw new Error('Existing-Forge browser artifact misses compatibility coverage')
    }
    if (item.testCounts) {
      const raw = z.object({ numTotalTests: z.number(), numPassedTests: z.number(), numFailedTests: z.number(), numPendingTests: z.number(), success: z.boolean() }).parse(JSON.parse(bytes.toString('utf8')))
      if (item.current === true && item.acceptanceChecks?.includes('e1-fixture-suite')) {
        const result = z.object({ testResults: z.array(z.object({ name: z.string(), assertionResults: z.array(z.object({ status: z.string() })) })) }).parse(JSON.parse(bytes.toString('utf8')))
        const native = result.testResults.find(suite => suite.name.endsWith('/tests/engine/control.native.test.ts'))
        if (!native?.assertionResults.length || native.assertionResults.some(test => test.status !== 'passed')) throw new Error('E1 native fixture artifact lacks passing control suite')
      }
      if (raw.numTotalTests !== item.testCounts.total || raw.numPassedTests !== item.testCounts.passed || raw.numFailedTests !== item.testCounts.failed || raw.numPendingTests !== item.testCounts.skipped || item.status === 'passed' && !raw.success) throw new Error('Evidence test counts/status mismatch')
    }
    verified++
  }
  return verified
}
export function summarizeAcceptanceLedger(input: unknown) {
  const ledger = validateAcceptanceLedger(input)
  const statuses = ['passed', 'failed', 'blocked', 'not-run'] as const
  return { schemaVersion: 1, purpose: ledger.purpose, recordedAt: ledger.recordedAt, releaseReady: false,
    release: Object.fromEntries(statuses.map(status => [status, ledger.rows.filter(row => row.releaseStatus === status).length])),
    support: Object.fromEntries(statuses.map(status => [status, ledger.support.filter(item => item.status === status).length])),
    openDecisions: ledger.decisions.map(d => d.id), milestones: ledger.milestones }
}

// Node24+ strip-types CLI; no dependency install, migration, provider or runner call.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , ledgerPath, evidenceRoot = process.cwd(), ...extra] = process.argv
    if (!ledgerPath || extra.length) throw new Error('Usage: node --experimental-strip-types engine/validation/acceptance-ledger.ts <ledger.json> [evidence-root]')
    const raw = await readFile(resolve(ledgerPath))
    if (raw.length > 1024 * 1024) throw new Error('Ledger byte cap')
    const ledger = validateAcceptanceLedger(JSON.parse(raw.toString('utf8')))
    const verifiedArtifacts = await verifyLedgerArtifacts(ledger, evidenceRoot)
    process.stdout.write(JSON.stringify({ ...summarizeAcceptanceLedger(ledger), verifiedArtifacts }, null, 2) + '\n')
  } catch (error) {
    process.stderr.write(`Acceptance ledger validation failed: ${error instanceof Error ? error.message : 'invalid input'}\n`)
    process.exitCode = 1
  }
}
