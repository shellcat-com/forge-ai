import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { hostedPostgresConfig } from '../../../engine/hosting/persistence-config'
import * as schema from './schema'

const state = globalThis as unknown as { forgeAuthPool?: Pool }
export function authPool(): Pool {
  if (state.forgeAuthPool) return state.forgeAuthPool
  // Separate narrow login; never use the migration/app owner's DATABASE_URL.
  const config = hostedPostgresConfig(
    process.env.FORGE_AUTH_DATABASE_URL ?? '',
    process.env.FORGE_AUTH_DATABASE_HOST ?? ''
  )
  return (state.forgeAuthPool = new Pool(config))
}
export const authDb = () => drizzle(authPool(), { schema })
export async function assertAuthDatabase() {
  const result = await authPool().query(`SELECT
    EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND
      (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR
       r.rolname IN ('pg_read_server_files','pg_write_server_files','pg_execute_server_program'))) AS privileged,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname LIKE 'forge_%' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns,
    has_table_privilege(current_user,'public.forge_projects','SELECT') AS project_access,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create`)
  const role = result.rows[0]
  if (!role || role.privileged || role.owns || role.project_access || role.schema_create)
    throw new Error('Authentication requires a separate least-privilege database login')
}
