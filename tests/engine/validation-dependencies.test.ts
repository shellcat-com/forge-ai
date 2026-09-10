import { expect, it } from 'vitest'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { validatePinnedDependencies } from '../../engine/validation/dependencies.ts'
import type { DependencyPolicy } from '../../engine/validation/dependencies.ts'
const pkg = JSON.stringify({ dependencies: { next: '1.2.3' } })
const integrity = `sha512-${'a'.repeat(86)}==`
const packageEntry = { version: '1.2.3', resolved: 'https://registry.npmjs.org/next/-/next-1.2.3.tgz', integrity, license: 'MIT' }
const lockObject = { lockfileVersion: 3, packages: { '': { dependencies: { next: '1.2.3' } }, 'node_modules/next': packageEntry } }
const lock = JSON.stringify(lockObject)
const now = '2026-09-09T12:00:00Z'
const policy: DependencyPolicy = { schemaVersion: 1, packageDigest: sha256(pkg), lockfileDigest: sha256(lock),
  packages: [{ path: 'node_modules/next', version: '1.2.3', integrity, license: 'MIT', installScriptReviewed: false }],
  allowedLicenses: ['MIT'], registryOrigin: 'https://registry.npmjs.org', advisoryReportDigest: sha256('synthetic advisory'),
  reviewedAt: '2026-09-09T00:00:00Z', expiresAt: '2026-09-10T00:00:00Z', revoked: false }
it('validates exact package and lock bytes against reviewed dependency policy (synthetic metadata)', () => {
  expect(validatePinnedDependencies(pkg, lock, policy, now).packageCount).toBe(1)
})
it('rejects drift, missing review, stale/revoked policy, floating versions, links and install hooks', () => {
  expect(() => validatePinnedDependencies(`${pkg} `, lock, policy, now)).toThrow()
  expect(() => validatePinnedDependencies(pkg, lock, { ...policy, revoked: true }, now)).toThrow()
  expect(() => validatePinnedDependencies(pkg, lock, policy, policy.expiresAt)).toThrow()
  for (const entry of [{ ...packageEntry, link: true }, { ...packageEntry, hasInstallScript: true }, { ...packageEntry, integrity: 'bad' }, { ...packageEntry, license: 'Unreviewed' }, { ...packageEntry, resolved: 'https://evil.example/next.tgz' }, { ...packageEntry, resolved: 'https://registry.npmjs.org/next.tgz?token=secret' }, { ...packageEntry, version: '^1.2.3' }]) {
    const changed = JSON.stringify({ ...lockObject, packages: { ...lockObject.packages, 'node_modules/next': entry } })
    expect(() => validatePinnedDependencies(pkg, changed, { ...policy, lockfileDigest: sha256(changed) }, now)).toThrow()
  }
  const floating = JSON.stringify({ dependencies: { next: '^1.2.3' } })
  expect(() => validatePinnedDependencies(floating, lock, { ...policy, packageDigest: sha256(floating) }, now)).toThrow()
})
