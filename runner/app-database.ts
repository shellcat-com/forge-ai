import { sha256 } from '../engine/contracts/canonical.ts'
import type { ExecutionReviewV1 } from '../engine/contracts/review.ts'

export interface ValidatedSql {
  schemaVersion: 1; policyVersion: 'forge-additive-sql-v1'; sourceDigest: string; statements: string[]
}
export interface GuestMigrationSession {
  readonly origin: 'fixture' | 'runner'
  /** Authenticated guest RPC binding; never a control-plane pg connection. */
  identity(): Promise<{ database: 'forge_app'; role: 'forge_migrator'; address: '127.0.0.1'; appDatabaseId: string }>
  transaction(statements: readonly string[], limits: { statementTimeoutMs: 15000; totalTimeoutMs: 60000 }): Promise<void>
}
/** Injection point for engine/validation/migrations.ts. Only the canonical SQL
 * returned by the strict parser goes to the guest. Source hash/order are checked
 * again here; raw provider SQL is never concatenated into privileged bootstrap. */
export async function applyApprovedMigrations(review: ExecutionReviewV1, appDatabaseId: string,
  readSource: (path: string) => Promise<string>, validateSql: (source: string) => ValidatedSql, session: GuestMigrationSession) {
  const identity = await session.identity()
  if (identity.database !== 'forge_app' || identity.role !== 'forge_migrator' || identity.address !== '127.0.0.1'
    || identity.appDatabaseId !== appDatabaseId) throw new Error('App database boundary mismatch')
  const statements: string[] = []
  for (const [index, migration] of review.migrations.entries()) {
    if (migration.order !== index + 1 || migration.path !== `migrations/${migration.id}.sql`) throw new Error('Migration ordering mismatch')
    const source = await readSource(migration.path)
    if (sha256(source) !== migration.sha256) throw new Error('Migration content mismatch')
    const validated = validateSql(source)
    if (validated.schemaVersion !== 1 || validated.policyVersion !== 'forge-additive-sql-v1' || validated.sourceDigest !== migration.sha256
      || !validated.statements.length || validated.statements.length > 200) throw new Error('Invalid migration validation')
    statements.push(...validated.statements)
  }
  if (statements.length > 200 || Buffer.byteLength(statements.join('\n')) > 256 * 1024) throw new Error('Migration budget exceeded')
  if (statements.length) await session.transaction(statements, { statementTimeoutMs: 15000, totalTimeoutMs: 60000 })
  return { origin: session.origin, appDatabaseId, migrationCount: review.migrations.length, statementCount: statements.length }
}
