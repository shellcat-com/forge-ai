import { Pool } from 'pg'
import { appDatabaseUrl } from '../platform/environment'

let pool: Pool | undefined
export function database(): Pool {
  pool ??= new Pool({ connectionString: appDatabaseUrl(process.env.APP_DATABASE_URL), max: 5, connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000, statement_timeout: 5000, application_name: 'forge-disposable-app' })
  return pool
}
