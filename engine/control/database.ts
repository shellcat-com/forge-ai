import pg from 'pg'
import type { PoolClient, PoolConfig, QueryResultRow } from 'pg'
import type { Role } from './contracts.ts'
import { ControlError, tokenSchema } from './contracts.ts'
import { sha256 } from '../contracts/canonical.ts'
import { uuid } from '../contracts/primitives.ts'
export type Tx = PoolClient
export interface Principal {
  user_id: string
  role: Role
  csrf_hash: string
}
export class ControlDatabase {
  readonly pool: pg.Pool
  constructor(
    config: PoolConfig,
    readonly role: 'forge_control_api' | 'forge_control_worker' | 'forge_control_maintenance'
  ) {
    this.pool = new pg.Pool({
      max: 8,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 5000,
      ...config,
    })
    this.pool.on('error', () => {
      /* Requests expose only safe typed errors. */
    })
  }
  async check(): Promise<void> {
    const c = await this.pool.connect()
    try {
      const {
        rows: [r],
      } = await c.query(
        `SELECT r.rolsuper,r.rolbypassrls, EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='forge_control' AND t.relowner=r.oid) AS owns FROM pg_roles r WHERE rolname=current_user`
      )
      if (!r || r.rolsuper || r.rolbypassrls || r.owns)
        throw new Error('Runtime must use a non-owner, non-superuser, non-BYPASSRLS login')
      const unsafe = await c.query(
        `SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolsuper OR r.rolbypassrls OR r.rolname='forge_control_guard' OR (r.rolname IN('forge_control_api','forge_control_worker','forge_control_maintenance') AND r.rolname<>$1) OR EXISTS(SELECT 1 FROM pg_class t WHERE t.relnamespace='forge_control'::regnamespace AND t.relowner=r.oid)) LIMIT 1`,
        [this.role]
      )
      if (unsafe.rowCount)
        throw new Error('Runtime login inherits conflicting or privileged authority')
      await c.query(`SET ROLE ${this.role}`)
      const { rows } = await c.query(
        `SELECT environment FROM forge_control.control_settings WHERE singleton`
      )
      if (rows[0]?.environment !== 'synthetic')
        throw new Error('Explicit synthetic database bootstrap required')
    } finally {
      await c.query('RESET ROLE')
      c.release()
    }
  }
  async tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    let broken = false
    try {
      await c.query('BEGIN')
      await c.query(`SET LOCAL ROLE ${this.role}`)
      await c.query(`SET LOCAL search_path=forge_control,pg_catalog`)
      await c.query(`SET LOCAL statement_timeout='5s'`)
      await c.query(`SET LOCAL lock_timeout='3s'`)
      await c.query(`SET LOCAL idle_in_transaction_session_timeout='10s'`)
      await c.query(
        `SELECT set_config('forge.workspace_id','',true),set_config('forge.user_id','',true)`
      )
      const result = await fn(c)
      await c.query('COMMIT')
      return result
    } catch (error) {
      try {
        await c.query('ROLLBACK')
      } catch {
        broken = true
      }
      throw error
    } finally {
      c.release(broken)
    }
  }
  async session<T>(
    token: string,
    workspace: string | null,
    required: Role,
    fn: (c: Tx, p: Principal) => Promise<T>
  ): Promise<T> {
    if (this.role !== 'forge_control_api') throw new Error('Wrong database identity')
    tokenSchema.parse(token)
    if (workspace) uuid.parse(workspace)
    return this.tx(async (c) => {
      const {
        rows: [p],
      } = await c.query<Principal>('SELECT * FROM authorize_session($1,$2,$3)', [
        sha256(token),
        workspace,
        required,
      ])
      return fn(c, p)
    })
  }
  async resource<T>(
    token: string,
    id: string,
    kind: 'project' | 'job' | 'snapshot',
    required: Role,
    fn: (c: Tx, p: Principal, w: string) => Promise<T>
  ) {
    tokenSchema.parse(token)
    uuid.parse(id)
    return this.tx(async (c) => {
      const {
        rows: [r],
      } = await c.query<{ workspace: string }>('SELECT locate_resource($1,$2,$3) AS workspace', [
        sha256(token),
        id,
        kind,
      ])
      const {
        rows: [p],
      } = await c.query<Principal>('SELECT * FROM authorize_session($1,$2,$3)', [
        sha256(token),
        r.workspace,
        required,
      ])
      return fn(c, p, r.workspace)
    })
  }
  async scoped<T>(workspace: string, fn: (c: Tx) => Promise<T>) {
    if (this.role === 'forge_control_api') throw new ControlError(403, 'FORBIDDEN')
    uuid.parse(workspace)
    return this.tx(async (c) => {
      await c.query("SELECT set_config('forge.workspace_id',$1,true)", [workspace])
      return fn(c)
    })
  }
  close() {
    return this.pool.end()
  }
}
export async function one<T extends QueryResultRow>(
  c: Tx,
  sql: string,
  values: unknown[] = []
): Promise<T> {
  const { rows } = await c.query<T>(sql, values)
  if (!rows[0]) throw new ControlError(404, 'NOT_FOUND')
  return rows[0]
}
export const clock = async (c: Tx): Promise<string> =>
  (
    await one<{ now: string }>(
      c,
      'SELECT to_char(clock_timestamp() AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS now'
    )
  ).now
export const number = (v: string | number): number => {
  const n = Number(v)
  if (!Number.isSafeInteger(n)) throw new Error('Unsafe database integer')
  return n
}
