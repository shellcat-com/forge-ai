import { Pool } from 'pg'
let pool: Pool | undefined
export function database() {
  if (!process.env.APP_DATABASE_URL) throw new Error('Application database unavailable')
  return (pool ??= new Pool({
    connectionString: process.env.APP_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  }))
}
export async function initialize() {
  await database().query(
    "CREATE TABLE IF NOT EXISTS items(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,title text NOT NULL,body text NOT NULL DEFAULT '')"
  )
}
