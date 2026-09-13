import { z } from 'zod'
import { sha256 } from '../contracts/canonical.ts'
import { digest } from '../contracts/primitives.ts'

const exactVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const entrySchema = z.strictObject({ path: z.string().regex(/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/),
  version: exactVersion, integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  license: z.string().min(1).max(100), installScriptReviewed: z.boolean() })
export const dependencyPolicySchema = z.strictObject({ schemaVersion: z.literal(1), packageDigest: digest, lockfileDigest: digest,
  packages: z.array(entrySchema).min(1).max(5000), allowedLicenses: z.array(z.string().min(1)).min(1),
  registryOrigin: z.literal('https://registry.npmjs.org'), advisoryReportDigest: digest,
  reviewedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }), revoked: z.boolean() })
export type DependencyPolicy = z.infer<typeof dependencyPolicySchema>

/** Requires an operator-authenticated immutable policy. Hash matches are not a
 * vulnerability scan, license approval, package download or D7 release closure. */
export function validatePinnedDependencies(packageJson: string, lockJson: string, policyInput: unknown, now: string): { packageDigest: string; lockfileDigest: string; packageCount: number; advisoryReportDigest: string } {
  const fail = (): never => { throw new Error('Dependency release policy rejected') }
  if (Buffer.byteLength(packageJson) > 256 * 1024 || Buffer.byteLength(lockJson) > 10 * 1024 * 1024) fail()
  const policy = dependencyPolicySchema.parse(policyInput)
  const clock = Date.parse(now)
  if (!Number.isFinite(clock) || policy.revoked || Date.parse(policy.reviewedAt) > clock || Date.parse(policy.expiresAt) <= clock || Date.parse(policy.expiresAt) <= Date.parse(policy.reviewedAt)) fail()
  if (sha256(packageJson) !== policy.packageDigest || sha256(lockJson) !== policy.lockfileDigest) fail()
  const pkg = z.object({ dependencies: z.record(z.string(), exactVersion), devDependencies: z.record(z.string(), exactVersion).optional() }).parse(JSON.parse(packageJson))
  const lock = z.object({ lockfileVersion: z.literal(3), packages: z.record(z.string(), z.record(z.string(), z.unknown())) }).parse(JSON.parse(lockJson))
  const root = lock.packages['']; if (!root) fail()
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const expected = pkg[section] ?? {}
    const actual = root[section] === undefined ? {} : z.record(z.string(), exactVersion).parse(root[section])
    if (Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([name, version]) => actual[name] !== version || lock.packages[`node_modules/${name}`]?.version !== version)) fail()
  }
  const byPath = new Map(policy.packages.map(p => [p.path, p]))
  if (byPath.size !== policy.packages.length || Object.keys(lock.packages).length !== byPath.size + 1) fail()
  for (const [path, raw] of Object.entries(lock.packages)) {
    if (path === '') continue
    const approved = byPath.get(path); if (!approved) fail()
    const p = approved!
    if (raw.version !== p.version || raw.integrity !== p.integrity || raw.license !== p.license || !policy.allowedLicenses.includes(p.license)
      || raw.link !== undefined || raw.bin !== undefined && typeof raw.bin !== 'object' || raw.hasInstallScript === true && !p.installScriptReviewed) fail()
    if (typeof raw.resolved !== 'string') fail()
    const url = new URL(raw.resolved as string)
    if (url.origin !== policy.registryOrigin || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.tgz')) fail()
  }
  return { packageDigest: policy.packageDigest, lockfileDigest: policy.lockfileDigest, packageCount: byPath.size, advisoryReportDigest: policy.advisoryReportDigest }
}
