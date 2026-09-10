import { z } from 'zod'
import { digest, positive, uint, uuid, version, boundedJson } from '../contracts/primitives.ts'
export const roleSchema = z.enum(['owner', 'editor', 'viewer'])
export type Role = z.infer<typeof roleSchema>
export const keySchema = z.string().regex(/^[!-~]{16,128}$/)
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const returnPathSchema = z
  .string()
  .max(240)
  .regex(/^\/(?!\/)[A-Za-z0-9_/#?=&.-]*$/)
  .refine((v) => !v.includes('..'), 'Unsafe return path')
export const loginSchema = z.strictObject({
  schemaVersion: version,
  returnPath: returnPathSchema,
  bootstrapNonce: tokenSchema,
})
export const projectInputSchema = z.strictObject({
  schemaVersion: version,
  name: z.string().trim().min(1).max(100),
  brief: z.string().trim().min(20).max(12000),
  templateId: z.literal('next-postgres-v1'),
  presetId: z.enum([
    'technical-mono',
    'editorial-product',
    'cinematic-monochrome',
    'atmospheric-pixel',
    'illustrated-landscape',
    'fixture',
  ]),
  presetVersion: z.literal(1),
})
export const projectPatchSchema = projectInputSchema
  .omit({ templateId: true })
  .partial()
  .required({ schemaVersion: true })
export const jobInputSchema = z.strictObject({
  schemaVersion: version,
  kind: z.literal('generate'),
  baseSnapshotId: uuid.nullable(),
  baseRevision: positive,
  instruction: z.string().trim().min(20).max(12000),
  modelPolicyId: z.literal('fixture-v1'),
  maxCostMicros: uint,
})
export const restoreInputSchema = z.strictObject({
  schemaVersion: version,
  expectedProjectRevision: positive,
  maxCostMicros: uint,
  resetPreviewDataAcknowledged: z.literal(true),
})
export const promoteInputSchema = z.strictObject({
  schemaVersion: version,
  snapshotId: uuid,
  verificationDigest: digest,
  stateVersion: positive,
  expectedProjectRevision: positive,
})
export const approveInputSchema = z.strictObject({
  schemaVersion: version,
  kind: z.enum(['plan', 'execution', 'promotion']),
  subjectDigest: digest,
  stateVersion: positive,
  decision: z.enum(['approve', 'reject']),
})
export const cancelInputSchema = z.strictObject({ schemaVersion: version })
export const deleteInputSchema = z.strictObject({
  schemaVersion: version,
  expectedProjectRevision: positive,
})
export const listSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(),
})
export const modelPolicySchema = boundedJson(
  z.strictObject({
    schemaVersion: version,
    origin: z.literal('fixture'),
    modelPolicyId: z.literal('fixture-v1'),
    promptVersion: z.literal('fixture-e1-v1'),
    templateDigest: digest,
    policyDigest: digest,
    maxCostMicros: uint,
    maxAttemptMicros: uint,
  }),
  8192
)
export class ControlError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryable = false,
    public details?: Record<string, unknown>
  ) {
    super(code)
  }
}
export const conflict = () => new ControlError(409, 'STATE_CONFLICT')
export function safeError(error: unknown): ControlError {
  if (error instanceof ControlError) return error
  if (error instanceof z.ZodError) return new ControlError(422, 'VALIDATION_ERROR')
  const code = (error as { code?: string })?.code
  const known: Record<string, [number, string]> = {
    P0401: [401, 'UNAUTHENTICATED'],
    P0403: [403, 'FORBIDDEN'],
    P0404: [404, 'NOT_FOUND'],
    P0503: [503, 'ADMISSION_DISABLED'],
    P0429: [429, 'CAPACITY_UNAVAILABLE'],
    23505: [409, 'STATE_CONFLICT'],
    40001: [409, 'STATE_CONFLICT'],
    '40P01': [409, 'STATE_CONFLICT'],
  }
  if (code && known[code]) return new ControlError(...known[code])
  return new ControlError(503, 'CONTROL_UNAVAILABLE', true)
}
