import { z } from 'zod'
import { ArtifactStore } from '../../../engine/artifacts/store'
import {
  EncryptedObjectBackend,
  EnvironmentObjectKeys,
  keyIdSchema,
} from '../../../engine/artifacts/encrypted-backend'
import { PostgresCiphertextTransport } from '../../../engine/artifacts/postgres-backend'
import { hostedPostgresConfig } from '../../../engine/hosting/persistence-config'
import { HostedReviews } from '../../../engine/control/hosted-reviews'
import { keySchema, safeError } from '../../../engine/control/contracts'
import { AccessError, apiError } from '../auth/access'
import { smallJson } from '../http/local'
import { hostedActor } from './hosted'

type Reader = {
  transport: PostgresCiphertextTransport
  store: ArtifactStore
  checked?: Promise<void>
}
const state = globalThis as unknown as { forgeHostedReviewReader?: Reader }
async function reviewContext(request: Request, mutation: boolean) {
  if (process.env.FORGE_HOSTED_SOURCE_REVIEW !== 'true')
    throw new AccessError(503, 'Source review is not configured.')
  const identity = await hostedActor(request, mutation)
  if (!state.forgeHostedReviewReader) {
    const input = process.env.FORGE_OBJECT_KEY_REFERENCES_JSON ?? ''
    if (input.length > 4096) throw new Error('Invalid key references')
    const references = z.record(z.string(), z.string()).parse(JSON.parse(input))
    const keys = new EnvironmentObjectKeys(references, process.env)
    const keyId = keyIdSchema.parse(process.env.FORGE_OBJECT_KEY_ID)
    const transport = new PostgresCiphertextTransport(
      hostedPostgresConfig(
        process.env.FORGE_OBJECT_READER_DATABASE_URL ?? '',
        process.env.FORGE_CONTROL_DATABASE_HOST ?? ''
      ),
      'forge_object_reader'
    )
    state.forgeHostedReviewReader = {
      transport,
      store: new ArtifactStore(new EncryptedObjectBackend(transport, keys, keyId)),
    }
  }
  const reader = state.forgeHostedReviewReader
  reader.checked ??= reader.transport.check().catch(async (error) => {
    if (state.forgeHostedReviewReader === reader) delete state.forgeHostedReviewReader
    await reader.transport.pool.end()
    throw error
  })
  await reader.checked
  return {
    identity,
    reviews: new HostedReviews(identity.control.db, identity.control.bridge, reader.store),
  }
}
export async function readHostedPlan(request: Request, jobId: string) {
  z.uuid().parse(jobId)
  const { identity, reviews } = await reviewContext(request, false)
  return reviews.plan(identity.sessionToken, identity.workspaceId, jobId)
}
export async function approveHostedPlan(request: Request, jobId: string) {
  z.uuid().parse(jobId)
  const key = keySchema.parse(request.headers.get('idempotency-key'))
  const { identity, reviews } = await reviewContext(request, true)
  return reviews.approvePlan(
    identity.sessionToken,
    identity.workspaceId,
    identity.csrfToken,
    jobId,
    key,
    await smallJson(request, 2048)
  )
}
export function hostedReviewError(error: unknown) {
  const result =
    error instanceof AccessError
      ? apiError(error)
      : apiError(
          new AccessError(
            error instanceof z.ZodError ? 400 : safeError(error).status,
            error instanceof z.ZodError
              ? 'Check the review request and retry.'
              : 'The review could not be completed. Reload the current plan and verify your account and model connection.'
          )
        )
  result.headers.set('Cache-Control', 'no-store')
  return result
}
