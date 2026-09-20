import { z } from 'zod'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { templateManifestSchema } from '../../engine/contracts/source.ts'
import { digest } from '../../engine/contracts/primitives.ts'

export const candidateToolchain = { next: '16.3.4', node: '24.20.0', postgres: '18.6' } as const
export const protectedTemplatePaths = ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs',
  'next-env.d.ts', 'eslint.config.mjs', 'vitest.config.mjs', 'platform/environment.ts', 'platform/environment.test.ts',
  'platform/reference-migrate.mjs', 'app-database.sql', 'postgresql.conf', 'pg_hba.conf', 'lib/database.ts',
  'reference/migrations/0001_tasks.sql', 'reference/migrations/0002_priority.sql', 'reference/portfolio.json',
  'README.md', '.env.example', '.gitignore'] as const
const releaseEvidence = z.strictObject({ offlineMaterializationDigest: digest, dependencyLicenseReviewDigest: digest,
  isolationSuiteDigest: digest, cleanExportDigest: digest, referenceBenchmarkDigest: digest,
  approvedBy: z.string().min(1), approvedAt: z.iso.datetime({ offset: true }) })
/** Candidate metadata can never be activated using placeholder digests. Actual
 * evidence bytes must be fetched by a scoped trusted store and hash-verified. */
export async function validateTemplateRelease(manifestInput: unknown, lockfile: string, evidenceInput: unknown,
  readEvidence: (digest: string) => Promise<{ bytes: Uint8Array; authenticated: true; revoked: boolean }>,
  expectedCorpusDigest: string, now = Date.now()) {
  digest.parse(expectedCorpusDigest)
  const manifest = templateManifestSchema.parse(manifestInput)
  const evidence = releaseEvidence.parse(evidenceInput)
  if (Object.entries(candidateToolchain).some(([name, version]) => manifest.releases[name as keyof typeof candidateToolchain] !== version)
    || protectedTemplatePaths.some(path => !manifest.protectedPaths.includes(path))) throw new Error('Unapproved template release configuration')
  if (Date.parse(evidence.approvedAt) > now || now - Date.parse(evidence.approvedAt) > 86400000) throw new Error('Stale release approval')
  if (manifest.lockfileDigest !== sha256(lockfile)) throw new Error('Template lockfile digest mismatch')
  const lock = JSON.parse(lockfile) as { lockfileVersion?: unknown; packages?: Record<string, { version?: string; resolved?: string; integrity?: string; link?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: { node?: string } }> }
  if (lock.lockfileVersion !== 3 || !lock.packages?.[''] || !lock.packages['node_modules/next']) throw new Error('Invalid template lockfile')
  if (lock.packages['node_modules/next'].version !== manifest.releases.next || lock.packages[''].engines?.node !== manifest.releases.node) throw new Error('Release version mismatch')
  const root = lock.packages['']
  for (const [name, version] of Object.entries({ ...root.dependencies, ...root.devDependencies }))
    if (!/^\d+\.\d+\.\d+$/.test(version) || lock.packages[`node_modules/${name}`]?.version !== version) throw new Error('Unpinned or mismatched direct dependency')
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (path === '') continue
    if (pkg.link || !pkg.version || !pkg.resolved?.startsWith('https://registry.npmjs.org/') || !/^sha512-[A-Za-z0-9+/=]+$/.test(pkg.integrity ?? '')) throw new Error('Unverified dependency entry')
  }
  for (const key of ['offlineMaterializationDigest', 'dependencyLicenseReviewDigest', 'isolationSuiteDigest', 'cleanExportDigest', 'referenceBenchmarkDigest'] as const) {
    const fetched = await readEvidence(evidence[key])
    if (fetched.authenticated !== true || fetched.revoked) throw new Error('Unauthenticated or revoked release evidence')
    const bytes = fetched.bytes
    if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024 || sha256(bytes) !== evidence[key]) throw new Error('Unavailable release evidence')
    const report = z.strictObject({ schemaVersion: z.literal(1), status: z.literal('passed'), origin: z.literal('real'),
      check: z.literal(key), templateDigest: digest, imageDigest: z.string(), lockfileDigest: digest, commandPolicyDigest: digest,
      issuedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }), corpusDigest: digest.nullable(),
      sampleCount: z.number().int().min(0).max(1000000), successCount: z.number().int().min(0).max(1000000),
    }).parse(JSON.parse(new TextDecoder().decode(bytes)))
    if (report.templateDigest !== manifest.template.digest || report.imageDigest !== manifest.template.imageDigest
      || report.lockfileDigest !== manifest.lockfileDigest || report.commandPolicyDigest !== manifest.commandPolicyDigest
      || Date.parse(report.issuedAt) > now || Date.parse(report.expiresAt) <= now
      || now - Date.parse(report.issuedAt) > 86400000 || report.successCount > report.sampleCount) throw new Error('Stale or mismatched release evidence')
    if (key === 'referenceBenchmarkDigest' && (report.corpusDigest !== expectedCorpusDigest || report.sampleCount < 30
      || report.successCount / report.sampleCount < 0.9)) throw new Error('Insufficient live benchmark evidence')
  }
  return { manifest, evidenceDigest: canonicalHash(evidence) }
}
