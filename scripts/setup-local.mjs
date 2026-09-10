import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, appendFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
function docker(args, env = process.env) {
  const result = spawnSync('docker', args, {
    env,
    encoding: 'utf8',
    timeout: 20000,
  })
  if (result.status !== 0)
    throw new Error('Docker setup failed. Check Docker Desktop and port 55432.')
  return result.stdout.trim()
}
if (existsSync('.env.local') && /^DATABASE_URL=/m.test(readFileSync('.env.local', 'utf8'))) {
  console.log('DATABASE_URL already configured; preserving it.')
} else {
  const existing = docker([
    'ps',
    '-a',
    '--filter',
    'name=^forge-ai-postgres-local$',
    '--format',
    '{{.Names}}',
  ])
  if (existing)
    throw new Error(
      'A Forge database container already exists but its local configuration is missing. Restore .env.local before continuing.'
    )
  const secret = randomBytes(32).toString('hex')
  docker(
    [
      'run',
      '-d',
      '--name',
      'forge-ai-postgres-local',
      '--label',
      'forge.database=true',
      '--publish',
      '127.0.0.1:55432:5432',
      '--memory=384m',
      '--cpus=1',
      '--pids-limit=128',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_USER=forge',
      '--env',
      'POSTGRES_DB=forge',
      '--mount',
      'type=volume,source=forge-ai-postgres-local,target=/var/lib/postgresql/data',
      'postgres:17-alpine',
    ],
    { ...process.env, POSTGRES_PASSWORD: secret }
  )
  appendFileSync(
    '.env.local',
    `\nDATABASE_URL=postgresql://forge:${secret}@127.0.0.1:55432/forge\n`,
    { mode: 0o600 }
  )
  chmodSync('.env.local', 0o600)
  console.log('Created dedicated local PostgreSQL. Configuration stored privately in .env.local.')
}

for (let attempt = 0; attempt < 30; attempt++) {
  const result = spawnSync(
    'docker',
    ['exec', 'forge-ai-postgres-local', 'pg_isready', '-U', 'forge', '-d', 'forge'],
    { stdio: 'ignore', timeout: 3000 }
  )
  if (result.status === 0) {
    console.log('PostgreSQL is ready.')
    break
  }
  if (attempt === 29) throw new Error('PostgreSQL did not become ready. Inspect Docker Desktop.')
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

const localConfig = readFileSync('.env.local', 'utf8')
if (!/^FORGE_BYOK_KEYRING=/m.test(localConfig) && !/^FORGE_BYOK_ACTIVE_KEY=/m.test(localConfig)) {
  const keyring = JSON.stringify({ v1: randomBytes(32).toString('hex') })
  appendFileSync('.env.local', `\nFORGE_BYOK_ACTIVE_KEY=v1\nFORGE_BYOK_KEYRING='${keyring}'\n`, {
    mode: 0o600,
  })
  chmodSync('.env.local', 0o600)
  console.log(
    'Created a private local credential wrapping key. Back up .env.local separately from the database.'
  )
} else {
  console.log('Preserving the configured BYOK keyring. Both BYOK variables must be set.')
}
