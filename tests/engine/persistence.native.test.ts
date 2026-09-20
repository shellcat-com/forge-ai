import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startNativePostgres } from './native-postgres.ts'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import type { ArtifactRef } from '../../engine/artifacts/store.ts'
import {
  EncryptedObjectBackend,
  EnvironmentObjectKeys,
} from '../../engine/artifacts/encrypted-backend.ts'
import {
  lockObjectForAdoption,
  PostgresCiphertextTransport,
} from '../../engine/artifacts/postgres-backend.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { FixtureIdentityAdapter, SessionService } from '../../engine/control/identity.ts'
import { ControlService } from '../../engine/control/service.ts'
import { ControlWorker } from '../../engine/control/worker.ts'
import { FixtureStageAdapter } from '../../engine/control/fixture-stage.ts'

let db: Awaited<ReturnType<typeof startNativePostgres>>
let writer: PostgresCiphertextTransport,
  reader: PostgresCiphertextTransport,
  maintenance: PostgresCiphertextTransport
let store: ArtifactStore
let recoveryEvidence: Record<string, unknown> | undefined
const testKey = randomBytes(32).toString('hex')
const keys = new EnvironmentObjectKeys(
  { v1: 'FORGE_OBJECT_KEY_V1' },
  { FORGE_OBJECT_KEY_V1: testKey }
)
const scope = { workspaceId: randomUUID(), projectId: randomUUID(), jobId: randomUUID() }
const run = (bin: string, args: string[]) => {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 30000,
    env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' },
  })
  if (result.status !== 0 || result.error)
    throw new Error(`Synthetic ${bin} failed: ${result.error?.message ?? result.stderr}`)
  return result.stdout
}
beforeAll(async () => {
  db = await startNativePostgres()
  await db.admin.query(
    await readFile(
      new URL('../../engine/migrations/0003_immutable_source_bridge.sql', import.meta.url),
      'utf8'
    )
  )
  // Migration runs with CREATEROLE + inherited control ownership, without the
  // SUPERUSER attribute. A hosted role lacking CREATEROLE remains a live gate.
  await db.admin.query(
    'CREATE ROLE object_schema_migrator LOGIN CREATEROLE; GRANT e1_migration_owner TO object_schema_migrator'
  )
  const migrator = new pg.Pool({ ...db.config, user: 'object_schema_migrator' })
  try {
    expect(
      (await migrator.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0]
        .rolsuper
    ).toBe(false)
    await migrator.query(
      await readFile(
        new URL('../../engine/artifacts/postgres-schema.proposal.sql', import.meta.url),
        'utf8'
      )
    )
  } finally {
    await migrator.end()
  }
  await db.admin
    .query(`CREATE ROLE object_writer_test LOGIN; GRANT forge_object_writer TO object_writer_test;
   CREATE ROLE object_reader_test LOGIN; GRANT forge_object_reader TO object_reader_test;
   CREATE ROLE object_maintenance_test LOGIN; GRANT forge_object_maintenance TO object_maintenance_test;
   INSERT INTO forge_objects.policy VALUES(true,3600,86400,86400)`)
  writer = new PostgresCiphertextTransport(
    { ...db.config, user: 'object_writer_test' },
    'forge_object_writer'
  )
  reader = new PostgresCiphertextTransport(
    { ...db.config, user: 'object_reader_test' },
    'forge_object_reader'
  )
  maintenance = new PostgresCiphertextTransport(
    { ...db.config, user: 'object_maintenance_test' },
    'forge_object_maintenance'
  )
  await Promise.all([writer.check(), reader.check(), maintenance.check()])
  store = new ArtifactStore(new EncryptedObjectBackend(writer, keys, 'v1'))
  await db.admin.query(
    "INSERT INTO forge_control.workspaces(id,name) VALUES($1,'Persistence fixture')",
    [scope.workspaceId]
  )
  await db.admin.query(
    `INSERT INTO forge_control.projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest)
   VALUES($1,$2,'Persistence fixture','Synthetic persistence fixture project','editorial-product',1,'next-postgres-v1',$3)`,
    [scope.projectId, scope.workspaceId, 'a'.repeat(64)]
  )
}, 30000)
afterAll(async () => {
  await Promise.all([writer?.close(), reader?.close(), maintenance?.close()])
  await db?.close()
  if (recoveryEvidence && process.env.FORGE_TASK06_EVIDENCE_FILE)
    await writeFile(
      process.env.FORGE_TASK06_EVIDENCE_FILE,
      JSON.stringify({ ...recoveryEvidence, cleanupConfirmed: true }, null, 2) + '\n'
    )
})
async function age(ref: ArtifactRef) {
  // Explicit fixture time travel by migration owner; never a runtime privilege.
  await db.admin.query(
    "UPDATE forge_objects.versions SET created_at=clock_timestamp()-interval '2 days' WHERE object_key=$1",
    [ref.storageKey]
  )
}
async function waitForLock(user: string) {
  for (let i = 0; i < 100; i++) {
    const { rowCount } = await db.admin.query(
      "SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event='advisory'",
      [user]
    )
    if (rowCount) return
    await delay(10)
  }
  throw new Error('Concurrent operation did not wait on the adoption lock')
}
async function adopt(ref: ArtifactRef) {
  await db.worker.scoped(ref.workspaceId, async (c) => {
    await lockObjectForAdoption(c, ref)
    await c.query(
      `INSERT INTO forge_control.artifacts(id,workspace_id,project_id,kind,object_key,object_version,sha256,bytes,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'available')`,
      [
        ref.id,
        ref.workspaceId,
        ref.projectId,
        ref.kind,
        ref.storageKey,
        ref.storageVersion,
        ref.sha256,
        ref.bytes,
      ]
    )
  })
}
function child(mode: 'write' | 'read', ref?: ArtifactRef) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', new URL('../harness/persistence-child.ts', import.meta.url).pathname],
    {
      encoding: 'utf8',
      timeout: 20000,
      env: { PATH: process.env.PATH, LANG: 'C' },
      input: JSON.stringify({
        mode,
        ref,
        scope,
        testKey,
        synthetic: 'synthetic restart source',
        config: {
          ...db.config,
          user: mode === 'write' ? 'object_writer_test' : 'object_reader_test',
        },
      }),
    }
  )
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

