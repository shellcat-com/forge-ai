import { z } from 'zod'

export const version = z.literal(1)
export const uuid = z.uuid()
export const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const imageDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const uint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const positive = uint.min(1)
export const timestamp = z.iso.datetime({ offset: true })
export const label = z.string().min(1).max(120)
export const description = z.string().min(1).max(2000)
export const scope = { workspaceId: uuid, projectId: uuid, jobId: uuid }
export const limits = {
  fileBytes: 256 * 1024, sourceBytes: 10 * 1024 * 1024, files: 200,
  assetBytes: 5 * 1024 * 1024, assets: 10, operations: 100,
  eventBytes: 8192, planBytes: 64 * 1024, batchBytes: 12 * 1024 * 1024,
} as const
export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length
export function wellFormed(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
}
export const textContent = z.string().refine(wellFormed, 'Invalid Unicode')
  .refine(s => !s.includes('\0') && utf8Bytes(s) <= limits.fileBytes, 'Invalid text or oversized file')
export function boundedJson<T extends z.ZodType>(schema: T, bytes: number) {
  return schema.refine(value => utf8Bytes(JSON.stringify(value)) <= bytes, 'JSON byte cap exceeded')
}
export function parseJson<T extends z.ZodType>(schema: T, raw: string, bytes: number): z.output<T> {
  if (!wellFormed(raw) || utf8Bytes(raw) > bytes) throw new Error('Invalid or oversized JSON')
  return schema.parse(JSON.parse(raw))
}
export const checkIds = ['source-policy', 'dependencies', 'secrets', 'migration-fresh',
  'migration-prior', 'lint', 'typecheck', 'unit', 'build', 'http', 'browser-crud',
  'db-restart', 'keyboard', 'responsive'] as const
export const checkId = z.enum(checkIds)
export const requiredChecks = z.array(checkId).length(checkIds.length)
  .refine(v => new Set(v).size === checkIds.length, 'Every mandatory check is required')
export const resourcesSchema = z.strictObject({
  cpu: positive.max(2), memoryMiB: positive.max(4096), processes: positive.max(512),
  diskMiB: positive.max(8192), logBytes: positive.max(10 * 1024 * 1024),
  activeMs: positive.max(1_200_000), verificationMs: positive.max(600_000),
  maxCostMicros: uint,
})
export const networkSchema = z.strictObject({ internet: z.literal(false),
  appDatabase: z.literal('guest-loopback'), maxConnections: z.literal(5) })
