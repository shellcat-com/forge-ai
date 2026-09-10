import { createHash } from 'node:crypto'
import { CredentialCipher } from '../../../engine/providers/credentials'
import type { CredentialBinding, CredentialEnvelope } from '../../../engine/providers/credentials'
import { ByokError } from './transport'
export function ownerNamespace(owner: string) {
  const h = createHash('sha256')
    .update('forge-byok-owner-v1:' + owner)
    .digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export function credentialBinding(row: {
  owner_id: string
  id: string
  revision: number
  provider: string
  base_url: string
}): CredentialBinding {
  return {
    workspaceId: ownerNamespace(row.owner_id),
    id: row.id,
    revision: row.revision,
    provider: row.provider,
    destination: row.base_url,
  }
}
export function vault(environment: Record<string, string | undefined> = process.env) {
  return new CredentialCipher({
    async currentKeyId() {
      if (!environment.FORGE_BYOK_ACTIVE_KEY)
        throw new ByokError('VAULT', 'Configure the server credential keyring.', 503)
      return environment.FORGE_BYOK_ACTIVE_KEY
    },
    async resolve(id) {
      let keys: Record<string, string>
      try {
        keys = JSON.parse(environment.FORGE_BYOK_KEYRING ?? '{}')
      } catch {
        throw new Error('VAULT')
      }
      if (!/^[a-f0-9]{64}$/.test(keys[id] ?? '')) throw new Error('VAULT')
      return Buffer.from(keys[id], 'hex')
    },
  })
}
export function redactCredential(text: string, key: string | undefined) {
  if (!key) return text
  // Reject rather than publish a provider echo. All response artifacts pass here.
  if (
    [key, encodeURIComponent(key), Buffer.from(key).toString('base64')].some((value) =>
      text.includes(value)
    )
  )
    throw new ByokError(
      'SECRET_ECHO',
      'The provider response contained credential material and was discarded.',
      502
    )
  return text
}
export type { CredentialEnvelope }
