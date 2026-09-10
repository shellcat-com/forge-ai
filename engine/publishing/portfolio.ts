import { z } from 'zod'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { assertUniquePaths, sourcePath } from '../contracts/paths.ts'
import { manifestSchema } from '../contracts/source.ts'
import { brokerDescriptorSchema, validatePassingVerification } from '../contracts/review.ts'
import { digest, uuid } from '../contracts/primitives.ts'
import { scanSourceSecrets } from '../validation/secrets.ts'

const fileSchema = z.strictObject({
  path: sourcePath,
  bytes: z
    .number()
    .int()
    .min(0)
    .max(5 * 1024 * 1024),
  sha256: digest,
})
export const publicTargetSchema = z.strictObject({
  teamId: z.string().regex(/^team_[A-Za-z0-9]+$/),
  projectId: z.string().regex(/^prj_[A-Za-z0-9]+$/),
  projectName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/),
})
export type PublicTarget = z.infer<typeof publicTargetSchema>
export interface StaticFile {
  path: string
  bytes: Uint8Array
}

/** Loaded only by a trusted control adapter after current owner authorization.
 * These fields are evidence references, not browser-submitted attestations.
 * No production adapter is registered while Task 01's live bridge is absent. */
export interface ApprovedPublication {
  publicationId: string
  revision: number
  target: PublicTarget
  sourceCommit: string
  snapshotId: string
  manifest: unknown
  descriptor: unknown
  verification: unknown
  files: unknown
  expiresAt: string
  approval: {
    candidateDigest: string
    buildOutputDigest: string
    targetDigest: string
    contentReviewDigest: string
    providerUsageEvidenceDigest: string
    profile: 'next-postgres-portfolio-static-v1'
    fixture: false
  }
  scannerPolicyDigest: string
}
export interface PublicationAuthority {
  loadApproved(publicationId: string, signal: AbortSignal): Promise<ApprovedPublication>
  /** Recheck permission, approval, current snapshot/policy and target after I/O. */
  revalidate(publicationId: string, revision: number, signal: AbortSignal): Promise<void>
  readBuildFile(publicationId: string, path: string, signal: AbortSignal): Promise<Uint8Array>
  /** Exact known canaries are supplied by trusted secret inventory, never exported. */
  forbiddenValues(): readonly string[]
}
export interface PreparedPublication {
  target: PublicTarget
  files: StaticFile[]
  receipt: {
    schemaVersion: 1
    kind: 'provider-portfolio'
    publicationId: string
    snapshotId: string
    sourceCommit: string
    jobId: string
    sourceManifestDigest: string
    templateDigest: string
    imageDigest: string
    policyDigest: string
    verificationDigest: string
    buildOutputDigest: string
    staticFilesDigest: string
    contentReviewDigest: string
    providerUsageEvidenceDigest: string
  }
}

/** Narrow static-only profile: never uploads source, functions, env, maps, logs,
 * deployment config or server output. Static JS remains untrusted browser code.
 * Unknown/obfuscated secrets still require independent source and browser review. */
export function validateStaticFiles(files: readonly StaticFile[], forbidden: readonly string[]) {
  if (!files.length || files.length > 200) throw new Error('Static file cap')
  assertUniquePaths(files.map((f) => f.path))
  if (!files.some((f) => f.path === 'index.html')) throw new Error('Missing static index')
  const metadata = files.map((f) => {
    sourcePath.parse(f.path)
    if (
      !/\.(?:html|css|js|png|jpg|jpeg|webp|ico|woff2?|txt)$/i.test(f.path) ||
      /(?:^|\/)(?:api|\.vercel|\.well-known|server|logs|evidence)(?:\/|$)/i.test(f.path) ||
      /(?:^|\/)(?:vercel|package|credentials)\./i.test(f.path) ||
      /(?:^|\/)(?:sw|service-worker)\.js$/i.test(f.path)
    )
      throw new Error('Forbidden public artifact')
    return { path: f.path, sha256: sha256(f.bytes), bytes: f.bytes.byteLength }
  })
  // Reuse bounded secret checks; static paths use the same path boundary.
  scanSourceSecrets(files, canonicalHash(metadata), {
    policyDigest: sha256('public-static-v1'),
    forbiddenValues: forbidden,
  })
  return metadata
}

