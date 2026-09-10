import { z } from 'zod'
import type { JobState } from '../workflows/jobs.ts'
import { planSchema, manifestSchema } from '../contracts/source.ts'
import type { PlanV1, ManifestV1 } from '../contracts/source.ts'
import { verificationSchema } from '../contracts/review.ts'
import type { VerificationV1 } from '../contracts/review.ts'
import { textContent, uint, uuid, version } from '../contracts/primitives.ts'
/** Adapters propose artifacts and report operations. They cannot choose a next
 * job state, approve, promote, meter the ledger, mutate the DB, or access sessions. */
export interface StageInput {
  readonly workspaceId: string
  readonly projectId: string
  readonly jobId: string
  readonly stepId: string
  readonly leaseEpoch: number
  readonly operationId: string
  readonly inputDigest: string
  readonly stage: JobState
  readonly instruction: string
  readonly maxCostMicros: number
  readonly baseSnapshotId: string | null
  readonly plan?: PlanV1
  readonly manifest?: ManifestV1
  readonly verification?: VerificationV1
}
export const stageResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    kind: z.literal('plan'),
    plan: planSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    kind: z.literal('candidate'),
    manifest: manifestSchema,
    blobs: z.array(z.strictObject({ blobId: uuid, content: textContent })).max(200),
  }),
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    kind: z.literal('provisioned'),
    executed: z.literal(false),
  }),
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    kind: z.literal('verification'),
    verification: verificationSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    kind: z.literal('preview'),
    executed: z.literal(false),
  }),
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    kind: z.literal('repairable-error'),
    diagnosticCode: z.literal('FIXTURE_CHECK_FAILURE'),
  }),
])
export type StageResult = z.infer<typeof stageResultSchema>
export interface StageAdapter {
  readonly origin: 'fixture'
  run(input: StageInput, signal: AbortSignal): Promise<StageResult>
}
export const fixtureUsageSchema = z.strictObject({
  schemaVersion: version,
  origin: z.literal('fixture'),
  amountMicros: uint,
})
