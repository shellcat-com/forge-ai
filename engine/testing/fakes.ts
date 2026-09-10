import { generationRequestSchema } from '../contracts/provider.ts'
import type { ProviderAdapter, GenerationRequest, GenerationEvent, validateProviderResponse } from '../contracts/provider.ts'
import { validateDescriptor } from '../contracts/review.ts'
import { canonicalHash } from '../contracts/canonical.ts'

/** Explicit fixture provider: no network, credentials, model or paid calls. */
export class FixtureProvider implements ProviderAdapter {
  readonly id = 'fixture-provider-e0'
  constructor(private readonly events: GenerationEvent[]) {}
  async listModels() { return [{ schemaVersion: 1 as const, id: 'fixture-model', capabilities: { streaming: false, structuredOutput: true, toolCalls: false }, maxInputTokens: 1000, maxOutputTokens: 1000 }] }
  async validateCredentials() { return { schemaVersion: 1 as const, configured: false, verified: false, checkedAt: '2026-09-09T00:00:00Z' } }
  async *generate(request: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent> {
    generationRequestSchema.parse(request)
    for (const event of this.events) {
      if (signal.aborted) { yield { schemaVersion: 1, type: 'error', code: 'CANCELLED', retryable: false }; return }
      yield event.type === 'completed' ? { ...event, origin: 'fixture' } : structuredClone(event)
    }
  }
}
/** Explicit in-memory runner fake: validates binding only. No processes, files,
 * sockets, images, database allocation, signed evidence or isolation claims. */
export class FixtureRunner {
  readonly origin = 'fixture' as const
  private operations = new Map<string, { epoch: number; digest: string }>()
  create(descriptor: unknown, review: unknown, approval: unknown, context: unknown, epoch: number) {
    const d = validateDescriptor(descriptor, review, approval, context, epoch)
    const previous = this.operations.get(d.operationId)
    const immutableDigest = canonicalHash({ ...d, leaseEpoch: 0, issuedAt: null, expiresAt: null })
    if ((previous?.epoch ?? 0) > epoch) throw new Error('Stale fixture epoch')
    if (previous && previous.digest !== immutableDigest) throw new Error('Fixture operation identity reused')
    this.operations.set(d.operationId, { epoch, digest: immutableDigest })
    return { origin: this.origin, operationId: d.operationId, leaseEpoch: epoch, executed: false as const }
  }
}
export function requireLiveProvider(result: ReturnType<typeof validateProviderResponse>) {
  if (result.origin !== 'provider') throw new Error('Fixture cannot satisfy live-provider acceptance')
  return result
}
