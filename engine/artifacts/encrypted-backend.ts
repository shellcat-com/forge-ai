import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '../contracts/canonical.ts'
import { uuid } from '../contracts/primitives.ts'
import type { ImmutableObjectBackend } from './store.ts'

export const objectByteCap = 32 * 1024 * 1024
export const keyIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/)
export const objectEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  keyId: keyIdSchema,
  nonce: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z.instanceof(Uint8Array).refine((v) => v.length <= objectByteCap),
})
export type ObjectEnvelope = z.infer<typeof objectEnvelopeSchema>
/** IDs are versioned, server-owned references, never credentials or user URLs.
 * The backend copies returned bytes before wiping its per-call copy. */
export interface ObjectKeyResolver {
  resolve(keyId: string): Promise<Uint8Array>
}
/** A transport stores ONLY encrypted envelopes. It must keep key identities
 * permanently unique, including after deletion, and reject overwrite. */
export interface VersionedCiphertextTransport {
  readonly evidence: 'fixture' | 'durable'
  create(key: string, version: string, envelope: ObjectEnvelope): Promise<void>
  read(key: string, version: string): Promise<ObjectEnvelope>
}
export function parseObjectKey(key: string) {
  const parts = key.split('/')
  if (parts.length !== 5 || parts[0] !== 'quarantine') throw new Error('Invalid object key')
  const [workspaceId, projectId, jobId, id] = parts.slice(1).map((v) => uuid.parse(v))
  return { workspaceId, projectId, jobId, id }
}
const aad = (key: string, version: string, keyId: string) =>
  Buffer.from(
    canonicalJson({
      domain: 'forge-control-artifact',
      schemaVersion: 1,
      key,
      version,
      keyId,
    })
  )

/** Storage durability is a transport property, not a deployed acceptance claim.
 * Scope authorization remains ArtifactStore + a fresh control DB authorization.
 * Credential vaults deliberately cannot use this artifact namespace. */
export class EncryptedObjectBackend implements ImmutableObjectBackend {
  readonly evidence: 'fixture' | 'durable'
  constructor(
    private readonly transport: VersionedCiphertextTransport,
    private readonly keys: ObjectKeyResolver,
    private readonly activeKeyId: string
  ) {
    keyIdSchema.parse(activeKeyId)
    this.evidence = transport.evidence
  }
  async createOnly(key: string, input: Uint8Array) {
    parseObjectKey(key)
    if (input.length > objectByteCap) throw new Error('Object byte cap')
    const bytes = Uint8Array.from(input),
      version = randomUUID()
    let secret: Uint8Array | undefined
    try {
      secret = Uint8Array.from(await this.keys.resolve(this.activeKeyId))
      if (secret.length !== 32) throw new Error('Object encryption key unavailable')
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', secret, nonce)
      cipher.setAAD(aad(key, version, this.activeKeyId))
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
      await this.transport.create(key, version, {
        schemaVersion: 1,
        keyId: this.activeKeyId,
        nonce: nonce.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ciphertext,
      })
      return { version }
    } catch {
      throw new Error('Object write unavailable')
    } finally {
      secret?.fill(0)
      bytes.fill(0)
    }
  }
  async readVersion(key: string, version: string): Promise<Uint8Array> {
    parseObjectKey(key)
    uuid.parse(version)
    // Never expose driver/KMS errors, ciphertext or key IDs through a read error.
    let secret: Uint8Array | undefined
    try {
      const record = objectEnvelopeSchema.parse(await this.transport.read(key, version))
      secret = Uint8Array.from(await this.keys.resolve(record.keyId))
      if (secret.length !== 32) throw new Error('Key unavailable')
      const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(record.nonce, 'hex'))
      decipher.setAAD(aad(key, version, record.keyId))
      decipher.setAuthTag(Buffer.from(record.tag, 'hex'))
      return Uint8Array.from(Buffer.concat([decipher.update(record.ciphertext), decipher.final()]))
    } catch {
      throw new Error('Artifact unavailable or integrity mismatch')
    } finally {
      secret?.fill(0)
    }
  }
}

/** Self-hosted secret-reference resolver. No default key, key generation, browser
 * env lookup or automatic rotation. Keep old IDs available through backup expiry.
 * A hosted KMS adapter must implement the same interface after service selection. */
export class EnvironmentObjectKeys implements ObjectKeyResolver {
  constructor(
    private readonly references: Readonly<Record<string, string>>,
    private readonly env: Readonly<Record<string, string | undefined>>
  ) {
    for (const [id, name] of Object.entries(references)) {
      keyIdSchema.parse(id)
      if (!/^FORGE_OBJECT_KEY_[A-Z0-9_]+$/.test(name))
        throw new Error('Invalid server key reference')
    }
  }
  async resolve(keyId: string) {
    keyIdSchema.parse(keyId)
    const name = Object.hasOwn(this.references, keyId) ? this.references[keyId] : undefined
    const value = name ? this.env[name] : undefined
    if (!value || !/^[a-f0-9]{64}$/.test(value))
      throw new Error('Object encryption key unavailable')
    return Uint8Array.from(Buffer.from(value, 'hex'))
  }
}
