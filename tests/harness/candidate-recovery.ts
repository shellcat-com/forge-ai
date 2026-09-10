/** Local synthetic backup drill. No caller SQL/source/archive is executed and
 * no service configuration, paid infrastructure or production recovery claim. */
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { LocalSyntheticObjectBackend } from '../../engine/artifacts/local-backend.ts'
import { canonicalHash, canonicalJson, sha256 } from '../../engine/contracts/canonical.ts'
import type { TemplateManifestV1 } from '../../engine/contracts/source.ts'
import { TemplateCatalog, templateCatalogDigest } from '../../engine/generation/catalog.ts'
import { createTemplateSource, validateStoredSource } from '../../engine/generation/source.ts'
import type { StoredSource } from '../../engine/generation/source.ts'
import { validateMigrationSql } from '../../engine/validation/migrations.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { readReviewedCandidate, reviewedCandidateHashes } from './candidate-export.ts'
import { taskMigration, priorityMigration } from './synthetic-migrations.ts'
import { hash, resources, scope } from '../engine/fixtures.ts'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const backupSchema = z.strictObject({ schemaVersion: z.literal(1), origin: z.literal('local-synthetic-recovery'),
  files: z.array(z.strictObject({ path: z.string().regex(/^(?:database\.dump|objects\/[a-f0-9]{64}\.blob)$/),
    sha256: digest, bytes: z.number().int().min(1).max(20 * 1024 * 1024) })).min(2).max(128) })
export type RecoveryBackupManifest = z.infer<typeof backupSchema>
async function boundedFile(path: string, cap: number) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > cap) throw new Error('Unsafe backup file')
  const bytes = await readFile(path)
  if (bytes.length !== stat.size) throw new Error('Backup changed while reading')
  return bytes
}
/** The expected digest is captured OUTSIDE the backup. This local hash binding
 * models a trusted catalog reference; it is not an authenticated cloud catalog.
 * Validation is always completed before a pg_restore invocation. */
export async function validateRecoveryBackup(root: string, expectedManifestDigest: string): Promise<RecoveryBackupManifest> {
  digest.parse(expectedManifestDigest)
  const raw = await boundedFile(join(root, 'backup.json'), 128 * 1024)
  if (sha256(raw) !== expectedManifestDigest) throw new Error('Backup manifest integrity mismatch')
  const manifest = backupSchema.parse(JSON.parse(raw.toString('utf8')))
  if (new Set(manifest.files.map(file => file.path)).size !== manifest.files.length
    || !manifest.files.some(file => file.path === 'database.dump')) throw new Error('Backup inventory mismatch')
  const roots = (await readdir(root)).sort()
  const objectStat = await lstat(join(root, 'objects'))
  if (roots.join(',') !== 'backup.json,database.dump,objects' || !objectStat.isDirectory() || objectStat.isSymbolicLink())
    throw new Error('Unexpected backup inventory')
  const actual = ['database.dump', ...(await readdir(join(root, 'objects'))).map(file => `objects/${file}`)].sort()
  if (actual.join(',') !== manifest.files.map(file => file.path).sort().join(',')) throw new Error('Backup inventory mismatch')
  let total = 0
  for (const file of manifest.files) {
    total += file.bytes
    if (total > 32 * 1024 * 1024) throw new Error('Backup cap')
    const bytes = await boundedFile(join(root, file.path), file.bytes)
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('Backup content integrity mismatch')
  }
  return manifest
}

