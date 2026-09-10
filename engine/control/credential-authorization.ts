import { z } from 'zod'
import { sha256 } from '../contracts/canonical.ts'
import { uuid } from '../contracts/primitives.ts'
import { ControlError, tokenSchema } from './contracts.ts'
import type { ControlDatabase, Tx } from './database.ts'
import type { SessionService } from './identity.ts'

const requestSchema = z.strictObject({
  sessionToken: tokenSchema,
  workspaceId: uuid,
  csrfToken: tokenSchema,
  origin: z.string(),
  operation: z.enum(['connect', 'rotate', 'delete', 'status']),
})
export type CredentialAuthorizationRequest = z.infer<typeof requestSchema>
export interface CredentialPrincipal {
  userId: string
  workspaceId: string
  role: 'owner'
}

/** Identity-only guard: never accepts, reads or returns a provider credential.
 * The caller executes its scoped metadata write inside this transaction so a
 * membership revocation cannot race an authorize-then-write sequence. */
export class CredentialConnectionAuthorizer {
  constructor(
    private readonly db: ControlDatabase,
    private readonly sessions: SessionService,
    private readonly origin: string,
    private readonly freshSeconds = 900
  ) {
    const url = new URL(origin)
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      !Number.isInteger(freshSeconds) ||
      freshSeconds < 1 ||
      freshSeconds > 900
    )
      throw new Error('Credential connections require exact HTTPS origin and bounded freshness')
  }
  async withAuthorization<T>(
    input: CredentialAuthorizationRequest,
    action: (tx: Tx, principal: CredentialPrincipal) => Promise<T>
  ): Promise<T> {
    const request = requestSchema.parse(input)
    if (request.origin !== this.origin) throw new ControlError(403, 'ORIGIN_REJECTED')
    return this.db.session(
      request.sessionToken,
      request.workspaceId,
      'owner',
      async (tx, principal) => {
        this.sessions.checkCsrf(principal.csrf_hash, request.csrfToken)
        const { rows } = await tx.query(
          `SELECT 1 FROM sessions WHERE id_hash=$1 AND created_at>clock_timestamp()-($2::integer * interval '1 second')`,
          [sha256(request.sessionToken), this.freshSeconds]
        )
        if (!rows.length) throw new ControlError(401, 'REAUTHENTICATION_REQUIRED')
        return action(tx, {
          userId: principal.user_id,
          workspaceId: request.workspaceId,
          role: 'owner',
        })
      }
    )
  }
  /** Suitable only for a read or immediate decision; writes use withAuthorization. */
  authorize(input: CredentialAuthorizationRequest): Promise<CredentialPrincipal> {
    return this.withAuthorization(input, async (_tx, principal) => principal)
  }
}
