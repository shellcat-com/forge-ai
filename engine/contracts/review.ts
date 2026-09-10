import { z } from 'zod'
import { boundedJson, checkId, digest, imageDigest, label, networkSchema, positive,
  requiredChecks, resourcesSchema, scope, timestamp, uint, uuid, version } from './primitives.ts'
import { migrationSchema } from './source.ts'
import { canonicalHash } from './canonical.ts'

export const commandSchema = z.strictObject({ checkId,
  executable: z.enum(['dependency-materializer', 'migration-runner', 'eslint', 'tsc', 'vitest', 'next', 'external-harness', 'scanner']),
  argv: z.array(z.string().max(240).refine(s => !/[\0\r\n]/.test(s))).max(20),
  timeoutMs: positive.max(240_000),
})
export const commandPolicySchema = z.strictObject({ schemaVersion: version, commands: z.array(commandSchema).min(1).max(20),
  requiredChecks, network: networkSchema, resources: resourcesSchema })
  .refine(p => p.requiredChecks.every(id => p.commands.some(c => c.checkId === id)), 'Missing mandatory command/check coverage')
export const executionReviewSchema = boundedJson(z.strictObject({ schemaVersion: version, ...scope,
  baseRevision: positive, baseSnapshotId: uuid.nullable(), candidateDigest: digest, diffDigest: digest,
  templateDigest: digest, imageDigest, policyDigest: digest, commandPolicy: commandPolicySchema,
  migrations: z.array(migrationSchema).max(200), migrationBundleDigest: digest,
  dataReset: z.literal('synthetic-data-only'), expiresAt: timestamp,
}).refine(r => r.policyDigest === canonicalHash(r.commandPolicy), 'Command policy digest mismatch'), 64 * 1024)
export const planReviewSchema = z.strictObject({ schemaVersion: version, ...scope, baseRevision: positive,
  baseSnapshotId: uuid.nullable(), planDigest: digest, templateDigest: digest, policyDigest: digest, expiresAt: timestamp })
export const promotionReviewSchema = z.strictObject({ schemaVersion: version, ...scope, baseRevision: positive,
  baseSnapshotId: uuid.nullable(), candidateDigest: digest, verificationDigest: digest,
  templateDigest: digest, policyDigest: digest, expiresAt: timestamp })
export const approvalSchema = z.strictObject({ schemaVersion: version, id: uuid, ...scope, actorId: uuid,
  kind: z.enum(['plan', 'execution', 'promotion']), subjectDigest: digest, stateVersion: positive,
  decision: z.enum(['approve', 'reject']), createdAt: timestamp, expiresAt: timestamp,
}).refine(a => Date.parse(a.expiresAt) > Date.parse(a.createdAt), 'Invalid approval lifetime')
export const approvalContextSchema = z.strictObject({ ...scope, actorId: uuid,
  currentRole: z.enum(['owner', 'editor', 'viewer']).nullable(), userDisabled: z.boolean(),
  stateVersion: positive, subjectDigest: digest, baseRevision: positive, baseSnapshotId: uuid.nullable(),
  kind: z.enum(['plan', 'execution', 'promotion']), now: timestamp,
  reviewExpiresAt: timestamp, cancelRequested: z.boolean(), policyRevoked: z.boolean(),
  templateDigest: digest, policyDigest: digest,
})
export type ExecutionReviewV1 = z.infer<typeof executionReviewSchema>
export type ApprovalV1 = z.infer<typeof approvalSchema>
export type ApprovalContext = z.infer<typeof approvalContextSchema>

/** Call only with freshly read, locked authorization/project/job context.
 * This validates data; it does not authenticate an actor or authorize an RPC. */
export function validateApproval(input: unknown, subjectInput: unknown, contextInput: unknown): ApprovalV1 {
  const a = approvalSchema.parse(input)
  const c = approvalContextSchema.parse(contextInput)
  const subject = (c.kind === 'plan' ? planReviewSchema : c.kind === 'execution' ? executionReviewSchema : promotionReviewSchema).parse(subjectInput)
  if (c.userDisabled || c.currentRole === null || c.currentRole === 'viewer' || c.cancelRequested || c.policyRevoked) throw new Error('Approval unauthorized or revoked')
  if (a.kind !== c.kind || a.actorId !== c.actorId || a.stateVersion !== c.stateVersion
    || a.subjectDigest !== c.subjectDigest || a.subjectDigest !== canonicalHash(subject)) throw new Error('Stale approval')
  for (const key of ['workspaceId', 'projectId', 'jobId'] as const)
    if (a[key] !== c[key] || subject[key] !== c[key]) throw new Error('Approval scope mismatch')
  if (subject.baseRevision !== c.baseRevision || subject.baseSnapshotId !== c.baseSnapshotId
    || subject.templateDigest !== c.templateDigest || subject.policyDigest !== c.policyDigest) throw new Error('Review binding mismatch')
  const now = Date.parse(c.now)
  if (Date.parse(a.createdAt) > now || Date.parse(a.expiresAt) <= now
    || Date.parse(c.reviewExpiresAt) <= now || subject.expiresAt !== c.reviewExpiresAt
    || Date.parse(a.expiresAt) > Date.parse(c.reviewExpiresAt)
    || Date.parse(a.expiresAt) - Date.parse(a.createdAt) > 86_400_000) throw new Error('Expired or invalid approval deadline')
  return a
}

