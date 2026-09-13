/** Cross-track contracts with explicit fixture authority/host only. No generated
 * app code executes. Requires the committed E2/E3 worker snapshots. */
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { unzipSync } from 'fflate'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import * as sourceApi from '../../engine/generation/source.ts'
import * as catalogApi from '../../engine/generation/catalog.ts'
import * as artifactApi from '../../engine/artifacts/store.ts'
import type { TemplateManifestV1 } from '../../engine/contracts/source.ts'
import * as brokerApi from '../../runner/broker.ts'
import { applyApprovedMigrations } from '../../runner/app-database.ts'
import * as authApi from '../../runner/auth.ts'
import * as journalApi from '../../runner/journal.ts'
import * as policyApi from '../../templates/next-postgres-v1/policy.ts'
import { LocalSyntheticObjectBackend } from '../../engine/artifacts/local-backend.ts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ExecutionReviewV1 } from '../../engine/contracts/review.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { validatePassingVerification } from '../../engine/contracts/review.ts'
import { sourceExportScanner } from '../../engine/validation/secrets.ts'
import { validateMigrationSql } from '../../engine/validation/migrations.ts'
import { taskMigration } from '../harness/synthetic-migrations.ts'
import { descriptor as descriptorFixture, approval as approvalFixture, context as contextFixture, plan as planFixture, resources, hash, scope, id, now, expiresAt } from './fixtures.ts'

