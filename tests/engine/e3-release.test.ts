import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateTemplateRelease, protectedTemplatePaths } from '../../templates/next-postgres-v1/release.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { checkIds } from '../../engine/contracts/primitives.ts'
import { hash, now } from './fixtures.ts'

// All report payloads below are fabricated unit inputs, never release evidence.
const evidenceKeys = ['offlineMaterializationDigest', 'dependencyLicenseReviewDigest', 'isolationSuiteDigest', 'cleanExportDigest', 'referenceBenchmarkDigest'] as const
async function fixture(overrides: Record<string, unknown> = {}, revoked = false, expectedCorpus = hash, unprotect = false) {
  const lockfile = await readFile(new URL('../../templates/next-postgres-v1/package-lock.json', import.meta.url), 'utf8')
  const manifest = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
    stack: 'nextjs-strict-typescript-postgresql', releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' },
    lockfileDigest: sha256(lockfile), commandPolicyDigest: hash, requiredChecks: [...checkIds], protectedPaths: unprotect ? ['package.json'] : [...protectedTemplatePaths] }
  const objects = new Map<string, Uint8Array>()
  const evidence: Record<string, string> = { approvedBy: 'synthetic-test-operator', approvedAt: now }
  for (const key of evidenceKeys) {
    const report = { schemaVersion: 1, status: 'passed', origin: 'real', check: key, templateDigest: hash,
      imageDigest: `sha256:${hash}`, lockfileDigest: manifest.lockfileDigest, commandPolicyDigest: hash,
      issuedAt: now, expiresAt: new Date(Date.parse(now) + 3600000).toISOString(), corpusDigest: hash,
      sampleCount: 30, successCount: 30, ...overrides }
    const bytes = Buffer.from(JSON.stringify(report)); evidence[key] = sha256(bytes); objects.set(evidence[key], bytes)
  }
  return validateTemplateRelease(manifest, lockfile, evidence, async digest => ({ bytes: objects.get(digest)!, authenticated: true, revoked }), expectedCorpus, Date.parse(now))
}
describe('E3 release evidence schema with synthetic report payloads only', () => {
  it('accepts exact subject/freshness/corpus through explicitly trusted test store', async () => {
    expect(await fixture()).toHaveProperty('evidenceDigest')
  })
  it.each([
    { origin: 'fixture' }, { status: 'failed' }, { templateDigest: 'b'.repeat(64) },
    { imageDigest: `sha256:${'b'.repeat(64)}` }, { lockfileDigest: 'b'.repeat(64) },
    { commandPolicyDigest: 'b'.repeat(64) }, { check: 'other-check' },
    { expiresAt: now }, { issuedAt: '2026-09-01T12:00:00.000Z' },
    { issuedAt: '2026-09-10T12:00:00.000Z' }, { sampleCount: 29, successCount: 29 },
    { sampleCount: 30, successCount: 26 }, { sampleCount: 30, successCount: 31 },
  ])('rejects mismatched report %j', async overrides => { await expect(fixture(overrides)).rejects.toThrow() })
  it('rejects release manifests without the protected test/build/bootstrap files', async () => {
    await expect(fixture({}, false, hash, true)).rejects.toThrow('release configuration')
  })
  it('rejects revoked evidence and a different expected frozen corpus', async () => {
    await expect(fixture({}, true)).rejects.toThrow('revoked')
    await expect(fixture({}, false, 'b'.repeat(64))).rejects.toThrow('benchmark')
  })
})
