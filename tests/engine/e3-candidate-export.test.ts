import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { prepareReviewedCandidateExport, readReviewedCandidate, reviewedCandidateHashes, runCandidateExportCheck, validateCandidateArchive } from '../harness/candidate-export.ts'

describe('reviewed platform candidate export (not generated-app acceptance)', () => {
  it('roundtrips pinned20-file source through reopened immutable artifacts and concrete scanner', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-export-contract-')))
    try {
      const objects = join(root, 'objects'); await mkdir(objects, { mode: 0o700 })
      const result = await prepareReviewedCandidateExport(objects)
      expect(result.archive.artifact.backendEvidence).toBe('fixture')
      expect(Object.keys(validateCandidateArchive(result.archive.bytes)).sort()).toEqual(Object.keys(reviewedCandidateHashes).sort())
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('refuses changed, added, missing, oversized and noncanonical archive content before extraction', async () => {
    const source = Object.fromEntries((await readReviewedCandidate()).map(file => [file.path, file.bytes]))
    expect(() => validateCandidateArchive(zipSync({ ...source, 'app/page.tsx': Buffer.from('altered') }))).toThrow('Unreviewed')
    expect(() => validateCandidateArchive(zipSync({ ...source, '../escape': Buffer.from('no') }))).toThrow('Unexpected')
    const missing = { ...source }; delete missing['app/page.tsx']
    expect(() => validateCandidateArchive(zipSync(missing))).toThrow('file set')
    expect(() => validateCandidateArchive(new Uint8Array(2 * 1024 * 1024 + 1))).toThrow('cap')
    expect(() => validateCandidateArchive(zipSync(source))).toThrow('Noncanonical')
    const linkMetadata: Parameters<typeof zipSync>[0] = Object.create(null)
    for (const path of Object.keys(source).sort()) linkMetadata[path] = [source[path], {
      mtime: new Date('2000-01-01T00:00:00Z'), attrs: (path === 'app/page.tsx' ? 0o120777 : 0o100644) << 16 }]
    expect(() => validateCandidateArchive(zipSync(linkMetadata, { level: 6 }))).toThrow('Noncanonical')
  })
  it.skipIf(process.env.FORGE_RUN_CANDIDATE_EXPORT !== '1')('installs cache-only and verifies clean exported platform scaffold on exactNode24', async () => {
    const evidence = await runCandidateExportCheck()
    await writeFile(new URL('../../runner/evidence/candidate/export.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n')
    expect(evidence.cleanupConfirmed).toBe(true)
    expect(evidence.error).toBeNull()
    expect(evidence.status).toBe('passed')
  }, 900000)
})
