import { z } from 'zod'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { assertUniquePaths, sourcePath } from '../contracts/paths.ts'
import { digest, limits } from '../contracts/primitives.ts'

export interface ScanFile { path: string; bytes: Uint8Array }
export interface SourceScanPolicy {
  policyDigest: string
  /** Server-known credentials/canaries only. Never return these in diagnostics. */
  forbiddenValues: readonly string[]
  /** Exact reviewed placeholder example, never a general secret-scan exemption.
   * Only suppresses generic assignment/URL patterns, never canary/key detection. */
  placeholderExampleDigest?: string
}
export class SecretScanError extends Error {
  readonly code = 'SOURCE_SECRET_POLICY_REJECTED'
  constructor() { super('Source rejected by secret policy'); this.name = 'SecretScanError' }
}
function reject(): never { throw new SecretScanError() }
export function normalizeUntrustedText(text: string): string {
  return text.replace(/\\+u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\+x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    // eslint-disable-next-line no-control-regex -- Strip controls before scanning, never after.
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\ufeff]/g, '')
}
function secretRepresentations(secrets: readonly string[]): string[] {
  if (secrets.length > 100 || secrets.some(s => typeof s !== 'string' || s.length < 8 || s.length > 4096)) reject()
  return [...new Set(secrets.flatMap(value => [value, encodeURIComponent(value), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url'),
    [...value].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')]))].sort((a, b) => b.length - a.length)
}
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
]
const sensitiveAssignment = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key|authorization)\s*["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi
const credentialUrl = /\b(?:postgres(?:ql)?|https?|redis|mysql):\/\/[^\s/@:"']+:[^\s/@"']+@/gi
/** Bounded heuristic rejection plus exact known-secret/canary checks. This is
 * not a proof that code contains no unknown or deliberately obfuscated secret.
 * Always pair with external secret scanning and immutable template review. */
export function scanSourceSecrets(files: readonly ScanFile[], manifestDigest: string, policy: SourceScanPolicy): { manifestDigest: string; policyDigest: string; filesDigest: string; fileCount: number } {
  digest.parse(manifestDigest); digest.parse(policy.policyDigest)
  if (policy.placeholderExampleDigest) digest.parse(policy.placeholderExampleDigest)
  const representations = secretRepresentations(policy.forbiddenValues)
  if (!files.length || files.length > limits.files) reject()
  let total = 0
  try { assertUniquePaths(files.map(f => sourcePath.parse(f.path))) } catch { reject() }
  const hashes: { path: string; sha256: string; bytes: number }[] = []
  for (const file of files) {
    if (!(file.bytes instanceof Uint8Array)) reject()
    total += file.bytes.byteLength
    if (file.bytes.byteLength > limits.assetBytes || total > limits.sourceBytes) reject()
    if (/\.(?:zip|tar|tgz|gz|7z)$/i.test(file.path) || /^(?:logs|evidence|artifacts|coverage)\//i.test(file.path)) reject()
    const fileDigest = sha256(file.bytes)
    // UTF-8 normalization catches split-control canaries; Latin1 catches literal
    // byte canaries inside approved binary assets without interpreting formats.
    const texts = [normalizeUntrustedText(Buffer.from(file.bytes).toString('utf8')), Buffer.from(file.bytes).toString('latin1')]
    for (const text of texts) {
      if (representations.some(value => text.includes(value)) || credentialPatterns.some(pattern => pattern.test(text))) reject()
      const reviewedExample = file.path === '.env.example' && fileDigest === policy.placeholderExampleDigest
      if (!reviewedExample) {
        sensitiveAssignment.lastIndex = 0; credentialUrl.lastIndex = 0
        // Explicit symbolic values are documentation/test placeholders, never a
        // general allowlist for credentials. Known canaries were rejected above.
        if ([...text.matchAll(sensitiveAssignment)].some(match => !['REPLACE_ME', 'REPLACE_WITH_LOCAL_PASSWORD'].includes(match[1])) || credentialUrl.test(text)) reject()
      }
    }
    hashes.push({ path: file.path, sha256: fileDigest, bytes: file.bytes.byteLength })
  }
  return { manifestDigest, policyDigest: policy.policyDigest, filesDigest: canonicalHash(hashes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), fileCount: hashes.length }
}
/** Adapter for E2 prepareSourceExport(..., scan). Capture operator policy now,
 * so concurrent caller mutation cannot widen an in-flight scanner. */
export function sourceExportScanner(policyInput: SourceScanPolicy): (files: readonly ScanFile[], manifestDigest: string) => Promise<void> {
  const policy = structuredClone(policyInput)
  return async (files, manifestDigest) => { scanSourceSecrets(files, manifestDigest, policy) }
}
/** Event/log policy assertion for already bounded artifacts. The scanner never
 * sends raw matched content to logs or errors. Production telemetry should also
 * enforce a strict content-free event schema before invoking this assertion. */
export function assertNoKnownSecrets(value: string, forbiddenValues: readonly string[], capBytes = 10 * 1024 * 1024): void {
  if (!Number.isSafeInteger(capBytes) || capBytes < 1 || capBytes > 10 * 1024 * 1024 || Buffer.byteLength(value) > capBytes) reject()
  const text = normalizeUntrustedText(value)
  if (secretRepresentations(forbiddenValues).some(secret => text.includes(secret))) reject()
}
export const sourceScanEvidenceSchema = z.strictObject({ manifestDigest: digest, policyDigest: digest, filesDigest: digest, fileCount: z.number().int().min(1).max(limits.files) })
