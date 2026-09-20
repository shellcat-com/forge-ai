import { z } from 'zod'
import { sha256 } from '../contracts/canonical.ts'
import { digest, uuid } from '../contracts/primitives.ts'
import { tokenSchema } from '../control/contracts.ts'
import type { ControlDatabase } from '../control/database.ts'
import { opaqueToken } from '../control/identity.ts'
import { validatePreviewGrant } from './policy.ts'

const routeSchema = z.object({
  environmentId: uuid,
  jobId: uuid,
  snapshotId: uuid,
  sourceManifestDigest: digest,
  templateDigest: digest,
  operationId: uuid,
  leaseEpoch: z.number().int().positive(),
  generation: uuid,
})
export type PreviewGrant = ReturnType<typeof validatePreviewGrant> & z.infer<typeof routeSchema>
export interface PreviewAuthority {
  consume(ticket: string, host: string): Promise<{ token: string; grant: PreviewGrant }>
  authorize(token: string, host: string): Promise<PreviewGrant>
  renew(token: string, host: string): Promise<{ token: string; grant: PreviewGrant }>
}
/** Runs inside the canonical control service. Never provide DB credentials to the
 * gateway guest transport. Remote composition requires workload-authenticated RPC. */
export class PreviewControl implements PreviewAuthority {
  constructor(private readonly db: ControlDatabase) {
    if (db.role !== 'forge_control_api') throw new Error('Control API identity required')
  }
  private async call(
    name: 'issue_preview_ticket' | 'consume_preview_ticket' | 'authorize_preview',
    args: unknown[],
    host: string
  ) {
    return this.db.tx(async (c) => {
      const {
        rows: [row],
      } = await c.query(
        `SELECT ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS grant`,
        args
      )
      const raw = row?.grant as Record<string, unknown>
      if (!raw) throw new Error('PREVIEW_UNAUTHORIZED')
      // PostgreSQL emits offsets; normalize through Date before strict wire parsing.
      const normalized = { ...raw }
      for (const key of ['authorizedAt', 'sessionExpiresAt', 'idleExpiresAt', 'absoluteExpiresAt'])
        normalized[key] = new Date(String(raw[key])).toISOString()
      const route = routeSchema.parse(normalized)
      const view = { ...normalized }
      for (const key of [
        'environmentId',
        'operationId',
        'leaseEpoch',
        'jobId',
        'snapshotId',
        'sourceManifestDigest',
        'templateDigest',
      ])
        delete view[key]
      return { ...validatePreviewGrant(view, host, Date.now()), ...route }
    })
  }
  async issue(parentToken: string, csrf: string, previewId: string, host: string) {
    tokenSchema.parse(parentToken)
    tokenSchema.parse(csrf)
    uuid.parse(previewId)
    const token = opaqueToken()
    const grant = await this.call(
      'issue_preview_ticket',
      [sha256(parentToken), sha256(csrf), previewId, host, sha256(token)],
      host
    )
    return {
      ticket: token,
      launchUrl: `https://${grant.hostname}/__forge/launch`,
      expiresInSeconds: 60,
    }
  }
  async consume(ticket: string, host: string) {
    tokenSchema.parse(ticket)
    const token = opaqueToken()
    const grant = await this.call(
      'consume_preview_ticket',
      [sha256(ticket), host, sha256(token)],
      host
    )
    return { token, grant }
  }
  authorize(token: string, host: string) {
    tokenSchema.parse(token)
    return this.call('authorize_preview', [sha256(token), host, null], host)
  }
  async renew(previous: string, host: string) {
    tokenSchema.parse(previous)
    const token = opaqueToken()
    const grant = await this.call(
      'authorize_preview',
      [sha256(previous), host, sha256(token)],
      host
    )
    return { token, grant }
  }
  async revoke(parent: string, csrf: string, previewId: string, host: string) {
    tokenSchema.parse(parent)
    tokenSchema.parse(csrf)
    uuid.parse(previewId)
    await this.db.tx((c) =>
      c.query('SELECT revoke_preview($1,$2,$3,$4)', [sha256(parent), sha256(csrf), previewId, host])
    )
  }
}
