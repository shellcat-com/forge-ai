import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { sha256 } from '../contracts/canonical.ts'
import type { ControlDatabase } from './database.ts'
import { secureEqual } from './identity.ts'
import { ControlError, tokenSchema } from './contracts.ts'

/** Server-only bridge. The parent bearer comes from Better Auth's verified
 * session, never from a user ID/email supplied in a JSON request. Child handles
 * remain server-side and cannot outlive/re-fresh the authoritative login. */
export class HostedIdentityBridge {
  constructor(
    private readonly db: ControlDatabase,
    private readonly key: Uint8Array
  ) {
    if (db.role !== 'forge_control_api' || key.length !== 32)
      throw new Error('HOSTED_IDENTITY_CONFIGURATION')
  }
  private mac(domain: string, value: string) {
    return createHmac('sha256', this.key).update(`${domain}:${value}`).digest('base64url')
  }
  async connect(parentToken: string) {
    z.string().min(16).max(512).parse(parentToken)
    const sessionToken = this.mac('forge-hosted-session-v1', parentToken)
    const csrfToken = this.mac('forge-hosted-csrf-v1', sessionToken)
    const principal = await this.db.tx(async (tx) => {
      const { rows } = await tx.query<{
        user_id: string
        workspace_id: string
        expires_at: Date
      }>('SELECT * FROM bridge_hosted_session($1,$2,$3)', [
        parentToken,
        sha256(sessionToken),
        sha256(csrfToken),
      ])
      if (!rows[0]) throw new ControlError(401, 'UNAUTHENTICATED')
      return rows[0]
    })
    return {
      userId: principal.user_id,
      workspaceId: principal.workspace_id,
      expiresAt: principal.expires_at.toISOString(),
      sessionToken,
      csrfToken,
    }
  }
  checkCsrf(expectedHash: string, token: string) {
    if (!tokenSchema.safeParse(token).success || !secureEqual(expectedHash, sha256(token)))
      throw new ControlError(403, 'CSRF_INVALID')
  }
}
