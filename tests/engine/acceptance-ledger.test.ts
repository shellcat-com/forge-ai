import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { acceptanceRequirements } from '../../engine/validation/acceptance.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { validateAcceptanceLedger, verifyLedgerArtifacts, summarizeAcceptanceLedger } from '../../engine/validation/acceptance-ledger.ts'

const checkpoint = JSON.parse(await readFile(new URL('../../docs/reports/evidence/e2-e5/acceptance.json', import.meta.url), 'utf8'))
// Keep negative-test fixtures stable when the coordinator legitimately updates
// the repository checkpoint to current E1/A21 support. This synthetic reset is
// only test input; it is never written back to the evidence ledger.
const baselineIds = ['integrated-unit-support', 'native-synthetic-migrations', 'candidate-browser', 'candidate-node24', 'candidate-advisory-snapshot', 'prior-worker-verify', 'combined-verify-e1-audit-failure', 'existing-forge-browser']
const fresh = () => {
  const ledger = structuredClone(checkpoint)
  ledger.milestones.E1 = 'in-progress'; delete ledger.milestoneEvidenceIds
  ledger.support = ledger.support.filter((item: { id: string }) => baselineIds.includes(item.id))
  for (const item of ledger.support) { delete item.current; delete item.acceptanceChecks; delete item.supersedesEvidenceIds }
  for (const row of ledger.rows) {
    row.supportingEvidenceIds = row.supportingEvidenceIds.filter((id: string) => baselineIds.includes(id))
    if (row.id === 'A21') { row.releaseStatus = 'failed'; row.missingAssertions = [...acceptanceRequirements.A21.assertions]; row.blockers = ['Synthetic historical failure fixture']; row.supportingEvidenceIds = ['combined-verify-e1-audit-failure', 'prior-worker-verify', 'existing-forge-browser'] }
  }
  return validateAcceptanceLedger(ledger)
}
it('validates the recorded checkpoint without forcing its A21 state to remain failed', () => {
  expect(validateAcceptanceLedger(checkpoint).rows).toHaveLength(22)
  expect(summarizeAcceptanceLedger(checkpoint).releaseReady).toBe(false)
})
it('records all22 release scenarios separately from passed synthetic/scaffold support', () => {
  const ledger = fresh()
  expect(ledger.rows.map(row => row.id)).toHaveLength(22)
  expect(summarizeAcceptanceLedger(ledger)).toMatchObject({ releaseReady: false, release: { passed: 0, failed: 1, blocked: 21, 'not-run': 0 }, support: { passed: 7, failed: 1 } })
  expect(ledger.rows.find(row => row.id === 'A21')?.releaseStatus).toBe('failed')
  expect(ledger.decisions.every(d => d.status === 'OPEN' && d.closureEvidence === null)).toBe(true)
  expect(ledger.rows.every(r => Object.values(r.releaseDigests).every(value => value === null) && !r.releaseEvidenceIds.length)).toBe(true)
})
it('rejects fictitious live passes, release evidence, closed decisions and dependent milestone completion', () => {
  const ledger = fresh(); ledger.rows[0].releaseStatus = 'passed'
  expect(() => validateAcceptanceLedger(ledger)).toThrow('cannot establish live')
  const evidence = fresh(); evidence.rows[0].releaseEvidenceIds = ['integrated-unit-support']
  expect(() => validateAcceptanceLedger(evidence)).toThrow('cannot establish live')
  expect(() => validateAcceptanceLedger({ ...fresh(), decisions: fresh().decisions.map((d, i) => i ? d : { ...d, status: 'CLOSED' }) })).toThrow()
  expect(() => validateAcceptanceLedger({ ...fresh(), milestones: { ...fresh().milestones, E4: 'passed' } })).toThrow()
})
it('rejects fake digest placeholders and concealed dependencies/blockers/assertions', () => {
  const digest = fresh(); digest.rows[0].releaseDigests.source = '0'.repeat(64)
  expect(() => validateAcceptanceLedger(digest)).toThrow('must remain null')
  const prerequisites = fresh(); prerequisites.rows[1].prerequisites = []
  expect(() => validateAcceptanceLedger(prerequisites)).toThrow('prerequisites')
  const hidden = fresh(); hidden.rows[0].blockers = []
  expect(() => validateAcceptanceLedger(hidden)).toThrow('blocker')
  const assertions = fresh(); assertions.rows[0].missingAssertions.pop()
  expect(() => validateAcceptanceLedger(assertions)).toThrow('assertions')
  const dependent = fresh(); dependent.rows[1].blockingDecisions = []; dependent.rows[1].releaseStatus = 'not-run'
  expect(() => validateAcceptanceLedger(dependent)).toThrow('decision dependency')
})
it('rejects duplicate/missing rows, unowned support references and relabeled provenance', () => {
  const rows = fresh(); rows.rows[1] = structuredClone(rows.rows[0])
  expect(() => validateAcceptanceLedger(rows)).toThrow('duplicate')
  expect(() => validateAcceptanceLedger({ ...fresh(), rows: fresh().rows.slice(1) })).toThrow()
  const references = fresh(); references.rows[0].supportingEvidenceIds.push('nonexistent')
  expect(() => validateAcceptanceLedger(references)).toThrow('supporting evidence')
  const supports = fresh(); supports.support.push(structuredClone(supports.support[0]))
  expect(() => validateAcceptanceLedger(supports)).toThrow('Duplicate')
  expect(() => validateAcceptanceLedger({ ...fresh(), support: fresh().support.map((s, i) => i ? s : { ...s, provenance: 'live-provider' }) })).toThrow()
})
it('does not label missing artifacts or contradictory test totals as passed support', () => {
  const missing = fresh(); missing.support[0].artifactPath = null; missing.support[0].artifactSha256 = null
  expect(() => validateAcceptanceLedger(missing)).toThrow('real artifact')
  const counts = fresh(); counts.support[0].testCounts!.failed = 1
  expect(() => validateAcceptanceLedger(counts)).toThrow('Contradictory')
  const path = fresh(); path.support[0].artifactPath = 'docs/reports/evidence/../../outside.json'
  expect(() => validateAcceptanceLedger(path)).toThrow()
})
it('verifies actual artifact hashes/counts, fails stale evidence and never attests fixture JSON labels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-ledger-fixture-'))
  try {
    const relative = 'docs/reports/evidence/fixture.json'; const path = join(root, relative)
    await mkdir(join(root, 'docs/reports/evidence'), { recursive: true })
    const bytes = JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, success: true })
    await writeFile(path, bytes)
    const ledger = fresh()
    ledger.support = [{ ...ledger.support[0], id: 'fixture-artifact', artifactPath: relative, artifactSha256: sha256(bytes), testCounts: { total: 1, passed: 1, failed: 0, skipped: 0 } }]
    for (const row of ledger.rows) { row.supportingEvidenceIds = ['fixture-artifact']; if (row.id === 'A21') row.releaseStatus = 'not-run' }
    expect(await verifyLedgerArtifacts(ledger, root)).toBe(1)
    expect(summarizeAcceptanceLedger(ledger).releaseReady).toBe(false)
    await writeFile(path, bytes + '\n')
    await expect(verifyLedgerArtifacts(ledger, root)).rejects.toThrow('hash mismatch')
    ledger.support[0].artifactSha256 = sha256(bytes + '\n'); ledger.support[0].testCounts = { total: 2, passed: 2, failed: 0, skipped: 0 }
    await expect(verifyLedgerArtifacts(ledger, root)).rejects.toThrow('counts/status mismatch')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('requires actual failed supporting evidence for a failed checkpoint row', () => {
  const ledger = fresh(); ledger.rows.find(r => r.id === 'A21')!.supportingEvidenceIds = ['prior-worker-verify']
  expect(() => validateAcceptanceLedger(ledger)).toThrow('Failed acceptance requires failed evidence')
})