export const brokerDescriptorSchema = boundedJson(z.strictObject({ schemaVersion: version, ...scope,
  operationId: uuid, environmentId: uuid, appDatabaseId: uuid, kind: z.enum(['test', 'preview']),
  leaseEpoch: positive, issuedAt: timestamp, expiresAt: timestamp,
  approvalId: uuid, executionReviewDigest: digest, sourceManifestDigest: digest,
  templateDigest: digest, imageDigest, commandPolicyDigest: digest,
  mounts: z.tuple([z.strictObject({ source: z.literal('approved-source'), target: z.literal('/workspace'), readOnly: z.literal(true) }),
    z.strictObject({ source: z.literal('ephemeral-scratch'), target: z.literal('/scratch'), readOnly: z.literal(false) })]),
  network: networkSchema, resources: resourcesSchema,
}).refine(d => Date.parse(d.expiresAt) > Date.parse(d.issuedAt) && Date.parse(d.expiresAt) - Date.parse(d.issuedAt) <= 60_000, 'Lease exceeds 60 seconds'), 8192)
export const signedDescriptorSchema = z.strictObject({ schemaVersion: version, algorithm: z.literal('Ed25519'),
  keyId: label, descriptorDigest: digest, signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/), descriptor: brokerDescriptorSchema,
}).refine(s => s.descriptorDigest === canonicalHash(s.descriptor), 'Descriptor digest mismatch')
export type BrokerDescriptorV1 = z.infer<typeof brokerDescriptorSchema>
export function validateDescriptor(input: unknown, reviewInput: unknown, approvalInput: unknown, contextInput: unknown, currentEpoch: number): BrokerDescriptorV1 {
  const d = brokerDescriptorSchema.parse(input)
  const review = executionReviewSchema.parse(reviewInput)
  const c = approvalContextSchema.parse(contextInput)
  const a = validateApproval(approvalInput, review, c)
  positive.parse(currentEpoch)
  if (c.kind !== 'execution' || a.decision !== 'approve' || d.approvalId !== a.id
    || d.leaseEpoch !== currentEpoch || Date.parse(d.issuedAt) > Date.parse(c.now) || Date.parse(d.expiresAt) <= Date.parse(c.now)
    || d.executionReviewDigest !== canonicalHash(review) || d.sourceManifestDigest !== review.candidateDigest
    || d.templateDigest !== review.templateDigest || d.imageDigest !== review.imageDigest
    || d.commandPolicyDigest !== review.policyDigest
    || canonicalHash(d.network) !== canonicalHash(review.commandPolicy.network)
    || canonicalHash(d.resources) !== canonicalHash(review.commandPolicy.resources)) throw new Error('Descriptor binding or lease mismatch')
  for (const key of ['workspaceId', 'projectId', 'jobId'] as const)
    if (d[key] !== c[key]) throw new Error('Descriptor scope mismatch')
  return d
}

export const verificationSchema = z.strictObject({ schemaVersion: version, ...scope,
  origin: z.enum(['runner', 'fixture']), candidateDigest: digest, templateDigest: digest, imageDigest,
  policyDigest: digest, buildOutputDigest: digest, leaseEpoch: positive,
  checks: z.array(z.strictObject({ checkId, startedAt: timestamp, finishedAt: timestamp, exitCode: uint.max(255),
    timedOut: z.boolean(), oom: z.boolean(), evidenceDigest: digest })).length(14),
}).refine(v => new Set(v.checks.map(c => c.checkId)).size === 14 && v.checks.every(c => Date.parse(c.finishedAt) >= Date.parse(c.startedAt)), 'Invalid check evidence')
export type VerificationV1 = z.infer<typeof verificationSchema>

/** Requires an already authenticated broker result. Signature verification and
 * artifact retrieval belong to E3; stdout/provider claims are never inputs. */
export function validatePassingVerification(input: unknown, descriptorInput: unknown): VerificationV1 {
  const v = verificationSchema.parse(input)
  const d = brokerDescriptorSchema.parse(descriptorInput)
  if (v.origin !== 'runner' || v.candidateDigest !== d.sourceManifestDigest || v.templateDigest !== d.templateDigest
    || v.imageDigest !== d.imageDigest || v.policyDigest !== d.commandPolicyDigest || v.leaseEpoch !== d.leaseEpoch
    || v.workspaceId !== d.workspaceId || v.projectId !== d.projectId || v.jobId !== d.jobId
    || v.checks.some(c => c.exitCode !== 0 || c.timedOut || c.oom)) throw new Error('Invalid, fixture, stale or failing verification')
  return v
}
