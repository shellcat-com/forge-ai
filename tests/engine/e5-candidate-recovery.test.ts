import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256 } from '../../engine/contracts/canonical.ts'
import { runCandidateRecovery, validateRecoveryBackup } from '../harness/candidate-recovery.ts'

describe('local candidate backup drill, never production acceptance', () => {
  it('validates complete pinned backup inventory and rejects missing/corrupt/extra/link entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-backup-validation-'))
    try {
      await mkdir(join(root, 'objects'))
      const objectPath = `objects/${sha256('fixture-key')}.blob`
      const files = [{ path: 'database.dump', bytes: Buffer.from('INERT_DUMP_NOT_EXECUTED') }, { path: objectPath, bytes: Buffer.from('INERT_BLOB') }]
      for (const file of files) await writeFile(join(root, file.path), file.bytes)
      const raw = canonicalJson({ schemaVersion: 1, origin: 'local-synthetic-recovery', files: files.map(file => ({ path: file.path, sha256: sha256(file.bytes), bytes: file.bytes.length })) })
      await writeFile(join(root, 'backup.json'), raw)
      await expect(validateRecoveryBackup(root, sha256(raw))).resolves.toMatchObject({ schemaVersion: 1 })
      await writeFile(join(root, 'database.dump'), 'WRONG')
      await expect(validateRecoveryBackup(root, sha256(raw))).rejects.toThrow('integrity')
      await writeFile(join(root, 'database.dump'), files[0].bytes)
      await writeFile(join(root, 'unexpected'), 'extra')
      await expect(validateRecoveryBackup(root, sha256(raw))).rejects.toThrow('inventory')
      await rm(join(root, 'unexpected')); await rm(join(root, objectPath))
      await expect(validateRecoveryBackup(root, sha256(raw))).rejects.toThrow('inventory')
      await symlink(join(root, 'database.dump'), join(root, objectPath))
      await expect(validateRecoveryBackup(root, sha256(raw))).rejects.toThrow('Unsafe')
      const changed = Buffer.from(await readFile(join(root, 'backup.json'))); changed[0] ^= 1
      await writeFile(join(root, 'backup.json'), changed)
      await expect(validateRecoveryBackup(root, sha256(raw))).rejects.toThrow('manifest integrity')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it.skipIf(process.env.FORGE_RUN_CANDIDATE_RECOVERY !== '1')('backs up and restores real localPostgreSQL18.6 and immutable source versions after target restart', async () => {
    const evidence = await runCandidateRecovery()
    await writeFile(new URL('../../runner/evidence/candidate/recovery.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n')
    expect(evidence.error).toBeNull()
    expect(evidence).toMatchObject({ status: 'passed', cleanupConfirmed: true, targetRestart: true, restoredArtifactReferences: true,
      committedRowsBeforeLoss: 3, retainedPreBackupRows: 2, expectedLostPostBackupRows: 1, observedLostPostBackupRows: 1, restrictedRoles: true,
      faults: { corruptedDatabase: true, corruptedArtifact: true, missingArtifact: true, changedManifest: true } })
  }, 120000)
})
