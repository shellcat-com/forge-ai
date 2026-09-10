import { expect, it } from 'vitest'
import { acceptanceIds, acceptanceRequirements, evaluateAcceptance, milestoneReadiness } from '../../engine/validation/acceptance.ts'
import type { AcceptanceEvidence } from '../../engine/validation/acceptance.ts'
import { hash } from './fixtures.ts'
const input = { sourceDigest: hash, templateDigest: hash, policyDigest: hash, blockers: {}, evidenceIds: ['record'] }
const record: AcceptanceEvidence = { id: 'record', scenario: 'A01', result: 'passed', modes: acceptanceRequirements.A01.modes,
  assertions: acceptanceRequirements.A01.assertions, sourceDigest: hash, templateDigest: hash, policyDigest: hash,
  artifactDigest: hash, environment: 'Synthetic test of evaluator; this record is not real evidence', runId: 'one', benchmarkVariant: 'task-board' }
it('requires full authenticated evidence for the exact current source/template/policy', async () => {
  expect((await evaluateAcceptance(input, async () => null))[0].status).toBe('not-run')
  expect((await evaluateAcceptance(input, async () => ({ ...record, sourceDigest: 'f'.repeat(64) })))[0].status).toBe('not-run')
  expect((await evaluateAcceptance(input, async () => record))[0].status).toBe('passed')
  expect((await evaluateAcceptance(input, async () => ({ ...record, assertions: ['source-reviewed'] })))[0].status).toBe('not-run')
  await expect(evaluateAcceptance(input, async () => ({ ...record, id: 'different' }))).rejects.toThrow()
})
it('never promotes fixtures, embedded DB or unit evidence to live acceptance even with claimed live modes', async () => {
  for (const mode of ['fixture', 'unit', 'embedded-postgres']) {
    const rows = await evaluateAcceptance(input, async () => ({ ...record, modes: [...record.modes, mode] }))
    expect(rows[0].status).toBe('not-run')
    expect(rows[0].reasons.join(' ')).toContain('Only fixture/unit/embedded')
  }
})
it('does not hide failures, explicit blockers or prerequisite failures', async () => {
  expect((await evaluateAcceptance(input, async () => ({ ...record, result: 'failed' })))[0].status).toBe('failed')
  expect((await evaluateAcceptance({ ...input, blockers: { A01: 'D2 runtime unavailable' } }, async () => record))[0].status).toBe('blocked')
  const result = await evaluateAcceptance(input, async () => ({ ...record, scenario: 'A02', modes: acceptanceRequirements.A02.modes, assertions: acceptanceRequirements.A02.assertions }))
  expect(result.find(r => r.id === 'A02')?.status).toBe('blocked')
})
it('requires thirty distinct live runs and both frozen reference variants for A22', async () => {
  const evidenceIds = Array.from({ length: 30 }, (_, i) => `r${i}`)
  const rows = await evaluateAcceptance({ ...input, evidenceIds }, async id => ({ ...record, id, scenario: 'A22', modes: acceptanceRequirements.A22.modes, assertions: acceptanceRequirements.A22.assertions, runId: 'duplicate' }))
  const a22 = rows.find(r => r.id === 'A22')!
  expect(a22.status).toBe('not-run')
  expect(a22.reasons).toContain('Fewer than 30 distinct live-provider runs')
  expect(a22.reasons).toContain('Reference variants incomplete')
})
it('cannot close milestones without prerequisites and decisions, or with a missing/duplicate acceptance row', () => {
  const rows = acceptanceIds.map(id => ({ id, status: 'passed' as const, evidenceIds: ['synthetic'], reasons: [] }))
  const decisions = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`D${i + 1}`, true]))
  const prerequisites = { e1: true, e2: true, e3: true }
  expect(milestoneReadiness(rows, decisions, prerequisites)).toEqual({ e4: true, e5: true })
  expect(milestoneReadiness(rows, decisions, { ...prerequisites, e1: false })).toEqual({ e4: false, e5: false })
  expect(milestoneReadiness(rows, { ...decisions, D7: false }, prerequisites).e5).toBe(false)
  expect(milestoneReadiness([...rows, rows[0]], decisions, prerequisites).e4).toBe(false)
  expect(milestoneReadiness(rows.slice(1), decisions, prerequisites).e4).toBe(false)
})
it('counts every distinct benchmark attempt across source snapshots, with execution evidence for successful runs', async () => {
  const records: AcceptanceEvidence[] = ['A01', 'A02'].map((scenario, i) => ({ ...record, id: `prereq${i}`, scenario, modes: acceptanceRequirements[scenario].modes, assertions: acceptanceRequirements[scenario].assertions }))
  for (let i = 0; i < 30; i++) records.push({ ...record, id: `campaign${i}`, scenario: 'A22', runId: `distinct${i}`,
    sourceDigest: i.toString(16).padStart(64, '0'), result: i < 27 ? 'passed' : 'failed',
    modes: i < 27 ? ['live-provider', 'microvm', 'native-postgres'] : ['live-provider'],
    assertions: acceptanceRequirements.A22.assertions, benchmarkVariant: i % 2 ? 'pomodoro' : 'task-board' })
  const campaignInput = { ...input, evidenceIds: records.map(r => r.id) }
  const resolve = async (id: string) => records.find(r => r.id === id) ?? null
  expect((await evaluateAcceptance(campaignInput, resolve)).find(r => r.id === 'A22')?.status).toBe('passed')
  records[2].modes = ['live-provider']
  expect((await evaluateAcceptance(campaignInput, resolve)).find(r => r.id === 'A22')?.status).toBe('not-run')
  records[2].modes = ['live-provider', 'microvm', 'native-postgres']; records[2].result = 'failed'
  expect((await evaluateAcceptance(campaignInput, resolve)).find(r => r.id === 'A22')?.status).toBe('failed')
})
