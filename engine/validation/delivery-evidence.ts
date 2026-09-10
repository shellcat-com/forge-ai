import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { z } from 'zod'
import { sha256 } from '../contracts/canonical.ts'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const identitySchema = z.strictObject({
  controlCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceDigest: hash,
  templateDigest: hash.nullable(),
  policyDigest: hash.nullable(),
  runtimeDigest: hash.nullable(),
  deploymentDigest: hash.nullable(),
})
const recordSchema = z.strictObject({
  id: z.string().min(1).max(100),
  runId: z.string().min(1).max(100),
  identity: identitySchema,
  origin: z.enum(['fixture', 'repository', 'native-postgres-synthetic', 'platform-scaffold', 'live']),
  status: z.enum(['passed', 'failed', 'blocked', 'not-run']),
  scenario: z.string().regex(/^(A(0[1-9]|1[0-9]|2[0-2])|BYOK|PORTFOLIO|PACKAGING|NATIVE-CONTROLS)$/),
  artifactPath: z.string().regex(/^[a-zA-Z0-9_./-]+$/).refine(path =>
    !path.startsWith('/') && path.split('/').every(part => part !== '..' && part !== '.' && part !== '')),
  artifactDigest: hash,
  controls: z.strictObject({
    zoom: z.enum(['not-run', 'css-simulation', 'native-browser-200']),
    motion: z.enum(['not-run', 'media-emulation', 'native-setting']),
    anonymous: z.boolean(),
  }),
})
export const deliveryEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expected: identitySchema,
  records: z.array(recordSchema).max(10000),
}).superRefine((bundle, ctx) => {
  if (new Set(bundle.records.map(record => record.id)).size !== bundle.records.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate evidence identity' })
  const slots = bundle.records.map(record => `${record.scenario}:${record.runId}`)
  if (new Set(slots).size !== slots.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate scenario attempt' })
})

/** Offline reporting only. File hashes bind bytes, not producer authenticity.
 * Never use this result to authorize dispatch, promotion or release. A trusted
 * collector/attestation and the complete RFC evaluator remain required. */
export function assessDeliveryEvidence(input: unknown) {
  const bundle = deliveryEvidenceSchema.parse(input)
  const records = bundle.records.map(record => {
    const reasons: string[] = []
    for (const key of Object.keys(bundle.expected) as (keyof typeof bundle.expected)[])
      if (record.identity[key] !== bundle.expected[key]) reasons.push(`identity-mismatch:${key}`)
    if (record.origin === 'live' && ['templateDigest', 'policyDigest', 'runtimeDigest'].some(key =>
      record.identity[key as keyof typeof record.identity] === null))
      reasons.push('incomplete-live-identity')
    if (record.scenario === 'A19' || record.scenario === 'NATIVE-CONTROLS') {
      if (record.controls.zoom !== 'native-browser-200') reasons.push('native-zoom-not-observed')
      if (record.controls.motion !== 'native-setting') reasons.push('native-motion-not-observed')
    }
    if (record.scenario === 'PORTFOLIO' && !record.controls.anonymous)
      reasons.push('anonymous-visit-not-observed')
    if (record.scenario === 'PORTFOLIO' && record.identity.deploymentDigest === null)
      reasons.push('deployment-identity-missing')
    if (record.origin !== 'live') reasons.push('support-only')
    return { id: record.id, runId: record.runId, status: record.status, reasons,
      eligibleForAttestationReview: record.status === 'passed' && reasons.length === 0 }
  })
  return {
    records,
    // Failures are retained even when source/runtime identity is stale.
    attempts: records.length,
    failures: records.filter(record => record.status === 'failed').length,
    provenanceVerified: false as const,
    releaseReady: false as const,
    dispatchAuthorized: false as const,
  }
}

/** Refuses symlink escapes as well as lexical traversal. Do not point this at
 * untrusted concurrently mutable storage; it is a local review helper. */
export async function verifyDeliveryArtifacts(input: unknown, root: string) {
  const bundle = deliveryEvidenceSchema.parse(input)
  const base = await realpath(root)
  for (const record of bundle.records) {
    const path = await realpath(resolve(base, record.artifactPath))
    if (!path.startsWith(base + sep)) throw new Error('EVIDENCE_PATH_ESCAPE')
    const bytes = await readFile(path)
    if (sha256(bytes) !== record.artifactDigest) throw new Error('EVIDENCE_HASH_MISMATCH')
  }
  return { ...assessDeliveryEvidence(bundle), verifiedArtifactCount: bundle.records.length }
}
