import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { sha256, canonicalJson } from '../contracts/canonical.ts'
import { digest, limits, scope, uint, uuid } from '../contracts/primitives.ts'

export const artifactScopeSchema = z.strictObject(scope)
export type ArtifactScope = z.infer<typeof artifactScopeSchema>
export const artifactRefSchema = z.strictObject({ schemaVersion: z.literal(1), ...scope, id: uuid,
  kind: z.enum(['plan', 'source-manifest', 'source-blob', 'diff', 'source-export']), sha256: digest,
  bytes: uint.max(32 * 1024 * 1024), storageKey: z.string().max(240), storageVersion: z.string().min(1).max(200),
  state: z.literal('available'), backendEvidence: z.enum(['fixture', 'durable']) })
export type ArtifactRef = z.infer<typeof artifactRefSchema>
export type ArtifactKind = ArtifactRef['kind']

/** Production implementation must atomically create immutable, encrypted private
 * objects and return immutable version IDs. Never implement this using overwrite.
 * Metadata adoption, tenant authorization and orphan GC remain E1 transactions. */
export interface ImmutableObjectBackend {
  readonly evidence: 'fixture' | 'durable'
  createOnly(key: string, bytes: Uint8Array): Promise<{ version: string }>
  readVersion(key: string, version: string): Promise<Uint8Array>
}
/** Synthetic process-local object backend; not durable/object-store acceptance. */
export class MemoryObjectBackend implements ImmutableObjectBackend {
  readonly evidence = 'fixture' as const
  private readonly objects = new Map<string, { version: string; bytes: Uint8Array }>()
  async createOnly(key: string, bytes: Uint8Array) {
    if (this.objects.has(key)) throw new Error('Immutable object already exists')
    const version = randomUUID()
    this.objects.set(key, { version, bytes: bytes.slice() })
    return { version }
  }
  async readVersion(key: string, version: string) {
    const item = this.objects.get(key)
    if (!item || item.version !== version) throw new Error('Artifact unavailable')
    return item.bytes.slice()
  }
}
const caps: Record<ArtifactKind, number> = { plan: limits.planBytes, 'source-manifest': 256 * 1024,
  'source-blob': limits.assetBytes, diff: 24 * 1024 * 1024, 'source-export': 32 * 1024 * 1024 }
const keyFor = (s: ArtifactScope, id: string) => `quarantine/${s.workspaceId}/${s.projectId}/${s.jobId}/${id}`

export class ArtifactStore {
  constructor(private readonly backend: ImmutableObjectBackend) {}
  /** Caller validates product before writing. Availability confers no authority. */
  async put(scopeInput: ArtifactScope, kind: ArtifactKind, input: Uint8Array): Promise<ArtifactRef> {
    const s = artifactScopeSchema.parse(scopeInput)
    const bytes = input.slice()
    if (bytes.byteLength > caps[kind]) throw new Error('Artifact byte cap')
    const id = randomUUID()
    const key = keyFor(s, id)
    const result = await this.backend.createOnly(key, bytes)
    const ref = artifactRefSchema.parse({ schemaVersion: 1, ...s, id, kind, sha256: sha256(bytes), bytes: bytes.length,
      storageKey: key, storageVersion: result.version, state: 'available', backendEvidence: this.backend.evidence })
    // Verify an immutable version is readable before a database may adopt it.
    await this.read(s, ref)
    return ref
  }
  async putJson(s: ArtifactScope, kind: ArtifactKind, value: unknown) {
    return this.put(s, kind, new TextEncoder().encode(canonicalJson(value)))
  }
  /** Scope must be freshly authorized by E1, and ref loaded from its trusted DB.
   * Job differs for a prior snapshot; workspace AND project must always match. */
  async read(scopeInput: ArtifactScope, refInput: ArtifactRef): Promise<Uint8Array> {
    const s = artifactScopeSchema.parse(scopeInput)
    const ref = artifactRefSchema.parse(refInput)
    if (s.workspaceId !== ref.workspaceId || s.projectId !== ref.projectId || ref.storageKey !== keyFor(ref, ref.id)
      || ref.bytes > caps[ref.kind]) throw new Error('Artifact unavailable')
    const bytes = await this.backend.readVersion(ref.storageKey, ref.storageVersion)
    if (bytes.length !== ref.bytes || sha256(bytes) !== ref.sha256) throw new Error('Artifact integrity mismatch')
    return bytes.slice()
  }
}