it('stores encrypted bytes across actual process exits; rejects versions, tenants and excessive DB authority', async () => {
  const ref = child('write') as ArtifactRef
  expect(child('read', ref)).toEqual({ sha256: ref.sha256, bytes: ref.bytes })
  expect(child('read', ref)).toEqual({ sha256: ref.sha256, bytes: ref.bytes })
  const reopened = new ArtifactStore(new EncryptedObjectBackend(reader, keys, 'v1'))
  await expect(reopened.read({ ...scope, workspaceId: randomUUID() }, ref)).rejects.toThrow(
    'unavailable'
  )
  await expect(reopened.read(scope, { ...ref, storageVersion: randomUUID() })).rejects.toThrow(
    'unavailable'
  )
  await expect(reopened.read(scope, { ...ref, sha256: 'b'.repeat(64) })).rejects.toThrow(
    'integrity'
  )
  const raw = (
    await db.admin.query('SELECT ciphertext FROM forge_objects.versions WHERE object_key=$1', [
      ref.storageKey,
    ])
  ).rows[0].ciphertext
  expect(raw.includes(Buffer.from('synthetic restart source'))).toBe(false)
  const c = await reader.pool.connect()
  try {
    await c.query('BEGIN; SET LOCAL ROLE forge_object_reader')
    await c.query(
      "SELECT set_config('forge.object_workspace',$1,true),set_config('forge.object_project',$2,true)",
      [randomUUID(), scope.projectId]
    )
    expect((await c.query('SELECT * FROM forge_objects.versions')).rowCount).toBe(0)
    await expect(
      c.query("UPDATE forge_objects.versions SET ciphertext='x'::bytea")
    ).rejects.toThrow('permission denied')
  } finally {
    await c.query('ROLLBACK')
    c.release()
  }
  await expect(maintenance.read(ref.storageKey, ref.storageVersion)).rejects.toThrow('unavailable')
  const privileged = new PostgresCiphertextTransport(
    { ...db.config, user: 'e1_migration_owner' },
    'forge_object_writer'
  )
  try {
    await expect(privileged.check()).rejects.toThrow('role')
  } finally {
    await privileged.close()
  }
  await expect(writer.retire(ref.storageKey, ref.storageVersion)).rejects.toThrow('unavailable')
}, 30000)