async function fixture(storeOverride?: ArtifactStore) {
  const policy = policyApi.templateCommandPolicy(resources)
  const encode = (path: string, text: string): catalogApi.CatalogFile => ({ path, mediaType: path.endsWith('.json') ? 'application/json' : path.endsWith('.tsx') ? 'text/typescript' : 'text/plain', bytes: Buffer.from(text) })
  const files = [encode('package.json', '{"dependencies":{"next":"1.0.0"}}'),
    encode('package-lock.json', '{"lockfileVersion":3,"packages":{"":{},"node_modules/next":{"version":"1.0.0","resolved":"https://registry.npmjs.org/next/-/next-1.0.0.tgz","integrity":"sha512-AAAA"}}}'),
    encode('tsconfig.json', '{"compilerOptions":{"strict":true}}'), encode('README.md', 'Synthetic source integration; not a runnable release.'), encode('.env.example', 'APP_DATABASE_URL=REPLACE_ME'), encode('app/page.tsx', 'export default function Page() { return null }')]
  const manifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` }, stack: 'nextjs-strict-typescript-postgresql', releases: { next: '1.0.0', node: '1.0.0', postgres: '1.0.0' }, lockfileDigest: sha256(files[1].bytes), commandPolicyDigest: canonicalHash(policy), requiredChecks: policy.requiredChecks, protectedPaths: files.filter(f => f.path !== 'app/page.tsx').map(f => f.path) }
  manifest.template.digest = catalogApi.templateCatalogDigest(manifest, files)
  const catalog = new catalogApi.TemplateCatalog({ manifest, files, evidence: 'fixture' })
  const store = storeOverride ?? new artifactApi.ArtifactStore(new artifactApi.MemoryObjectBackend())
  const base = await sourceApi.createTemplateSource(store, scope, catalog, hash)
  const plan = { ...planFixture, templateDigest: manifest.template.digest, fileTasks: [{ path: 'app/page.tsx', instruction: 'Inert synthetic module' }, { path: 'migrations/0001_tasks.sql', instruction: 'Reviewed synthetic SQL' }] }
  const baseFile = base.manifest.files.find(f => f.path === 'app/page.tsx')!
  const makeCandidate = async (text: string) => sourceApi.buildCandidate(store, scope, catalog, { plan, base, baseSnapshotId: null,
    batches: [{ schemaVersion: 1, planDigest: canonicalHash(plan), baseManifestDigest: canonicalHash(base.manifest), batchIndex: 0, finalBatch: true,
      changes: [{ op: 'replace', path: 'app/page.tsx', expectedSha256: baseFile.sha256, content: text }, { op: 'create', path: 'migrations/0001_tasks.sql', content: taskMigration }] }],
    provenance: { origin: 'fixture', jobId: scope.jobId, provider: null, model: null, promptVersion: 'synthetic-integration-v1' } })
  return { sourceApi, brokerApi, authApi, journalApi, policy, catalog, store, base, makeCandidate }
}

describe('E2/E3/validation integrated fixture contracts (not live acceptance)', () => {
  it('rejects source-export canary with the concrete scanner and leaves immutable base intact', async () => {
    const f = await fixture(); const before = canonicalHash(f.base.manifest)
    const canary = 'FORGE_INTEGRATION_CANARY_123456789'
    const candidate = await f.makeCandidate(`export const fixture = '${canary}'`)
    await expect(f.sourceApi.prepareSourceExport(f.store, scope, f.catalog, candidate,
      sourceExportScanner({ policyDigest: hash, forbiddenValues: [canary] }))).rejects.toThrow('Source rejected by secret policy')
    expect(canonicalHash(f.base.manifest)).toBe(before)
    expect(candidate.manifest.provenance.origin).toBe('fixture')
    const migration = await f.sourceApi.readSourceFile(f.store, scope, candidate, 'migrations/0001_tasks.sql')
    expect(validateMigrationSql(Buffer.from(migration).toString('utf8')).statements).toHaveLength(2)
  })
  it('reopens immutable local artifacts, verifies stored candidate bytes, scans and exports without executing app source', async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'forge-artifact-contract-'))); const root = join(parent, 'objects')
    await mkdir(root, { mode: 0o700 })
    try {
      const store = new ArtifactStore(await LocalSyntheticObjectBackend.open(root))
      const f = await fixture(store); const original = canonicalHash(f.base.manifest)
      const candidate = await f.makeCandidate('export const fixture = "source bytes only"')
      const persistedMetadata = JSON.stringify(candidate)
      const reopened = new ArtifactStore(await LocalSyntheticObjectBackend.open(root))
      const restoredMetadata = JSON.parse(persistedMetadata)
      await f.sourceApi.validateStoredSource(reopened, scope, restoredMetadata, f.catalog)
      const archive = await f.sourceApi.prepareSourceExport(reopened, scope, f.catalog, restoredMetadata,
        sourceExportScanner({ policyDigest: hash, forbiddenValues: ['FORGE_UNUSED_CANARY_123456789'] }))
      expect(archive.artifact.backendEvidence).toBe('fixture')
      const files = unzipSync(archive.bytes)
      expect(Buffer.from(files['app/page.tsx']).toString('utf8')).toBe('export const fixture = "source bytes only"')
      expect(Buffer.from(files['migrations/0001_tasks.sql']).toString('utf8')).toBe(taskMigration)
      expect(Object.keys(files)).not.toContain('manifest.json')
      expect(canonicalHash(f.base.manifest)).toBe(original)
      expect(await reopened.read(scope, archive.artifact)).toEqual(archive.bytes)
    } finally { await rm(parent, { recursive: true, force: true }) }
  })
  it('materializes the committed Next candidate catalog from its actual files without calling it an approved release', async () => {
    const paths = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', '.env.example', '.gitignore',
      'next.config.mjs', 'next-env.d.ts', 'eslint.config.mjs', 'app-database.sql', 'postgresql.conf', 'pg_hba.conf',
      'app/layout.tsx', 'app/page.tsx', 'app/globals.css', 'app/api/health/route.ts', 'components/EmptyState.tsx',
      'lib/database.ts', 'platform/environment.ts', 'platform/environment.test.ts']
    const files: catalogApi.CatalogFile[] = await Promise.all(paths.map(async path => ({ path,
      mediaType: path.endsWith('.json') ? 'application/json' : path.endsWith('.css') ? 'text/css' : path.endsWith('.sql') ? 'application/sql' : /\.(?:tsx?|mjs)$/.test(path) ? 'text/typescript' : 'text/plain',
      bytes: await readFile(new URL(`../../templates/next-postgres-v1/${path}`, import.meta.url)) })))
    const policy = policyApi.templateCommandPolicy(resources)
    const manifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
      stack: 'nextjs-strict-typescript-postgresql', releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' },
      lockfileDigest: sha256(files.find(f => f.path === 'package-lock.json')!.bytes), commandPolicyDigest: canonicalHash(policy),
      requiredChecks: policy.requiredChecks, protectedPaths: paths.filter(path => !path.startsWith('app/') && !path.startsWith('components/')) }
    manifest.template.digest = catalogApi.templateCatalogDigest(manifest, files)
    const catalog = new catalogApi.TemplateCatalog({ manifest, files, evidence: 'fixture' })
    const store = new ArtifactStore(new artifactApi.MemoryObjectBackend())
    const source = await sourceApi.createTemplateSource(store, scope, catalog, hash)
    expect(source.manifest.provenance.origin).toBe('fixture')
    expect(await sourceApi.validateStoredSource(store, scope, source, catalog)).toEqual(source.manifest)
    expect(source.manifest.files).toHaveLength(paths.length)
    expect(source.manifest.template.digest).toBe(catalog.manifest.template.digest)
    const archive = await sourceApi.prepareSourceExport(store, scope, catalog, source,
      sourceExportScanner({ policyDigest: hash, forbiddenValues: ['FORGE_UNUSED_CANARY_123456789'], placeholderExampleDigest: sha256(files.find(f => f.path === '.env.example')!.bytes) }))
    expect(Object.keys(unzipSync(archive.bytes)).sort()).toEqual(paths.sort())
    expect(archive.artifact.backendEvidence).toBe('fixture')
  })
  it('binds generated candidate review to authenticated broker operations and refuses fixture verification as live', async () => {
    const f = await fixture(); const candidate = await f.makeCandidate('export const fixture = true')
    const diff = await f.sourceApi.prepareDiff(f.store, scope, f.base, candidate)
    const review = f.sourceApi.prepareExecutionReview(scope, candidate, diff, { baseRevision: 1, expiresAt, commandPolicy: f.policy })
    const sentStatements: string[] = []
    const migrated = await applyApprovedMigrations(review, id(9), async path => Buffer.from(await f.sourceApi.readSourceFile(f.store, scope, candidate, path)).toString('utf8'), validateMigrationSql,
      { origin: 'fixture', identity: async () => ({ database: 'forge_app', role: 'forge_migrator', address: '127.0.0.1', appDatabaseId: id(9) }),
        transaction: async (statements, limits) => { sentStatements.push(...statements); expect(limits).toEqual({ statementTimeoutMs: 15000, totalTimeoutMs: 60000 }) } })
    expect(migrated).toMatchObject({ origin: 'fixture', migrationCount: 1, statementCount: 2 })
    expect(sentStatements).toEqual(validateMigrationSql(taskMigration).statements)
    expect(sentStatements.join('')).not.toContain('Reviewed synthetic')
    const approval = { ...approvalFixture, subjectDigest: canonicalHash(review) }
    const context = { ...contextFixture, subjectDigest: canonicalHash(review), templateDigest: review.templateDigest, policyDigest: review.policyDigest }
    const descriptor = { ...descriptorFixture, executionReviewDigest: canonicalHash(review), sourceManifestDigest: review.candidateDigest, templateDigest: review.templateDigest, commandPolicyDigest: review.policyDigest }
    const keys = generateKeyPairSync('ed25519'); const signedDescriptor = f.authApi.signDescriptor(descriptor, 'synthetic-key', keys.privateKey)
    const root = await mkdtemp(join(tmpdir(), 'forge-contract-integration-'))
    const calls: string[] = []
    try {
      const broker = new f.brokerApi.SandboxBroker({ journal: new f.journalApi.FileJournal(root), keys: new Map([['synthetic-key', keys.publicKey]]), workerFingerprints: new Set([hash]), clock: () => Date.parse(now),
        authority: async () => ({ review, approval, context, currentEpoch: 1 }), capacity: { global: 1, workspace: 1, cpu: 2, memoryMiB: 4096, diskMiB: 8192 },
        driver: { origin: 'fixture', assertAvailable: async () => undefined, create: async () => { calls.push('create') }, renew: async () => undefined,
          runCheck: async (_descriptor: unknown, command: ExecutionReviewV1['commandPolicy']['commands'][number]) => { calls.push(command.checkId); return { checkId: command.checkId, startedAt: now, finishedAt: now, exitCode: 0, timedOut: false, oom: false, evidenceDigest: hash } },
          collect: async () => ({ buildOutputDigest: hash }), destroy: async () => ({ resourcesDestroyed: true, fencePersisted: true }) } })
      const peer = { authorized: true as const, certificateSha256: hash }
      expect(await broker.dispatch(peer, { action: 'create', signedDescriptor })).toMatchObject({ origin: 'fixture', status: 'ready' })
      for (const checkId of f.policy.requiredChecks) await broker.dispatch(peer, { action: 'runCheck', signedDescriptor, checkId, inputDigest: review.candidateDigest })
      const result = z.object({ origin: z.enum(['runner', 'fixture']), buildOutputDigest: z.string(), checks: z.array(z.unknown()) }).parse(await broker.dispatch(peer, { action: 'collect', signedDescriptor }))
      expect(calls).toEqual(['create', ...f.policy.requiredChecks])
      expect(result.origin).toBe('fixture')
      expect(() => validatePassingVerification({ schemaVersion: 1, ...scope, origin: result.origin, candidateDigest: review.candidateDigest, templateDigest: review.templateDigest,
        imageDigest: review.imageDigest, policyDigest: review.policyDigest, buildOutputDigest: result.buildOutputDigest, leaseEpoch: 1, checks: result.checks }, descriptor)).toThrow()
      const altered = f.authApi.signDescriptor({ ...descriptor, environmentId: id(997), sourceManifestDigest: hash }, 'synthetic-key', keys.privateKey)
      await expect(broker.dispatch(peer, { action: 'create', signedDescriptor: altered })).rejects.toThrow()
      expect(await broker.dispatch(peer, { action: 'destroy', signedDescriptor })).toMatchObject({ status: 'destroyed', cleanupConfirmed: true })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
