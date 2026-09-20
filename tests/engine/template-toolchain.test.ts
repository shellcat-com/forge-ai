import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { TemplateCatalog, templateCatalogDigest } from '../../engine/generation/catalog.ts'
import { sha256, canonicalHash } from '../../engine/contracts/canonical.ts'
import type { TemplateManifestV1 } from '../../engine/contracts/source.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { readReviewedCandidate, reviewedCandidateHashes } from '../harness/candidate-export.ts'
import { referenceCorpus } from '../harness/reference-apps.ts'
import { taskMigration, priorityMigration } from '../harness/synthetic-migrations.ts'
import { templateInputDigest } from '../../templates/next-postgres-v1/toolchain/inputs.ts'
import { hash, resources } from './fixtures.ts'
// Synthetic source manifests verify immutability; no provider/runtime acceptance.
describe('Task 03 protected export inputs', () => {
  it('retains byte-identical reference migrations and adds portfolio without waiving DB acceptance', async () => {
    const read = (path: string) => readFile(new URL(`../../templates/next-postgres-v1/${path}`, import.meta.url), 'utf8')
    expect(await read('reference/migrations/0001_tasks.sql')).toBe(taskMigration)
    expect(await read('reference/migrations/0002_priority.sql')).toBe(priorityMigration)
    const portfolio = await read('reference/portfolio.json')
    expect(sha256(portfolio)).toBe(referenceCorpus.portfolio.specificationSha256)
    expect(referenceCorpus.portfolio.engineDatabaseAcceptanceStillRequired).toBe(true)
    expect(referenceCorpus.taskBoard.additiveBrief).toContain('Preserve previous tasks')
  })
  it('computes image input before image/catalog identity, deterministically and without a cycle', async () => {
    const files = await readReviewedCandidate()
    const input = templateInputDigest(files)
    expect(templateInputDigest([...files].reverse())).toBe(input)
    const image = `sha256:${canonicalHash({ schemaVersion: 1, templateInputsDigest: input, kernelSha256: hash })}`
    const policy = templateCommandPolicy(resources)
    const finalManifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: image },
      stack: 'nextjs-strict-typescript-postgresql', releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' },
      lockfileDigest: reviewedCandidateHashes['package-lock.json'], commandPolicyDigest: canonicalHash(policy), requiredChecks: policy.requiredChecks,
      protectedPaths: files.map(f => f.path).filter(p => !p.startsWith('app/') && !p.startsWith('components/')) }
    const finalDigest = templateCatalogDigest(finalManifest, files)
    finalManifest.template.digest = finalDigest
    expect(templateCatalogDigest(finalManifest, files)).toBe(finalDigest)
    expect(new TemplateCatalog({ manifest: finalManifest, files, evidence: 'fixture' }).manifest.template.digest).toBe(finalDigest)
    expect(templateInputDigest(files)).toBe(input)
    const changed = files.map(f => ({ ...f, bytes: f.bytes.slice() }))
    changed[0].bytes[0] ^= 1
    expect(templateInputDigest(changed)).not.toBe(input)
    expect(`sha256:${canonicalHash({ schemaVersion: 1, templateInputsDigest: templateInputDigest(changed), kernelSha256: hash })}`).not.toBe(image)
    expect(() => templateInputDigest([...files, files[0]])).toThrow('Duplicate')
  })
  it('rejects edits/deletions of every protected check/build/bootstrap file and new config paths', async () => {
    const files = await readReviewedCandidate(), policy = templateCommandPolicy(resources)
    const manifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
      stack: 'nextjs-strict-typescript-postgresql', releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' },
      lockfileDigest: reviewedCandidateHashes['package-lock.json'], commandPolicyDigest: canonicalHash(policy), requiredChecks: policy.requiredChecks,
      protectedPaths: files.map(f => f.path).filter(p => !p.startsWith('app/') && !p.startsWith('components/')) }
    manifest.template.digest = templateCatalogDigest(manifest, files)
    const catalog = new TemplateCatalog({ manifest, files, evidence: 'fixture' })
    // validateSource only needs immutable source-file descriptors here.
    const source = { template: manifest.template, commandPolicyDigest: manifest.commandPolicyDigest,
      files: files.map(f => ({ path: f.path, mediaType: f.mediaType, sha256: sha256(f.bytes), bytes: f.bytes.length })) }
    type Input = Parameters<TemplateCatalog['validateSource']>[0]
    for (const path of manifest.protectedPaths) {
      const changed = structuredClone(source)
      changed.files.find(f => f.path === path)!.sha256 = 'b'.repeat(64)
      expect(() => catalog.validateSource(changed as Input)).toThrow('Template-owned')
      expect(() => catalog.validateSource({ ...source, files: source.files.filter(f => f.path !== path) } as Input)).toThrow('Template-owned')
    }
    expect(() => catalog.validateSource({ ...source, files: [...source.files, { path: 'vitest.config.ts', mediaType: 'text/typescript', sha256: hash, bytes: 1 }] } as Input)).toThrow('outside immutable')
  })
})
