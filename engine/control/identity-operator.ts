import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { uuid } from '../contracts/primitives.ts'
import { exactHttps } from './oidc-identity.ts'

const admission = z.strictObject({
  operatorId: uuid,
  requestId: uuid,
  workspaceId: uuid,
  issuer: z.string().max(2048),
  subject: z.string().min(1).max(255),
  role: z.enum(['owner', 'editor', 'viewer']),
})
const revocation = z.strictObject({
  operatorId: uuid,
  requestId: uuid,
  workspaceId: uuid,
  userId: uuid,
})

/** Trusted operator-only service, held outside the API/worker composition.
 * Existing runtime SQL grants cannot mint users or memberships. Input must name
 * the provider's exact immutable subject, never an email-derived identifier. */
export class IdentityOperator {
  constructor(
    private readonly pool: Pool,
    private readonly issuer: string
  ) {
    exactHttps(issuer, true)
  }
  private async tx<T>(workspaceId: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        return await this.attempt(workspaceId, fn)
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== '55P03' && code !== '40P01') throw error
        if (attempt === 11) throw new Error('IDENTITY_OPERATOR_BUSY_RETRY')
        await delay(20 + attempt * 10)
      }
    }
    throw new Error('IDENTITY_OPERATOR_BUSY_RETRY')
  }
  private async attempt<T>(workspaceId: string, fn: (tx: PoolClient) => Promise<T>) {
    const tx = await this.pool.connect()
    let broken = false
    try {
      await tx.query('BEGIN')
      await tx.query('SET LOCAL search_path=forge_control,pg_catalog')
      await tx.query("SET LOCAL statement_timeout='5s'")
      await tx.query("SET LOCAL lock_timeout='25ms'")
      // Never wait on a row while holding this global fence: canonical requests
      // acquire session/membership locks first. NOWAIT + rollback/retry prevents
      // an inverse-order wait cycle. The short timeout also bounds relation locks.
      const settings = await tx.query('SELECT singleton FROM control_settings FOR UPDATE NOWAIT')
      if (!settings.rowCount) throw new Error('Control settings required')
      const workspace = await tx.query(
        'SELECT id FROM workspaces WHERE id=$1 AND disabled_at IS NULL AND deleting_at IS NULL FOR UPDATE NOWAIT',
        [workspaceId]
      )
      if (!workspace.rowCount) throw new Error('Active workspace required')
      const result = await fn(tx)
      await tx.query('COMMIT')
      return result
    } catch (error) {
      try {
        await tx.query('ROLLBACK')
      } catch {
        broken = true
      }
      throw error
    } finally {
      tx.release(broken)
    }
  }
  private async audit(tx: PoolClient, input: z.infer<typeof revocation>, action: string) {
    await tx.query(
      `INSERT INTO audit_events(id,workspace_id,actor_kind,actor_id,action,resource_id,request_id,outcome,metadata_json)
      VALUES($1,$2,'service',$3,$4,$5,$6,'allowed','{"schemaVersion":1}')`,
      [randomUUID(), input.workspaceId, input.operatorId, action, input.userId, input.requestId]
    )
  }
  private async invalidate(tx: PoolClient, userId: string) {
    await tx.query('SELECT id_hash FROM sessions WHERE user_id=$1 FOR UPDATE NOWAIT', [userId])
    await tx.query('SELECT token_hash FROM preview_tickets WHERE user_id=$1 FOR UPDATE NOWAIT', [
      userId,
    ])
    // Conservative across all workspaces: forces a new login after any role change.
    await tx.query(
      'UPDATE sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1',
      [userId]
    )
    await tx.query(
      'UPDATE preview_tickets SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1',
      [userId]
    )
  }
  private async protectLastOwner(tx: PoolClient, workspaceId: string, userId: string) {
    const { rows } = await tx.query(
      `SELECT user_id FROM memberships WHERE workspace_id=$1 AND role='owner' FOR UPDATE NOWAIT`,
      [workspaceId]
    )
    if (rows.length === 1 && rows[0].user_id === userId)
      throw new Error('Cannot remove the last owner')
  }
  async admit(input: z.infer<typeof admission>): Promise<{ userId: string }> {
    const value = admission.parse(input)
    if (value.issuer !== this.issuer) throw new Error('Unconfigured issuer')
    return this.tx(value.workspaceId, async (tx) => {
      await tx.query(
        'SELECT id FROM users WHERE oidc_issuer=$1 AND oidc_subject=$2 FOR UPDATE NOWAIT',
        [value.issuer, value.subject]
      )
      const {
        rows: [user],
      } = await tx.query<{ id: string; disabled_at: Date | null }>(
        `INSERT INTO users(id,oidc_issuer,oidc_subject) VALUES($1,$2,$3)
         ON CONFLICT(oidc_issuer,oidc_subject) DO UPDATE SET oidc_subject=EXCLUDED.oidc_subject RETURNING id,disabled_at`,
        [randomUUID(), value.issuer, value.subject]
      )
      await tx.query(
        'SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE NOWAIT',
        [value.workspaceId, user.id]
      )
      if (user.disabled_at) throw new Error('Disabled identity requires explicit recovery')
      if (value.role !== 'owner') await this.protectLastOwner(tx, value.workspaceId, user.id)
      await tx.query(
        `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
        [value.workspaceId, user.id, value.role]
      )
      await this.invalidate(tx, user.id)
      await this.audit(tx, { ...value, userId: user.id }, `identity.admitted.${value.role}`)
      return { userId: user.id }
    })
  }
  async revoke(input: z.infer<typeof revocation>): Promise<void> {
    const value = revocation.parse(input)
    return this.tx(value.workspaceId, async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT', [value.userId])
      await tx.query(
        'SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE NOWAIT',
        [value.workspaceId, value.userId]
      )
      await this.protectLastOwner(tx, value.workspaceId, value.userId)
      await tx.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2', [
        value.workspaceId,
        value.userId,
      ])
      await this.invalidate(tx, value.userId)
      await this.audit(tx, value, 'identity.membership.revoked')
    })
  }
}