function compatibilityPass() {
  const ledger = fresh()
  const historical = ledger.support.find(item => item.id === 'combined-verify-e1-audit-failure')!
  historical.current = false
  ledger.support.push({ ...historical, id: 'current-verify', status: 'passed', current: true,
    artifactPath: 'docs/reports/evidence/current-verify.log', artifactSha256: sha256('new passing artifact'),
    acceptanceChecks: ['npm-verify', 'loopback-constraints'], supersedesEvidenceIds: [historical.id] })
  const browser = ledger.support.find(item => item.id === 'existing-forge-browser')!
  browser.current = true; browser.acceptanceChecks = ['local-brief', 'sample', 'export']
  const row = ledger.rows.find(item => item.id === 'A21')!
  row.releaseStatus = 'passed'; row.missingAssertions = []; row.blockers = []; row.supportingEvidenceIds = [historical.id, 'current-verify', browser.id]
  return ledger
}
it('allows A21 compatibility with complete current repository/browser support while preserving historical failure', () => {
  const ledger = compatibilityPass()
  expect(summarizeAcceptanceLedger(ledger)).toMatchObject({ releaseReady: false, release: { passed: 1, blocked: 21 } })
  expect(ledger.support.find(item => item.id === 'combined-verify-e1-audit-failure')?.status).toBe('failed')
  expect(ledger.decisions.every(item => item.status === 'OPEN')).toBe(true)
})
it('rejects A21 from unit/provider fake support, partial checks, historical success or unsuperseded failure', () => {
  const fixture = compatibilityPass(); fixture.support.find(item => item.id === 'current-verify')!.provenance = 'unit-fixture'
  expect(() => validateAcceptanceLedger(fixture)).toThrow('current repository')
  const provider = compatibilityPass(); const record = provider.support.find(item => item.id === 'current-verify')!
  expect(() => validateAcceptanceLedger({ ...provider, support: provider.support.map(item => item === record ? { ...item, provenance: 'live-provider' } : item) })).toThrow()
  const partial = compatibilityPass(); partial.support.find(item => item.id === 'existing-forge-browser')!.acceptanceChecks = ['local-brief', 'sample']
  expect(() => validateAcceptanceLedger(partial)).toThrow('coverage')
  const old = compatibilityPass(); old.support.find(item => item.id === 'current-verify')!.current = false
  expect(() => validateAcceptanceLedger(old)).toThrow('coverage')
  const failure = compatibilityPass(); failure.support.find(item => item.id === 'current-verify')!.supersedesEvidenceIds = []
  expect(() => validateAcceptanceLedger(failure)).toThrow('supersession')
  const same = compatibilityPass(); same.support.find(item => item.id === 'current-verify')!.artifactSha256 = same.support.find(item => item.status === 'failed')!.artifactSha256
  expect(() => validateAcceptanceLedger(same)).toThrow('supersession')
})
it('allows E1 fixture-verified only with explicit current native synthetic suite support', () => {
  const ledger = fresh(); ledger.milestones.E1 = 'fixture-verified'
  expect(() => validateAcceptanceLedger(ledger)).toThrow('E1 fixture verification')
  const native = ledger.support.find(item => item.id === 'native-synthetic-migrations')!
  ledger.milestoneEvidenceIds = { E1: [native.id] }; native.current = true; native.acceptanceChecks = ['e1-fixture-suite']; native.scope = ['tests/engine/control.native.test.ts']
  expect(validateAcceptanceLedger(ledger).milestones.E1).toBe('fixture-verified')
  expect(summarizeAcceptanceLedger(ledger).releaseReady).toBe(false)
  native.current = false
  expect(() => validateAcceptanceLedger(ledger)).toThrow('current native synthetic')
})
it('only allows empty missingAssertions for a supported A21 pass', () => {
  const ledger = fresh(); ledger.rows[0].missingAssertions = []
  expect(() => validateAcceptanceLedger(ledger)).toThrow('assertions')
  const failed = fresh(); failed.rows.find(row => row.id === 'A21')!.missingAssertions = []
  expect(() => validateAcceptanceLedger(failed)).toThrow('assertions')
})
it('rejects a hash-correct failed or incomplete log relabeled as current successful npm verify', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-compatibility-proof-'))
  try {
    const ledger = compatibilityPass()
    const selected = ledger.support.find(item => item.id === 'current-verify')!
    const bad = '> forge-ai@0.1.0 verify\n> forge-ai@0.1.0 test\n Tests 1 failed | 331 passed\n'
    selected.artifactSha256 = sha256(bad)
    // Other support records retain their ledger semantics; write inert matching
    // test artifacts and visit the current log first to isolate this assertion.
    ledger.support = [selected, ...ledger.support.filter(item => item !== selected)]
    await mkdir(join(root, 'docs/reports/evidence'), { recursive: true })
    await writeFile(join(root, selected.artifactPath!), bad)
    await expect(verifyLedgerArtifacts(ledger, root)).rejects.toThrow('successful complete npm verify')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('checks complete current npm verification and existing browser artifact contents for A21 support', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-valid-compatibility-proof-'))
  try {
    const ledger = compatibilityPass()
    const historical = ledger.support.find(item => item.id === 'combined-verify-e1-audit-failure')!
    const current = ledger.support.find(item => item.id === 'current-verify')!
    const browser = ledger.support.find(item => item.id === 'existing-forge-browser')!
    const passedLog = ['verify', 'lint', 'typecheck', 'test', 'build'].map(stage => `> forge-ai@0.1.0 ${stage}\n`).join('') + ' Tests 10 passed (10)\n✓ built in 500ms\n'
    const browserReport = JSON.stringify({ origin: 'existing-forge-browser', checks: ['local brief creation', 'sample walkthrough', 'design package export', 'brief export'].map(name => ({ name, status: 'passed' })) })
    ledger.support = [historical, current, browser]
    for (const row of ledger.rows) if (row.id !== 'A21') row.supportingEvidenceIds = [current.id]
    for (const [item, bytes] of [[historical, 'Historical failed run'], [current, passedLog], [browser, browserReport]] as const) {
      item.artifactSha256 = sha256(bytes)
      const file = join(root, item.artifactPath!); await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true }); await writeFile(file, bytes)
    }
    expect(await verifyLedgerArtifacts(ledger, root)).toBe(3)
    current.acceptanceChecks = ['npm-verify']
    expect(() => validateAcceptanceLedger(ledger)).toThrow('coverage')
  } finally { await rm(root, { recursive: true, force: true }) }
})
