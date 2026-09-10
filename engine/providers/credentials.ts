import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '../contracts/canonical.ts'
import type { ProviderRegistry } from './registry.ts'

export interface CredentialAuth {
  sessionToken: string
  workspaceId: string
  csrfToken: string
  origin: string
  /** Set by the trusted server listener/proxy policy, NEVER parsed from body/forwarded headers. */
  transport: 'authenticated-tls'
}
export type CredentialOperation = 'connect' | 'rotate' | 'delete' | 'status'
export interface CredentialAuthorizer {
  authorize(
    request: Omit<CredentialAuth, 'transport'> & { operation: CredentialOperation }
  ): Promise<{ userId: string; workspaceId: string; role: string }>
}
export interface EncryptionKeys {
  currentKeyId(): Promise<string>
  resolve(keyId: string): Promise<Uint8Array>
}
export interface CredentialBinding {
  workspaceId: string
  id: string
  revision: number
  provider: string
  destination: string
}
export interface CredentialEnvelope {
  version: 1
  keyId: string
  nonce: string
  ciphertext: string
  tag: string
}
export interface CredentialRecord extends CredentialBinding {
  envelope: CredentialEnvelope | null
  deleted: boolean
  updatedAt: string
}
/** Implementation MUST scope all reads/CAS by workspace, enforce forced RLS, and
 * atomically compare expected revision. A tombstone retains NO ciphertext. */
export interface CredentialRepository {
  read(workspaceId: string, id: string, auth?: CredentialAuth): Promise<CredentialRecord | null>
  compareAndSwap(
    record: CredentialRecord,
    expectedRevision: number | null,
    auth: CredentialAuth
  ): Promise<boolean>
}
const keyValue = z
  .string()
  .min(8)
  .max(8192)
  .regex(/^[!-~]+$/)
const keyIdSchema = z.string().regex(/^[a-zA-Z0-9._/-]{1,200}$/)
const bindingSchema = z.strictObject({
  workspaceId: z.uuid(),
  id: z.uuid(),
  revision: z.number().int().positive(),
  provider: z.string().regex(/^[a-z0-9-]{1,60}$/),
  destination: z.string().url(),
})
const envelopeSchema = z.strictObject({
  version: z.literal(1),
  keyId: keyIdSchema,
  nonce: z.string().regex(/^[a-f0-9]{24}$/),
  ciphertext: z.string().regex(/^[a-f0-9]{16,16384}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
})
const aad = (binding: CredentialBinding) =>
  Buffer.from(
    canonicalJson({ domain: 'forge-provider-credential-v1', ...bindingSchema.parse(binding) })
  )
export class CredentialCipher {
  constructor(private readonly keys: EncryptionKeys) {}
  async encrypt(binding: CredentialBinding, raw: string): Promise<CredentialEnvelope> {
    let key: Buffer | undefined
    try {
      keyValue.parse(raw)
      const keyId = keyIdSchema.parse(await this.keys.currentKeyId())
      key = Buffer.from(await this.keys.resolve(keyId))
      if (key.length !== 32) throw new Error()
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(aad(binding))
      const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
      return {
        version: 1,
        keyId,
        nonce: nonce.toString('hex'),
        ciphertext: encrypted.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
      }
    } catch {
      throw new Error('CREDENTIAL_UNAVAILABLE')
    } finally {
      key?.fill(0)
    }
  }
  async decrypt(binding: CredentialBinding, input: CredentialEnvelope): Promise<string> {
    let key: Buffer | undefined, plaintext: Buffer | undefined
    try {
      const e = envelopeSchema.parse(input)
      key = Buffer.from(await this.keys.resolve(e.keyId))
      if (key.length !== 32) throw new Error()
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'hex'))
      decipher.setAAD(aad(binding))
      decipher.setAuthTag(Buffer.from(e.tag, 'hex'))
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(e.ciphertext, 'hex')),
        decipher.final(),
      ])
      return keyValue.parse(plaintext.toString('utf8'))
    } catch {
      throw new Error('CREDENTIAL_UNAVAILABLE')
    } finally {
      key?.fill(0)
      plaintext?.fill(0)
    }
  }
}
const bindingOf = (row: CredentialRecord): CredentialBinding => ({
  workspaceId: row.workspaceId,
  id: row.id,
  revision: row.revision,
  provider: row.provider,
  destination: row.destination,
})
const redacted = (row: CredentialRecord) => ({
  id: row.id,
  provider: row.provider,
  revision: row.revision,
  configured: !row.deleted,
  verified: false as const,
  status: row.deleted ? ('deleted' as const) : ('unverified' as const),
  updatedAt: row.updatedAt,
})
const connectSchema = z.strictObject({ provider: z.string().max(60), key: keyValue })
const rotateSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.number().int().positive(),
  key: keyValue,
})
const deleteSchema = rotateSchema.omit({ key: true })
export class CredentialConnections {
  constructor(
    private readonly auth: CredentialAuthorizer,
    private readonly repository: CredentialRepository,
    private readonly cipher: CredentialCipher,
    private readonly registry: ProviderRegistry,
    private readonly origin: string
  ) {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin)
      throw new Error('CREDENTIAL_TLS_REQUIRED')
  }
  private async authorize(auth: CredentialAuth, operation: CredentialOperation) {
    if (auth.transport !== 'authenticated-tls' || auth.origin !== this.origin)
      throw new Error('CREDENTIAL_FORBIDDEN')
    const { sessionToken, workspaceId, csrfToken, origin } = auth
    const p = await this.auth.authorize({ sessionToken, workspaceId, csrfToken, origin, operation })
    if (p.workspaceId !== auth.workspaceId || p.role !== 'owner')
      throw new Error('CREDENTIAL_FORBIDDEN')
    return p
  }
  /** Route disables body logging/telemetry and enforces <=16 KiB before calling.
   * Lazy body read happens only after authenticated TLS/Origin/session checks. */
  async mutate(
    auth: CredentialAuth,
    operation: Exclude<CredentialOperation, 'status'>,
    readBody: () => Promise<unknown>
  ) {
    try {
      await this.authorize(auth, operation)
      const input = await readBody()
      let row: CredentialRecord, expected: number | null
      if (operation === 'connect') {
        const body = connectSchema.parse(input),
          policy = this.registry.policy(body.provider, 'files')
        const binding = {
          workspaceId: auth.workspaceId,
          id: randomUUID(),
          revision: 1,
          provider: policy.id,
          destination: policy.endpoint,
        }
        row = {
          ...binding,
          envelope: await this.cipher.encrypt(binding, body.key),
          deleted: false,
          updatedAt: new Date().toISOString(),
        }
        expected = null
      } else {
        const body = operation === 'rotate' ? rotateSchema.parse(input) : deleteSchema.parse(input)
        const old = await this.repository.read(auth.workspaceId, body.id, auth)
        if (!old || old.deleted || old.revision !== body.expectedRevision) throw new Error()
        const binding = { ...bindingOf(old), revision: old.revision + 1 }
        row = {
          ...binding,
          envelope:
            operation === 'rotate'
              ? await this.cipher.encrypt(binding, rotateSchema.parse(input).key)
              : null,
          deleted: operation === 'delete',
          updatedAt: new Date().toISOString(),
        }
        expected = old.revision
      }
      // Recheck after potentially slow KMS/body work; DB integration must fence revocation at CAS.
      await this.authorize(auth, operation)
      if (!(await this.repository.compareAndSwap(row, expected, auth))) throw new Error()
      return redacted(row)
    } catch {
      throw new Error('CREDENTIAL_OPERATION_DENIED')
    }
  }
  async status(auth: CredentialAuth, id: string) {
    try {
      await this.authorize(auth, 'status')
      const row = await this.repository.read(auth.workspaceId, z.uuid().parse(id), auth)
      if (!row) throw new Error()
      return redacted(row)
    } catch {
      throw new Error('CREDENTIAL_OPERATION_DENIED')
    }
  }
}
/** Server worker only. The caller obtains binding from an admitted durable job,
 * never a user body. Fresh authorization and revision check occur for every use. */
