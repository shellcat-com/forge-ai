/** Synthetic E0 fixtures. These are not model output or execution evidence. */
import { checkIds } from '../../engine/contracts/primitives.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import type { ExecutionReviewV1, ApprovalContext, ApprovalV1, BrokerDescriptorV1 } from '../../engine/contracts/review.ts'
import type { PlanV1, ManifestV1, FileBatchV1 } from '../../engine/contracts/source.ts'
import type { JobV1, Transition } from '../../engine/workflows/jobs.ts'
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const hash = sha256('E0 fixture')
export const scope = { workspaceId: id(1), projectId: id(2), jobId: id(3) }
export const now = '2026-09-09T12:00:00.000Z'
export const expiresAt = '2026-09-10T12:00:00.000Z'
export const resources = { cpu: 2, memoryMiB: 4096, processes: 512, diskMiB: 8192,
  logBytes: 10485760, activeMs: 1200000, verificationMs: 600000, maxCostMicros: 0 }
export const network = { internet: false as const, appDatabase: 'guest-loopback' as const, maxConnections: 5 as const }
export const plan: PlanV1 = { schemaVersion: 1, briefHash: hash, templateDigest: hash, presetDigest: hash,
  userStories: ['Create a task'], routes: [{ path: '/', purpose: 'Task board' }],
  dataEntities: [{ name: 'task', fields: ['id', 'title'] }], apiOperations: [{ method: 'POST', route: '/api/tasks', purpose: 'Create task' }],
  fileTasks: [{ path: 'app/page.tsx', instruction: 'Render task board' }], migrationIntent: [],
  requiredChecks: [...checkIds], unsupportedRequirements: [], assumptions: ['Synthetic data only'], resources, network }
export const manifest: ManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
  baseSnapshotId: null, planDigest: hash, presetDigest: hash,
  files: [{ path: 'app/page.tsx', blobId: id(4), sha256: sha256('fixture base'), bytes: 12, mediaType: 'text/typescript', mode: '0644' }],
  migrations: [], commandPolicyDigest: hash,
  provenance: { origin: 'fixture', jobId: scope.jobId, provider: null, model: null, promptVersion: 'fixture-v1' } }
export const batch: FileBatchV1 = { schemaVersion: 1, planDigest: canonicalHash(plan), baseManifestDigest: canonicalHash(manifest),
  batchIndex: 0, finalBatch: true, changes: [{ op: 'replace', path: 'app/page.tsx', expectedSha256: manifest.files[0].sha256, content: '// fixture proposal' }] }
export const commandPolicy: ExecutionReviewV1['commandPolicy'] = { schemaVersion: 1,
  commands: checkIds.map(checkId => ({ checkId, executable: checkId === 'typecheck' ? 'tsc' : 'external-harness', argv: checkId === 'typecheck' ? ['--noEmit'] : ['fixture-only'], timeoutMs: 120000 })), requiredChecks: [...checkIds], resources, network }
export const review: ExecutionReviewV1 = { schemaVersion: 1, ...scope, baseRevision: 1, baseSnapshotId: null,
  candidateDigest: canonicalHash(manifest), diffDigest: hash, templateDigest: hash, imageDigest: `sha256:${hash}`,
  policyDigest: canonicalHash(commandPolicy), commandPolicy, migrations: [], migrationBundleDigest: hash,
  dataReset: 'synthetic-data-only', expiresAt }
export const approval: ApprovalV1 = { schemaVersion: 1, id: id(5), ...scope, actorId: id(6), kind: 'execution',
  subjectDigest: canonicalHash(review), stateVersion: 6, decision: 'approve', createdAt: now, expiresAt }
export const context: ApprovalContext = { ...scope, actorId: id(6), currentRole: 'editor', userDisabled: false,
  subjectDigest: canonicalHash(review), stateVersion: 6, baseRevision: 1, baseSnapshotId: null, kind: 'execution', now, reviewExpiresAt: expiresAt,
  cancelRequested: false, policyRevoked: false, templateDigest: hash, policyDigest: review.policyDigest }
export const job: JobV1 = { schemaVersion: 1, ...scope, kind: 'generate', state: 'AWAITING_EXECUTION_APPROVAL',
  stateVersion: 6, baseRevision: 1, baseSnapshotId: null, templateDigest: hash, policyDigest: review.policyDigest,
  createdAt: now, updatedAt: now, reviewExpiresAt: expiresAt, reviewDigest: canonicalHash(review), finishedAt: null,
  repairCount: 0, activeRemainingMs: 1200000, cancelRequested: false }
export const transition: Transition = { target: 'PROVISIONING', expectedStateVersion: 6, now, elapsedActiveMs: 0,
  resourcesReleased: true, nextReviewDigest: null, reason: 'approval' }
export const descriptor: BrokerDescriptorV1 = { schemaVersion: 1, ...scope, operationId: id(7), environmentId: id(8), appDatabaseId: id(9), kind: 'test',
  leaseEpoch: 1, issuedAt: now, expiresAt: '2026-09-09T12:01:00.000Z', approvalId: approval.id, executionReviewDigest: canonicalHash(review),
  sourceManifestDigest: review.candidateDigest, templateDigest: hash, imageDigest: review.imageDigest, commandPolicyDigest: review.policyDigest,
  mounts: [{ source: 'approved-source', target: '/workspace', readOnly: true }, { source: 'ephemeral-scratch', target: '/scratch', readOnly: false }], network, resources }