export async function preparePortfolioPublication(
  publicationId: string,
  authority: PublicationAuthority,
  signal: AbortSignal,
  now = new Date()
): Promise<PreparedPublication> {
  uuid.parse(publicationId)
  signal.throwIfAborted()
  const approved = structuredClone(await authority.loadApproved(publicationId, signal))
  const manifest = manifestSchema.parse(approved.manifest)
  const descriptor = brokerDescriptorSchema.parse(approved.descriptor)
  const verification = validatePassingVerification(approved.verification, descriptor)
  const target = publicTargetSchema.parse(approved.target)
  const fileMetadata = z.array(fileSchema).min(1).max(200).parse(approved.files)
  const candidateDigest = canonicalHash(manifest)
  if (
    approved.publicationId !== publicationId ||
    !Number.isSafeInteger(approved.revision) ||
    approved.revision < 1 ||
    !/^[a-f0-9]{40}$/.test(approved.sourceCommit) ||
    !uuid.safeParse(approved.snapshotId).success ||
    !Number.isFinite(Date.parse(approved.expiresAt)) ||
    Date.parse(approved.expiresAt) <= now.getTime() ||
    Date.parse(approved.expiresAt) > now.getTime() + 86_400_000 ||
    manifest.provenance.origin !== 'provider' ||
    approved.approval.fixture !== false ||
    approved.approval.profile !== 'next-postgres-portfolio-static-v1' ||
    manifest.provenance.jobId !== descriptor.jobId ||
    candidateDigest !== descriptor.sourceManifestDigest ||
    manifest.template.digest !== descriptor.templateDigest ||
    manifest.template.imageDigest !== descriptor.imageDigest ||
    manifest.commandPolicyDigest !== descriptor.commandPolicyDigest ||
    approved.approval.candidateDigest !== candidateDigest ||
    approved.approval.buildOutputDigest !== verification.buildOutputDigest ||
    approved.approval.targetDigest !== canonicalHash(target) ||
    verification.checks.some(
      (check) =>
        Date.parse(check.finishedAt) > now.getTime() ||
        Date.parse(check.finishedAt) < now.getTime() - 86_400_000
    ) ||
    canonicalHash(fileMetadata) !== verification.buildOutputDigest
  )
    throw new Error('Publication binding rejected')
  digest.parse(approved.approval.contentReviewDigest)
  digest.parse(approved.approval.providerUsageEvidenceDigest)
  digest.parse(approved.scannerPolicyDigest)
  assertUniquePaths(fileMetadata.map((f) => f.path))
  const files: StaticFile[] = []
  let total = 0
  for (const metadata of fileMetadata) {
    signal.throwIfAborted()
    // Must be the entire collector output under this approved static profile.
    if (!metadata.path.startsWith('build/static/')) throw new Error('Unsupported build profile')
    total += metadata.bytes
    if (total > 10 * 1024 * 1024) throw new Error('Static byte cap')
    const bytes = (await authority.readBuildFile(publicationId, metadata.path, signal)).slice()
    if (bytes.length !== metadata.bytes || sha256(bytes) !== metadata.sha256)
      throw new Error('Build artifact integrity rejected')
    files.push({ path: metadata.path.slice('build/static/'.length), bytes })
  }
  const publicMetadata = validateStaticFiles(files, authority.forbiddenValues())
  signal.throwIfAborted()
  await authority.revalidate(publicationId, approved.revision, signal)
  signal.throwIfAborted()
  return {
    target,
    files,
    receipt: {
      schemaVersion: 1,
      kind: 'provider-portfolio',
      publicationId,
      snapshotId: approved.snapshotId,
      sourceCommit: approved.sourceCommit,
      jobId: manifest.provenance.jobId,
      sourceManifestDigest: candidateDigest,
      templateDigest: manifest.template.digest,
      imageDigest: manifest.template.imageDigest,
      policyDigest: manifest.commandPolicyDigest,
      verificationDigest: canonicalHash(verification),
      buildOutputDigest: verification.buildOutputDigest,
      staticFilesDigest: canonicalHash(publicMetadata),
      contentReviewDigest: approved.approval.contentReviewDigest,
      providerUsageEvidenceDigest: approved.approval.providerUsageEvidenceDigest,
    },
  }
}
