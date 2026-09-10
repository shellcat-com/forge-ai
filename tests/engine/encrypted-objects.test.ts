import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import {
  EncryptedObjectBackend,
  EnvironmentObjectKeys,
} from '../../engine/artifacts/encrypted-backend.ts'
import type {
  ObjectEnvelope,
  VersionedCiphertextTransport,
} from '../../engine/artifacts/encrypted-backend.ts'

class FixtureTransport implements VersionedCiphertextTransport {
  readonly evidence = 'fixture' as const
  readonly rows = new Map<string, { version: string; envelope: ObjectEnvelope }>()
  async create(key: string, version: string, envelope: ObjectEnvelope) {
    if (this.rows.has(key)) throw new Error('Exists')
    this.rows.set(key, { version, envelope })
  }
  async read(key: string, version: string) {
    const row = this.rows.get(key)
    if (!row || row.version !== version) throw new Error('Unavailable')
    return row.envelope
  }
}
const scope = () => ({ workspaceId: randomUUID(), projectId: randomUUID(), jobId: randomUUID() })
describe('encrypted object boundary with explicit fixture transport', () => {
  it('binds exact object/version/key ID, supports old key reads after rotation, and denies cross-tenant access', async () => {
    const transport = new FixtureTransport(),
      s = scope()
    const keys = new EnvironmentObjectKeys(
      { v1: 'FORGE_OBJECT_KEY_V1', v2: 'FORGE_OBJECT_KEY_V2' },
      {
        FORGE_OBJECT_KEY_V1: randomBytes(32).toString('hex'),
        FORGE_OBJECT_KEY_V2: randomBytes(32).toString('hex'),
      }
    )
    const store = new ArtifactStore(new EncryptedObjectBackend(transport, keys, 'v1'))
    const ref = await store.put(s, 'source-blob', Buffer.from('synthetic private source'))
    const rotated = new ArtifactStore(new EncryptedObjectBackend(transport, keys, 'v2'))
    expect(Buffer.from(await rotated.read(s, ref)).toString()).toBe('synthetic private source')
    await expect(rotated.read(scope(), ref)).rejects.toThrow('unavailable')
    await expect(rotated.read(s, { ...ref, storageVersion: randomUUID() })).rejects.toThrow()
    await expect(rotated.read(s, { ...ref, sha256: 'a'.repeat(64) })).rejects.toThrow('integrity')
    const row = transport.rows.get(ref.storageKey)!
    expect(
      Buffer.from(row.envelope.ciphertext).includes(Buffer.from('synthetic private source'))
    ).toBe(false)
    const second = await rotated.put(s, 'source-blob', Buffer.from('second'))
    transport.rows.set(second.storageKey, {
      version: second.storageVersion,
      envelope: row.envelope,
    })
    await expect(rotated.read(s, second)).rejects.toThrow('integrity')
    row.envelope.keyId = 'v2'
    await expect(rotated.read(s, ref)).rejects.toThrow('integrity')
  })
  it('rejects missing keys, tampering, overwrite, invalid paths and public secret references', async () => {
    const transport = new FixtureTransport(),
      s = scope(),
      secret = randomBytes(32).toString('hex')
    const keys = new EnvironmentObjectKeys(
      { v1: 'FORGE_OBJECT_KEY_V1' },
      { FORGE_OBJECT_KEY_V1: secret }
    )
    const backend = new EncryptedObjectBackend(transport, keys, 'v1'),
      store = new ArtifactStore(backend)
    const ref = await store.put(s, 'source-blob', Buffer.from('inert fixture'))
    await expect(backend.createOnly(ref.storageKey, Buffer.from('overwrite'))).rejects.toThrow(
      'unavailable'
    )
    await expect(
      backend.createOnly('quarantine/../../etc/passwd', Buffer.from('no'))
    ).rejects.toThrow()
    transport.rows.get(ref.storageKey)!.envelope.ciphertext[0] ^= 1
    await expect(store.read(s, ref)).rejects.toThrow('integrity')
    const missing = new EncryptedObjectBackend(transport, new EnvironmentObjectKeys({}, {}), 'v1')
    await expect(missing.readVersion(ref.storageKey, ref.storageVersion)).rejects.toThrow(
      'unavailable'
    )
    expect(() => new EnvironmentObjectKeys({ v1: 'NEXT_PUBLIC_KEY' }, {})).toThrow('server key')
  })
})
