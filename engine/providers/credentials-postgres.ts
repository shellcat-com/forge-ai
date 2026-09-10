import type { ControlDatabase, Tx } from '../control/database.ts'
import { number } from '../control/database.ts'
import type {
  CredentialAuth,
  CredentialRecord,
  CredentialRepository,
  CredentialOperation,
} from './credentials.ts'

/** Task05 supplies fresh transactional session+membership+CSRF+TLS authorization
 * and serializes membership/session revocation. It uses the same transaction as CAS. */
export interface CredentialTransactionAuthority {
  withAuthorization<T>(
    request: Omit<CredentialAuth, 'transport'> & { operation: CredentialOperation },
    action: (c: Tx, principal: { userId: string; workspaceId: string; role: 'owner' }) => Promise<T>
  ): Promise<T>
}
interface Row {
  workspace_id: string
  id: string
  revision: string
  provider: string
  destination: string
  envelope_json: CredentialRecord['envelope']
  deleted: boolean
  updated_at: Date
}
export class PostgresCredentialRepository implements CredentialRepository {
  constructor(
    private readonly db: ControlDatabase,
    private readonly authority: CredentialTransactionAuthority
  ) {}
  async read(
    workspaceId: string,
    id: string,
    auth?: CredentialAuth
  ): Promise<CredentialRecord | null> {
    const read = async (c: Tx) => {
      const row = (
        await c.query<Row>('SELECT * FROM provider_credentials WHERE workspace_id=$1 AND id=$2', [
          workspaceId,
          id,
        ])
      ).rows[0]
      return row
        ? {
            workspaceId: row.workspace_id,
            id: row.id,
            revision: number(row.revision),
            provider: row.provider,
            destination: row.destination,
            envelope: row.envelope_json,
            deleted: row.deleted,
            updatedAt: row.updated_at.toISOString(),
          }
        : null
    }
    if (this.db.role === 'forge_control_worker') return this.db.scoped(workspaceId, read)
    if (!auth || auth.workspaceId !== workspaceId || this.db.role !== 'forge_control_api')
      throw new Error('CREDENTIAL_FORBIDDEN')
    return this.authority.withAuthorization(identityRequest(auth, 'status'), read)
  }
  async compareAndSwap(
    record: CredentialRecord,
    expectedRevision: number | null,
    auth: CredentialAuth
  ): Promise<boolean> {
    if (this.db.role !== 'forge_control_api' || auth.workspaceId !== record.workspaceId)
      throw new Error('CREDENTIAL_FORBIDDEN')
    return this.authority.withAuthorization(
      identityRequest(
        auth,
        expectedRevision === null ? 'connect' : record.deleted ? 'delete' : 'rotate'
      ),
      async (c) => {
        if (expectedRevision === null) {
          if (record.revision !== 1 || record.deleted || !record.envelope)
            throw new Error('CREDENTIAL_CAS')
          const result = await c.query(
            `INSERT INTO provider_credentials(workspace_id,id,revision,provider,destination,envelope_json,deleted)
          VALUES($1,$2,1,$3,$4,$5,false) ON CONFLICT DO NOTHING`,
            [record.workspaceId, record.id, record.provider, record.destination, record.envelope]
          )
          return result.rowCount === 1
        }
        if (
          record.revision !== expectedRevision + 1 ||
          record.deleted !== (record.envelope === null)
        )
          throw new Error('CREDENTIAL_CAS')
        const result = await c.query(
          `UPDATE provider_credentials SET revision=$3,envelope_json=$4,deleted=$5,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND id=$2 AND revision=$6 AND NOT deleted AND provider=$7 AND destination=$8`,
          [
            record.workspaceId,
            record.id,
            record.revision,
            record.envelope,
            record.deleted,
            expectedRevision,
            record.provider,
            record.destination,
          ]
        )
        return result.rowCount === 1
      }
    )
  }
}

function identityRequest(auth: CredentialAuth, operation: CredentialOperation) {
  const { sessionToken, workspaceId, csrfToken, origin } = auth
  return { sessionToken, workspaceId, csrfToken, origin, operation }
}