export function hostedCredentialResolver(
  repository: CredentialRepository,
  cipher: CredentialCipher,
  binding: CredentialBinding,
  authorizeUse: (binding: CredentialBinding, signal: AbortSignal) => Promise<void>
) {
  const bound = bindingSchema.parse(binding)
  return async (signal: AbortSignal): Promise<string> => {
    try {
      signal.throwIfAborted()
      await authorizeUse(bound, signal)
      const row = await repository.read(bound.workspaceId, bound.id)
      if (
        !row ||
        row.deleted ||
        !row.envelope ||
        canonicalJson(bindingOf(row)) !== canonicalJson(bound)
      )
        throw new Error()
      const value = await cipher.decrypt(bound, row.envelope)
      signal.throwIfAborted()
      await authorizeUse(bound, signal)
      // Re-read after KMS I/O so a concurrent rotation/deletion invalidates the handle.
      const current = await repository.read(bound.workspaceId, bound.id)
      if (!current || current.deleted || current.revision !== bound.revision) throw new Error()
      return value
    } catch {
      throw new Error('CREDENTIAL_UNAVAILABLE')
    }
  }
}
export interface ServerSecretReference {
  id: string
  provider: string
  destination: string
  source: 'environment' | 'secret'
  name: string
}
/** References are administrator configuration. Request bodies select neither env
 * names nor secret-store paths; no NEXT_PUBLIC/VITE/PUBLIC variable is accepted. */
export function serverCredentialResolver(
  reference: ServerSecretReference,
  expected: { provider: string; destination: string },
  resolveSecret: (name: string, signal: AbortSignal) => Promise<string | undefined>,
  environment: NodeJS.ProcessEnv = process.env
) {
  if (
    reference.provider !== expected.provider ||
    reference.destination !== expected.destination ||
    !/^[A-Za-z0-9_./-]{1,200}$/.test(reference.name) ||
    /(?:^|\/)(?:NEXT_PUBLIC_|VITE_|PUBLIC_)/i.test(reference.name)
  )
    throw new Error('CREDENTIAL_REFERENCE_DENIED')
  const config = { ...reference }
  return async (signal: AbortSignal) => {
    try {
      signal.throwIfAborted()
      const raw =
        config.source === 'environment'
          ? environment[config.name]
          : await resolveSecret(config.name, signal)
      signal.throwIfAborted()
      return keyValue.parse(raw)
    } catch {
      throw new Error('CREDENTIAL_UNAVAILABLE')
    }
  }
}
