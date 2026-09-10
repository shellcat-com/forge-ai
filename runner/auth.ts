import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { canonicalHash } from '../engine/contracts/canonical.ts'
import { signedDescriptorSchema } from '../engine/contracts/review.ts'
import { digest, timestamp } from '../engine/contracts/primitives.ts'

export type SignedDescriptor = z.infer<typeof signedDescriptorSchema>
export type TrustedPeer = { authorized: true; certificateSha256: string }
export class BrokerError extends Error {
  constructor(readonly code: 'UNAUTHORIZED' | 'STALE' | 'CONFLICT' | 'CAPACITY' | 'UNAVAILABLE' | 'INVALID' | 'UNCERTAIN') { super(code) }
}
export function authorizePeer(peer: TrustedPeer, fingerprints: ReadonlySet<string>): void {
  if (peer.authorized !== true || !fingerprints.has(peer.certificateSha256)) throw new BrokerError('UNAUTHORIZED')
}
export function signDescriptor(descriptor: SignedDescriptor['descriptor'], keyId: string, key: KeyObject): SignedDescriptor {
  const descriptorDigest = canonicalHash(descriptor)
  return signedDescriptorSchema.parse({ schemaVersion: 1, algorithm: 'Ed25519', keyId, descriptorDigest,
    signature: sign(null, Buffer.from(descriptorDigest, 'utf8'), key).toString('base64url'), descriptor })
}
export function verifyDescriptor(input: unknown, keys: ReadonlyMap<string, KeyObject>, now: number): SignedDescriptor {
  const envelope = signedDescriptorSchema.parse(input)
  const key = keys.get(envelope.keyId)
  if (!key || key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(envelope.descriptorDigest, 'utf8'), key,
    Buffer.from(envelope.signature, 'base64url'))) throw new BrokerError('UNAUTHORIZED')
  if (Date.parse(envelope.descriptor.issuedAt) > now || Date.parse(envelope.descriptor.expiresAt) <= now) throw new BrokerError('STALE')
  return envelope
}
export function publicKey(pem: string): KeyObject {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new BrokerError('INVALID')
  return key
}
export const signedResultSchema = z.strictObject({ schemaVersion: z.literal(1), keyId: z.string().min(1).max(120),
  requestDigest: digest, responseDigest: digest, issuedAt: timestamp, expiresAt: timestamp,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/), response: z.unknown() })
export function signResult(request: unknown, response: unknown, keyId: string, key: KeyObject, now: number) {
  const subject = { schemaVersion: 1 as const, keyId, requestDigest: canonicalHash(request), responseDigest: canonicalHash(response),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString() }
  return { ...subject, response, signature: sign(null, Buffer.from(canonicalHash(subject)), key).toString('base64url') }
}
export function verifyResult(input: unknown, request: unknown, keys: ReadonlyMap<string, KeyObject>, now: number): unknown {
  const { signature, response, ...subject } = signedResultSchema.parse(input)
  const key = keys.get(subject.keyId)
  if (!key || key.asymmetricKeyType !== 'ed25519' || subject.requestDigest !== canonicalHash(request)
    || subject.responseDigest !== canonicalHash(response) || Date.parse(subject.issuedAt) > now
    || Date.parse(subject.expiresAt) <= now || Date.parse(subject.expiresAt) - Date.parse(subject.issuedAt) > 30_000
    || !verify(null, Buffer.from(canonicalHash(subject)), key, Buffer.from(signature, 'base64url'))) throw new BrokerError('UNAUTHORIZED')
  return response
}