export async function runCandidateRecovery() {
  if (process.env.FORGE_RUN_CANDIDATE_RECOVERY !== '1') throw new Error('Candidate recovery requires explicit opt-in')
  if (!process.env.FORGE_CANDIDATE_PG18_BIN) throw new Error('Reviewed PostgreSQL18.6 bin directory required')
  const bin = await realpath(process.env.FORGE_CANDIDATE_PG18_BIN)
  // Short private path also stays within macOS Unix-socket path limits.
  const root = await realpath(await mkdtemp('/tmp/forge-recovery-'))
  const commands: { tool: string; elapsedMs: number; exitCode: number | null }[] = []
  const evidence = { schemaVersion: 1, origin: 'local-platform-candidate-recovery', status: 'failed', testedAt: new Date().toISOString(),
    host: `${process.platform}/${process.arch}`, postgres: '18.6', artifactBackendEvidence: 'fixture',
    isolationAcceptance: false, productionRecoveryAcceptance: false, providerGeneration: false,
    root, cleanupConfirmed: false, commands, toolVersions: {} as Record<string, string>, backupManifestDigest: '', sourceManifestDigest: '', templateDigest: '',
    bootstrapSha256: '', artifactCount: 0, backupBytes: 0, backupMs: 0, restoreAndRestartMs: 0,
    backupAgeAtSimulatedLossMs: 0, committedRowsBeforeLoss: 0, retainedPreBackupRows: 0, expectedLostPostBackupRows: 1, observedLostPostBackupRows: 0,
    restoredArtifactReferences: false, targetRestart: false, restrictedRoles: false,
    faults: { corruptedDatabase: false, corruptedArtifact: false, missingArtifact: false, changedManifest: false }, error: null as string | null }
  const initialized = new Set<string>()
  const run = (tool: string, args: string[], allowStatus = false) => {
    const start = Date.now()
    const result = spawnSync(join(bin, tool), args, { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: `${bin}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C', HOME: root, PSQL_HISTORY: '/dev/null' } })
    commands.push({ tool, elapsedMs: Date.now() - start, exitCode: result.status })
    if (result.error || (!allowStatus && result.status !== 0)) throw new Error(`Candidate ${tool} failed: ${result.error?.message ?? result.stderr.slice(-1000)}`)
    return { status: result.status, output: result.stdout.trim() }
  }
  const dbPath = (name: string) => join(root, name, 'data')
  const start = (name: string) => run('pg_ctl', ['-D', dbPath(name), '-l', join(root, name, 'postgres.log'),
    '-o', `-k ${join(root, name)} -h '' -p 55441`, '-w', 'start'])
  const stop = (name: string) => run('pg_ctl', ['-D', dbPath(name), '-m', 'fast', '-w', 'stop'])
  const connection = (name: string) => ['-h', join(root, name), '-p', '55441', '-U', 'forge_recovery_admin', '-d', 'forge_app']
  const sql = (name: string, query: string, database = 'forge_app') => run('psql', ['-X', '-t', '-A', ...connection(name).slice(0, -1),
    database, '-v', 'ON_ERROR_STOP=1', '-c', query]).output
  const init = async (name: string) => {
    await mkdir(join(root, name), { mode: 0o700 })
    run('initdb', ['-D', dbPath(name), '-A', 'trust', '--no-locale', '-E', 'UTF8', '-U', 'forge_recovery_admin'])
    initialized.add(name); start(name); sql(name, 'CREATE DATABASE forge_app;', 'postgres')
  }
  const cleanup = async () => {
    // Preserve files whenever process shutdown cannot be positively confirmed.
    for (const name of initialized) {
      const status = run('pg_ctl', ['-D', dbPath(name), 'status'], true).status
      if (status === 0) stop(name)
      else if (status !== 3) throw new Error(`Unconfirmed ${name} PostgreSQL cleanup; preserved ${root}`)
    }
    await rm(root, { recursive: true, force: true }); evidence.cleanupConfirmed = true
  }
  try {
    for (const tool of ['postgres', 'pg_dump', 'pg_restore']) {
      const version = run(tool, ['--version']).output
      if (version !== `${tool} (PostgreSQL) 18.6`) throw new Error('Exact PostgreSQL18.6 required')
      evidence.toolVersions[tool] = version
    }
    const reviewed = await readReviewedCandidate()
    const bootstrap = reviewed.find(file => file.path === 'app-database.sql')!.bytes
    evidence.bootstrapSha256 = sha256(bootstrap)
    if (evidence.bootstrapSha256 !== reviewedCandidateHashes['app-database.sql']) throw new Error('Unreviewed bootstrap')
    await init('source'); sql('source', Buffer.from(bootstrap).toString('utf8'))
    for (const migration of [taskMigration, priorityMigration]) sql('source', `SET ROLE forge_migrator; ${validateMigrationSql(migration).statements.join('\n')}`)
    sql('source', "SET ROLE forge_app; INSERT INTO app.tasks(id,title,priority) VALUES ('00000000-0000-4000-8000-000000000001','Pre-backup one','high'),('00000000-0000-4000-8000-000000000002','Pre-backup two','low');")
    const objects = join(root, 'objects'); await mkdir(objects, { mode: 0o700 })
    const policy = templateCommandPolicy(resources)
    const manifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
      stack: 'nextjs-strict-typescript-postgresql', releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' }, lockfileDigest: reviewedCandidateHashes['package-lock.json'],
      commandPolicyDigest: canonicalHash(policy), requiredChecks: policy.requiredChecks,
      protectedPaths: reviewed.map(file => file.path).filter(path => !path.startsWith('app/') && !path.startsWith('components/')) }
    manifest.template.digest = templateCatalogDigest(manifest, reviewed)
    const catalog = new TemplateCatalog({ manifest, files: reviewed, evidence: 'fixture' })
    const source = await createTemplateSource(new ArtifactStore(await LocalSyntheticObjectBackend.open(objects)), scope, catalog, hash)
    evidence.sourceManifestDigest = canonicalHash(source.manifest); evidence.templateDigest = manifest.template.digest
    // Fixed platform fixture metadata table exercises DB→immutable-version
    // references without pretending this is the E1 control schema.
    sql('source', "CREATE SCHEMA fixture_recovery; CREATE TABLE fixture_recovery.source(id integer PRIMARY KEY, metadata jsonb NOT NULL);")
    sql('source', `INSERT INTO fixture_recovery.source VALUES(1,'${JSON.stringify(source).replaceAll("'", "''")}'::jsonb);`)
    const backup = join(root, 'backup'); await mkdir(backup, { mode: 0o700 }); await mkdir(join(backup, 'objects'), { mode: 0o700 })
    const backupStart = Date.now()
    run('pg_dump', [...connection('source'), '--format=custom', '--file', join(backup, 'database.dump')])
    for (const name of await readdir(objects)) await writeFile(join(backup, 'objects', name), await boundedFile(join(objects, name), 2 * 1024 * 1024), { flag: 'wx', mode: 0o600 })
    const backupFiles = ['database.dump', ...(await readdir(join(backup, 'objects'))).map(name => `objects/${name}`)].sort()
    const backupManifest: RecoveryBackupManifest = { schemaVersion: 1, origin: 'local-synthetic-recovery', files: await Promise.all(backupFiles.map(async path => {
      const bytes = await boundedFile(join(backup, path), 20 * 1024 * 1024); return { path, sha256: sha256(bytes), bytes: bytes.length }
    })) }
    const serialized = canonicalJson(backupManifest); evidence.backupManifestDigest = sha256(serialized)
    await writeFile(join(backup, 'backup.json'), serialized, { flag: 'wx', mode: 0o600 })
    await validateRecoveryBackup(backup, evidence.backupManifestDigest)
    evidence.backupMs = Date.now() - backupStart; evidence.backupBytes = backupManifest.files.reduce((sum, file) => sum + file.bytes, 0)
    evidence.artifactCount = backupManifest.files.length - 1
    // Controlled corruption is reverted before the trusted backup is used.
    const corrupt = async (path: string, missing = false) => {
      const full = join(backup, path); const bytes = await readFile(full)
      if (missing) await rm(full); else await writeFile(full, Buffer.from('CORRUPTED_LOCAL_FIXTURE'), { mode: 0o600 })
      let rejected = false
      try { await validateRecoveryBackup(backup, evidence.backupManifestDigest) } catch { rejected = true }
      finally { await writeFile(full, bytes, { mode: 0o600 }) }
      if (!rejected) throw new Error('Corrupted backup accepted')
      return true
    }
    evidence.faults.corruptedDatabase = await corrupt('database.dump')
    evidence.faults.corruptedArtifact = await corrupt(backupFiles.find(path => path.startsWith('objects/'))!)
    evidence.faults.missingArtifact = await corrupt(backupFiles.find(path => path.startsWith('objects/'))!, true)
    evidence.faults.changedManifest = await corrupt('backup.json')
    sql('source', "SET ROLE forge_app; INSERT INTO app.tasks(id,title) VALUES('00000000-0000-4000-8000-000000000003','After backup, deliberately unrecoverable');")
    evidence.committedRowsBeforeLoss = Number(sql('source', 'SELECT count(*) FROM app.tasks;'))
    if (evidence.committedRowsBeforeLoss !== 3) throw new Error('Pre-loss row count mismatch')
    stop('source'); const restoreStart = Date.now()
    evidence.backupAgeAtSimulatedLossMs = restoreStart - backupStart
    // Remove original artifacts before recovery so validation cannot accidentally
    // resolve source references against surviving original files.
    await rm(objects, { recursive: true })
    await validateRecoveryBackup(backup, evidence.backupManifestDigest)
    await init('target'); sql('target', Buffer.from(bootstrap).toString('utf8'))
    run('pg_restore', [...connection('target'), '--clean', '--if-exists', '--exit-on-error', '--single-transaction', join(backup, 'database.dump')])
    const restoredObjects = join(root, 'restored-objects'); await mkdir(restoredObjects, { mode: 0o700 })
    for (const file of backupManifest.files.filter(file => file.path.startsWith('objects/')))
      await writeFile(join(restoredObjects, file.path.slice(8)), await boundedFile(join(backup, file.path), file.bytes), { flag: 'wx', mode: 0o600 })
    stop('target'); start('target'); evidence.targetRestart = true
    const rows = sql('target', "SET ROLE forge_app; SELECT title||':'||priority FROM app.tasks ORDER BY id;")
    if (rows !== 'SET\nPre-backup one:high\nPre-backup two:low') throw new Error('Restored task state mismatch')
    evidence.retainedPreBackupRows = 2
    evidence.observedLostPostBackupRows = evidence.committedRowsBeforeLoss - evidence.retainedPreBackupRows
    const restored = JSON.parse(sql('target', 'SELECT metadata::text FROM fixture_recovery.source WHERE id=1;')) as StoredSource
    await validateStoredSource(new ArtifactStore(await LocalSyntheticObjectBackend.open(restoredObjects)), scope, restored, catalog)
    if (canonicalHash(restored.manifest) !== evidence.sourceManifestDigest) throw new Error('Restored source manifest mismatch')
    evidence.restoredArtifactReferences = true
    const roleFlags = sql('target', "SELECT rolname||':'||rolcanlogin||':'||rolsuper||':'||rolcreatedb||':'||rolcreaterole||':'||rolbypassrls FROM pg_roles WHERE rolname IN ('forge_app','forge_migrator') ORDER BY rolname;")
    if (roleFlags !== 'forge_app:false:false:false:false:false\nforge_migrator:false:false:false:false:false') throw new Error('Restored role mismatch')
    evidence.restrictedRoles = true; evidence.restoreAndRestartMs = Date.now() - restoreStart; evidence.status = 'passed'
  } catch (error) { evidence.error = error instanceof Error ? error.message : 'Candidate recovery failed' }
  finally { await cleanup() }
  return evidence
}
