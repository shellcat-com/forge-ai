import { z } from 'zod'
import { artifactRefSchema } from '../artifacts/store.ts'
import { manifestSchema } from '../contracts/source.ts'
export const storedSourceSchema = z.strictObject({
  manifest: manifestSchema,
  manifestArtifact: artifactRefSchema,
  blobs: z.array(artifactRefSchema).min(1).max(200),
})
export const storedCandidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  origin: z.literal('fixture'),
  kind: z.literal('stored-candidate'),
  source: storedSourceSchema,
  diff: artifactRefSchema,
})
export type StoredCandidate = z.infer<typeof storedCandidateSchema>
