import pg from 'pg'
import { createCloudApp } from './app.mjs'
import { createVerifier } from './auth.mjs'
import { CloudStore } from './store.mjs'
import { createPlanner } from './planning.mjs'
for (const name of ['DATABASE_URL', 'NEON_AUTH_BASE_URL', 'FORGE_APP_ORIGIN'])
  if (!process.env[name]) throw new Error(`${name} is required.`)
if (process.env.FORGE_AUTH_ENABLED !== 'true')
  throw new Error('Set FORGE_AUTH_ENABLED=true to run the cloud API.')
const origin = new URL(process.env.FORGE_APP_ORIGIN)
const auth = new URL(process.env.NEON_AUTH_BASE_URL)
if (
  origin.origin !== process.env.FORGE_APP_ORIGIN ||
  auth.protocol !== 'https:' ||
  auth.username ||
  auth.password ||
  auth.search ||
  auth.hash
)
  throw new Error('Invalid origin or auth URL.')
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))
  throw new Error('HTTPS required outside local development.')
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
})
const {
  rows: [role],
} = await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
if (role.rolsuper || role.rolbypassrls) {
  await pool.end()
  throw new Error('Application database role must not bypass RLS.')
}
const server = createCloudApp({
  store: new CloudStore(pool),
  verify: createVerifier(auth.href, pool),
  origin: origin.origin,
  authUrl: auth.href,
  planner: createPlanner({
    enabled: process.env.FORGE_HOSTED_PLANNING_ENABLED === 'true',
    key: process.env.NVIDIA_API_KEY?.trim(),
    dailyLimit: Number(process.env.FORGE_HOSTED_PLANNING_DAILY_LIMIT || 20),
  }),
})
server.requestTimeout = 15000
server.listen(3001, '127.0.0.1', () =>
  console.log(
    'Forge cloud API listening on loopback port 3001; use an HTTPS reverse proxy for staging.'
  )
)
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => server.close(() => pool.end()))
