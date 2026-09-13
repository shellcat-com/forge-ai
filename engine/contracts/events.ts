import { z } from 'zod'
import { boundedJson, checkId, digest, label, limits, positive, scope, timestamp, uint, uuid, version } from './primitives.ts'
import { stateSchema } from '../workflows/jobs.ts'
import { usageSchema } from './provider.ts'

const envelope = { schemaVersion: version, ...scope, seq: positive, at: timestamp, stateVersion: positive }
export const jobEventSchema = boundedJson(z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('job.state'), data: z.strictObject({ from: stateSchema, to: stateSchema }) }),
  z.strictObject({ ...envelope, type: z.literal('plan.ready'), data: z.strictObject({ artifactId: uuid, planDigest: digest, reviewDigest: digest }) }),
  z.strictObject({ ...envelope, type: z.literal('changes.ready'), data: z.strictObject({ snapshotId: uuid, manifestDigest: digest, reviewDigest: digest }) }),
  z.strictObject({ ...envelope, type: z.literal('approval.recorded'), data: z.strictObject({ approvalId: uuid, kind: z.enum(['plan', 'execution', 'promotion']), decision: z.enum(['approve', 'reject']), subjectDigest: digest }) }),
  z.strictObject({ ...envelope, type: z.literal('step.started'), data: z.strictObject({ stepId: uuid, stage: stateSchema, attempt: positive, leaseEpoch: positive }) }),
  z.strictObject({ ...envelope, type: z.literal('step.finished'), data: z.strictObject({ stepId: uuid, status: z.enum(['succeeded', 'failed', 'cancelled']), evidenceId: uuid.nullable() }) }),
  z.strictObject({ ...envelope, type: z.literal('check.result'), data: z.strictObject({ check: checkId, status: z.enum(['passed', 'failed', 'blocked']), exitCode: uint.max(255).nullable(), evidenceId: uuid, candidateDigest: digest, origin: z.enum(['runner', 'fixture']) }).refine(c => c.status !== 'passed' || c.exitCode === 0, 'Passed check requires zero exit') }),
  z.strictObject({ ...envelope, type: z.literal('usage.updated'), data: usageSchema.extend({ amountMicros: uint.nullable(), priceVersion: label }) }),
  z.strictObject({ ...envelope, type: z.literal('preview.state'), data: z.strictObject({ previewId: uuid, generation: uuid, state: z.enum(['REQUESTED', 'STARTING', 'READY', 'STOPPING', 'STOPPED', 'FAILED', 'EXPIRING', 'EXPIRED']), expiresAt: timestamp }) }),
  z.strictObject({ ...envelope, type: z.literal('job.terminal'), data: z.strictObject({ state: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']), errorCode: label.nullable() }) }),
]), limits.eventBytes)
export type JobEventV1 = z.infer<typeof jobEventSchema>
export function parseEventCursor(cursor: string, jobId: string, latestSeq: number): number {
  uuid.parse(jobId); uint.parse(latestSeq)
  const match = /^([a-f0-9-]{36}):([1-9][0-9]*)$/.exec(cursor)
  if (!match || match[1] !== jobId || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > latestSeq) throw new Error('Invalid event cursor')
  return Number(match[2])
}
