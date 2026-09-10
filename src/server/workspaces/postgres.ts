import { randomBytes } from 'node:crypto'
import { docker, runtimeInstance } from './docker'
// Private application database. This adapter never receives model credentials.
export interface AppPostgres {
  name: string
  image: string
  url: string
}
export async function createAppPostgres(
  name: string,
  network: string,
  image: string,
  archive: string | null
): Promise<AppPostgres> {
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('Application PostgreSQL image must be an installed immutable image ID.')
  const databaseName = name + '-db',
    bootstrap = randomBytes(32).toString('hex'),
    password = randomBytes(32).toString('hex')
  await docker([
    'create',
    '--name',
    databaseName,
    '--label',
    'forge.managed=true',
    '--label',
    `forge.instance=${runtimeInstance}`,
    '--network',
    network,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user',
    'postgres',
    '--memory=512m',
    '--memory-swap=512m',
    '--cpus=1',
    '--pids-limit=64',
    '--tmpfs',
    '/var/lib/postgresql:rw,noexec,size=268435456,mode=1777',
    '--tmpfs',
    '/var/run/postgresql:rw,noexec,size=8388608,mode=1777',
    '--tmpfs',
    '/tmp:rw,noexec,size=8388608,mode=1777',
    '--env',
    'PGDATA=/var/lib/postgresql/data',
    '--env',
    `POSTGRES_PASSWORD=${bootstrap}`,
    '--env',
    'POSTGRES_DB=app',
    image,
  ])
  await docker(['start', databaseName])
  for (let i = 0; ; i++) {
    try {
      await docker([
        'exec',
        databaseName,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'app',
      ])
      break
    } catch {
      if (i === 30) throw new Error('Application PostgreSQL did not start.')
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const sql = `CREATE ROLE app_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; ALTER DATABASE app OWNER TO app_runtime; REVOKE ALL ON DATABASE postgres FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO app_runtime;`
  await docker(
    ['exec', '-i', databaseName, 'psql', '-U', 'postgres', '-d', 'app', '-v', 'ON_ERROR_STOP=1'],
    sql
  )
  if (archive) {
    if (archive.length > 11000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(archive))
      throw new Error('Invalid PostgreSQL snapshot.')
    // Archive contents execute only as the application role inside its isolated database.
    await docker(
      ['exec', '-i', databaseName, 'sh', '-c', 'base64 -d > /tmp/restore.dump'],
      archive,
      15000
    )
    await docker(
      [
        'exec',
        databaseName,
        'pg_restore',
        '-U',
        'app_runtime',
        '-d',
        'app',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '/tmp/restore.dump',
      ],
      undefined,
      30000
    )
    await docker(['exec', databaseName, 'rm', '/tmp/restore.dump'])
  }
  return {
    name: databaseName,
    image,
    url: `postgresql://app_runtime:${password}@${databaseName}:5432/app`,
  }
}
export async function snapshotAppPostgres(name: string) {
  const encoded = await docker(
    [
      'exec',
      name + '-db',
      'sh',
      '-c',
      'pg_dump -U app_runtime -d app --format=custom --no-owner --no-privileges > /tmp/snapshot.dump && base64 /tmp/snapshot.dump && rm /tmp/snapshot.dump',
    ],
    undefined,
    30000,
    11000000
  )
  const result = encoded.replace(/\s/g, '')
  if (!result || !/^[A-Za-z0-9+/]*={0,2}$/.test(result) || result.length > 11000000)
    throw new Error('Invalid PostgreSQL snapshot.')
  return result
}