it('serializes adoption versus orphan retirement in the E1 transaction and keeps tombstones after purge', async () => {
  const ref = await store.put(scope, 'source-blob', Buffer.from('live referenced fixture'))
  await age(ref)
  const c = await db.worker.pool.connect()
  let retire: Promise<boolean> | undefined
  try {
    await c.query('BEGIN; SET LOCAL ROLE forge_control_worker')
    await c.query("SELECT set_config('forge.workspace_id',$1,true)", [scope.workspaceId])
    await lockObjectForAdoption(c, ref)
    retire = maintenance.retire(ref.storageKey, ref.storageVersion)
    await waitForLock('object_maintenance_test')
    await c.query(
      `INSERT INTO forge_control.artifacts(id,workspace_id,project_id,kind,object_key,object_version,sha256,bytes,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'available')`,
      [
        ref.id,
        ref.workspaceId,
        ref.projectId,
        ref.kind,
        ref.storageKey,
        ref.storageVersion,
        ref.sha256,
        ref.bytes,
      ]
    )
    await c.query('COMMIT')
    expect(await retire).toBe(false)
  } finally {
    await c.query('ROLLBACK')
    c.release()
    await retire
  }
  expect(Buffer.from(await store.read(scope, ref)).toString()).toBe('live referenced fixture')
  const orphan = await store.put(scope, 'source-blob', Buffer.from('orphan fixture'))
  expect(await maintenance.retire(orphan.storageKey, orphan.storageVersion)).toBe(false)
  await age(orphan)
  const m = await maintenance.pool.connect()
  let rejectedAdoption: Promise<void> | undefined, waitingPurge: Promise<boolean> | undefined
  try {
    await m.query('BEGIN; SET LOCAL ROLE forge_object_maintenance')
    expect(
      (
        await m.query('SELECT forge_objects.retire($1,$2) AS done', [
          orphan.storageKey,
          orphan.storageVersion,
        ])
      ).rows[0].done
    ).toBe(true)
    rejectedAdoption = expect(adopt(orphan)).rejects.toThrow('unavailable')
    waitingPurge = maintenance.purge(orphan.storageKey, orphan.storageVersion)
    await waitForLock('e1_worker')
    await waitForLock('object_maintenance_test')
    await m.query('COMMIT')
    await rejectedAdoption
    expect(await waitingPurge).toBe(false)
  } finally {
    await m.query('ROLLBACK')
    m.release()
    await rejectedAdoption
    await waitingPurge
  }
  await expect(store.read(scope, orphan)).rejects.toThrow('unavailable')
  expect(await maintenance.purge(orphan.storageKey, orphan.storageVersion)).toBe(false)
  await db.admin.query(
    "UPDATE forge_objects.versions SET retired_at=clock_timestamp()-interval '2 days',purge_after=clock_timestamp()-interval '1 day' WHERE object_key=$1",
    [orphan.storageKey]
  )
  expect(await maintenance.purge(orphan.storageKey, orphan.storageVersion)).toBe(true)
  expect(await maintenance.purge(orphan.storageKey, orphan.storageVersion)).toBe(true)
  const tombstone = (
    await db.admin.query(
      'SELECT state,ciphertext FROM forge_objects.versions WHERE object_key=$1',
      [orphan.storageKey]
    )
  ).rows[0]
  expect(tombstone).toEqual({ state: 'purged', ciphertext: null })
  await expect(
    new EncryptedObjectBackend(writer, keys, 'v1').createOnly(
      orphan.storageKey,
      Buffer.from('late retry')
    )
  ).rejects.toThrow('unavailable')
  const sweep = await maintenance.sweep()
  expect(sweep.failed).toBe(0)
  expect(sweep.retained).toBeGreaterThan(0)
})

it('requires project deletion and retention before retiring referenced objects', async () => {
  const deletingScope = { ...scope, projectId: randomUUID() }
  await db.admin.query(
    `INSERT INTO forge_control.projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest)
   VALUES($1,$2,'Deletion fixture','Synthetic persistence deletion fixture','editorial-product',1,'next-postgres-v1',$3)`,
    [deletingScope.projectId, scope.workspaceId, 'a'.repeat(64)]
  )
  const ref = await store.put(deletingScope, 'source-blob', Buffer.from('delete fixture'))
  await age(ref)
  await adopt(ref)
  expect(await maintenance.retire(ref.storageKey, ref.storageVersion)).toBe(false)
  await db.admin.query(
    'UPDATE forge_control.projects SET deleting_at=clock_timestamp() WHERE id=$1',
    [deletingScope.projectId]
  )
  expect(await maintenance.retire(ref.storageKey, ref.storageVersion)).toBe(false)
  await db.admin.query(
    "UPDATE forge_control.projects SET deleting_at=clock_timestamp()-interval '2 days' WHERE id=$1",
    [deletingScope.projectId]
  )
  expect(await maintenance.retire(ref.storageKey, ref.storageVersion)).toBe(true)
  await expect(store.read(deletingScope, ref)).rejects.toThrow('unavailable')
})

