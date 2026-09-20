import { z } from 'zod'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
import { digest } from '../../engine/contracts/primitives.ts'
import { hostConfigSchema } from '../host/preflight.ts'

/** The digest covers this manifest, not a mutable image tag. Paths are host-local
 * catalog entries, never supplied by an API caller or candidate. */
export const runtimeImageSchema = z.strictObject({ schemaVersion: z.literal(1),
  architecture: z.literal('x86_64'), isolation: z.literal('firecracker-jailer-vsock-v1'),
  templateInputsDigest: digest, imageInputsDigest: digest, guestAgentDigest: digest,
  assets: hostConfigSchema.shape.assets,
})
export type RuntimeImage = z.infer<typeof runtimeImageSchema>
export function runtimeImageDigest(input: unknown): string {
  return `sha256:${canonicalHash(runtimeImageSchema.parse(input))}`
}