it('restores control jobs and every available encrypted version into a separate target with measured synthetic loss', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forge-task06-backup-'))
  const targetName = 'task06_restore_target'
  let target: pg.Pool | undefined, restoredReader: PostgresCiphertextTransport | undefined
  try {
    // Actual E1 service admits two simultaneous synthetic jobs; no provider calls.
    const identity = await FixtureIdentityAdapter.create(),
      sessions = new SessionService(db.api, identity, randomBytes(32), 'http://127.0.0.1:3000')
    const service = new ControlService(db.api, sessions, true),
      user = randomUUID(),
      workspace = randomUUID()
    await db.admin.query(
      'INSERT INTO forge_control.users(id,oidc_issuer,oidc_subject) VALUES($1,$2,$3)',
      [user, identity.issuer, user]
    )
    await db.admin.query(
      "INSERT INTO forge_control.workspaces(id,name) VALUES($1,'Backup synthetic jobs')",
      [workspace]
    )
    await db.admin.query(
      "INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [workspace, user]
    )
    await db.admin.query(
      "INSERT INTO forge_control.workspace_quotas(workspace_id,period_start,limit_micros,max_active_jobs,max_previews) VALUES($1,date_trunc('day',now()),1000,10,2)",
      [workspace]
    )
    const b = sessions.bootstrap(),
      login = await sessions.login(b.cookie, randomUUID(), {
        schemaVersion: 1,
        returnPath: '/#/projects',
        bootstrapNonce: b.nonce,
      })
    const code = await identity.issueCode(login.authorizationUrl, user),
      session = await sessions.callback(b.cookie, code.state, code.code)
    const projects = await Promise.all(
      [1, 2].map(async (n) => {
        const r = await service.createProject(
          session.token,
          workspace,
          session.csrfToken,
          randomUUID(),
          {
            schemaVersion: 1,
            name: `Backup ${n}`,
            brief: 'Synthetic durable backup job fixture.',
            presetId: 'editorial-product',
            presetVersion: 1,
            templateId: 'next-postgres-v1',
          }
        )
        return (r.body.project as { id: string }).id
      })
    )
    const admitted = await Promise.all(
      projects.map((p) =>
        service.admit(session.token, p, session.csrfToken, randomUUID(), {
          schemaVersion: 1,
          kind: 'generate',
          baseSnapshotId: null,
          baseRevision: 1,
          instruction: 'Synthetic durable backup job fixture.',
          modelPolicyId: 'fixture-v1',
          maxCostMicros: 10,
        })
      )
    )
    expect(admitted).toHaveLength(2)
    await Promise.all([
      new ControlWorker(db.worker, new FixtureStageAdapter()).runOnce(),
      new ControlWorker(db.worker, new FixtureStageAdapter()).runOnce(),
    ])
    const refs: ArtifactRef[] = []
    for (const p of projects) {
      const ref = await store.put(
        { workspaceId: workspace, projectId: p, jobId: randomUUID() },
        'source-blob',
        Buffer.from('backup source fixture')
      )
      await adopt(ref)
      refs.push(ref)
    }
    const authorizedRead = (ref: ArtifactRef) =>
      db.api.resource(session.token, ref.id, 'artifact', 'viewer', async () =>
        store.read(
          { workspaceId: ref.workspaceId, projectId: ref.projectId, jobId: ref.jobId },
          ref
        )
      )
    expect(sha256(await authorizedRead(refs[0]))).toBe(refs[0].sha256)
    // Valid session for this workspace cannot authorize the earlier tenant's artifact.
    const foreign = (
      await db.admin.query('SELECT id FROM forge_control.artifacts WHERE workspace_id=$1 LIMIT 1', [
        scope.workspaceId,
      ])
    ).rows[0]
    await expect(
      db.api.resource(session.token, foreign.id, 'artifact', 'viewer', async () => 'not reached')
    ).rejects.toThrow()
    await db.admin.query(
      'DELETE FROM forge_control.memberships WHERE workspace_id=$1 AND user_id=$2',
      [workspace, user]
    )
    await expect(authorizedRead(refs[0])).rejects.toThrow()
    const beforeCount = Number(
      (await db.admin.query('SELECT count(*) AS n FROM forge_control.jobs')).rows[0].n
    )
    const dump = join(dir, 'control.dump'),
      backupStarted = Date.now()
    run('pg_dump', [
      '-h',
      db.config.host,
      '-p',
      String(db.config.port),
      '-U',
      'e1_migration_owner',
      '-Fc',
      '-f',
      dump,
      'postgres',
    ])
    const bytes = await readFile(dump),
      digest = sha256(bytes)
    // An intentional committed post-backup change is missing after restore.
    const lostRef = await store.put(scope, 'source-blob', Buffer.from('post-backup synthetic loss'))
    const lossAt = Date.now(),
      restoreStarted = performance.now()
    await db.admin.query(`CREATE DATABASE ${targetName}`)
    expect(sha256(await readFile(dump))).toBe(digest)
    run('pg_restore', [
      '-h',
      db.config.host,
      '-p',
      String(db.config.port),
      '-U',
      'e1_migration_owner',
      '--exit-on-error',
      '--single-transaction',
      '-d',
      targetName,
      dump,
    ])
    target = new pg.Pool({ ...db.config, database: targetName, user: 'e1_migration_owner' })
    restoredReader = new PostgresCiphertextTransport(
      { ...db.config, database: targetName, user: 'object_reader_test' },
      'forge_object_reader'
    )
    await restoredReader.check()
    const restoredStore = new ArtifactStore(new EncryptedObjectBackend(restoredReader, keys, 'v1'))
    const available = (
      await target.query(
        "SELECT object_key,version FROM forge_objects.versions WHERE state='available' ORDER BY object_key"
      )
    ).rows
    const backend = new EncryptedObjectBackend(restoredReader, keys, 'v1')
    for (const row of available) await backend.readVersion(row.object_key, row.version)
    for (const ref of refs)
      expect(
        sha256(
          await restoredStore.read(
            { workspaceId: ref.workspaceId, projectId: ref.projectId, jobId: ref.jobId },
            ref
          )
        )
      ).toBe(ref.sha256)
    const liveRefs = (
      await target.query(`SELECT a.object_key,a.object_version,a.sha256,a.bytes FROM forge_control.artifacts a
      JOIN forge_control.projects p ON p.id=a.project_id JOIN forge_objects.versions o ON o.object_key=a.object_key
      WHERE p.deleting_at IS NULL AND a.status='available'`)
    ).rows
    for (const r of liveRefs) {
      const content = await backend.readVersion(r.object_key, r.object_version)
      expect(sha256(content)).toBe(r.sha256)
      expect(content.length).toBe(Number(r.bytes))
    }
    expect(
      Number((await target.query('SELECT count(*) AS n FROM forge_control.jobs')).rows[0].n)
    ).toBe(beforeCount)
    expect(
      (
        await target.query('SELECT 1 FROM forge_objects.versions WHERE object_key=$1', [
          lostRef.storageKey,
        ])
      ).rowCount
    ).toBe(0)
    await expect(
      restoredStore.read(
        { workspaceId: randomUUID(), projectId: refs[0].projectId, jobId: refs[0].jobId },
        refs[0]
      )
    ).rejects.toThrow('unavailable')
    const rtoMs = Math.ceil(performance.now() - restoreStarted)
    recoveryEvidence = {
      schemaVersion: 1,
      origin: 'local-native-synthetic',
      hostedBackupAccepted: false,
      postgres: db.version,
      sourceAndTarget: 'separate databases in one disposable socket-only cluster',
      backupBytes: bytes.length,
      backupSha256: digest,
      restoredJobs: beforeCount,
      verifiedAvailableVersions: available.length,
      verifiedLiveObjectReferences: liveRefs.length,
      fixtureInlineArtifactPayloads:
        'preserved by full dump, separate from encrypted object denominator',
      observedLostPostBackupObjects: 1,
      expectedLostPostBackupObjects: 1,
      localRestoreVerificationMs: rtoMs,
      backupAgeAtSimulatedLossMs: lossAt - backupStarted,
      detectionAndProvisioningIncluded: false,
      walReplay: false,
      processRestart: 'separate write/read child processes',
      retentionTimeTravel: 'migration-owner-only synthetic timestamps',
    }
    expect(rtoMs).toBeGreaterThan(0)
  } finally {
    await restoredReader?.close()
    await target?.end()
    await db.admin.query(`DROP DATABASE IF EXISTS ${targetName}`)
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
