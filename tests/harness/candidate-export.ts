/** Opt-in compatibility check for ONE reviewed platform scaffold. Never accepts
 * caller/provider source, a caller archive, or a caller command for execution. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { LocalSyntheticObjectBackend } from '../../engine/artifacts/local-backend.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import type { TemplateManifestV1 } from '../../engine/contracts/source.ts'
import { TemplateCatalog, templateCatalogDigest } from '../../engine/generation/catalog.ts'
import type { CatalogFile } from '../../engine/generation/catalog.ts'
import { createTemplateSource, prepareSourceExport, validateStoredSource } from '../../engine/generation/source.ts'
import { sourceExportScanner } from '../../engine/validation/secrets.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { hash, resources, scope } from '../engine/fixtures.ts'

// Reviewed platform bytes at33b521e. Updating these pins requires source review;
// they must never be derived dynamically from a provider/catalog at execution.
export const reviewedCandidateHashes: Readonly<Record<string, string>> = Object.freeze({
  'package.json': 'f0578b9ade57da65935585a217974c3ca486075677fb5b84dc8684d356de9b5d',
  'package-lock.json': 'ce88882e5e2a00763896b4685bb964de44273905ba23d638fdeaac0b06157123',
  'tsconfig.json': '2dec24034b7358c8dd63334c8ec48bad2c47193756195bdcd299ea7a98d57cb0',
  'README.md': '47002c6eb05d086fe71b892735d70ef54c254c52182fc5123a311f05b0252949',
  '.env.example': 'ff5b23c8e57d9fb72bd4b6b3ad1af4be2f2380b47d89cac607d1cbc1349a2774',
  '.gitignore': '1528d94034311b7ae5d887c3d280593f62269a74dd29345b057ef9c7e57f0f44',
  'next.config.mjs': '5aed4d4997b94d6d25dd69e593f5852348a42d47b2784b5eff279c1b2b61c2bd',
  'next-env.d.ts': '1862ac4bbbc5192d4bf562161df66ea547ed3e67173100656ab606ae9797db2b',
  'eslint.config.mjs': '55505a5001fa9886ccefddb5966f967c4e7b966b72c8877b439893f80f1fc971',
  'app-database.sql': '3a6cfcdb8219b652481f578c19f3b052fae111f8241c71f0ef56e9b9c56eca0e',
  'postgresql.conf': '423bee4763107ae9153516d893f1de9ef22c7a61c0f2f52e3f5e540b5bf9449e',
  'pg_hba.conf': '1d6287d48e03cce0d273cd56845b4fe9598e2c40d272602eb9fdc997e9af6fea',
  'app/layout.tsx': 'ae30a99272a344fdfa158354e51e6f528ad7710395125dbc5a7075f4ba67c00d',
  'app/page.tsx': '2127423977a8f0d1d493174e8ee62dc5a59a93fc8a2a80b5030522371e3ee1a1',
  'app/globals.css': '2a69ef3b0af27365548e54b04771082d83912aacf5f46e59392debfcb0e3047e',
  'app/api/health/route.ts': 'da6aeed09da92afdb92bc5ac002d34a393578a5b2b41f8ab82c4e12e640d52cd',
  'components/EmptyState.tsx': 'eba3609266cc1b97c11a17c971a0063900c046780ec3d48e5e23b6fee4a9696b',
  'lib/database.ts': '4ba61030e73f3effcd7dab986486b72f6467bc0a46f5326d8ee43afa642442dd',
  'platform/environment.ts': '045a2836811b76baba7e859803814a8171ed786363fd391173ef5802d7a7e42a',
  'platform/environment.test.ts': 'b26d32ee058db90b82edf0a93140c80df0de1bb531bcd775bc558fd85819bd4c',
})
const paths = Object.keys(reviewedCandidateHashes).sort()
export async function readReviewedCandidate(): Promise<CatalogFile[]> {
  return Promise.all(paths.map(async path => {
    const bytes = await readFile(new URL(`../../templates/next-postgres-v1/${path}`, import.meta.url))
    if (sha256(bytes) !== reviewedCandidateHashes[path]) throw new Error(`Unreviewed candidate bytes: ${path}`)
    return { path, bytes, mediaType: path.endsWith('.json') ? 'application/json' : path.endsWith('.css') ? 'text/css'
      : path.endsWith('.sql') ? 'application/sql' : /\.(?:tsx?|mjs)$/.test(path) ? 'text/typescript' : 'text/plain' }
  }))
}

/** Validate everything before making a directory or writing a file. Requiring
 * the producer's canonical ZIP also rejects duplicate names and link metadata.
 * Extractor below writes new regular0644 files; it never honors archive modes. */
export function validateCandidateArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Candidate archive cap')
  let total = 0
  const files = unzipSync(bytes, { filter(entry) {
    total += entry.originalSize
    if (!Object.hasOwn(reviewedCandidateHashes, entry.name) || entry.originalSize > 262144 || total > 1024 * 1024)
      throw new Error('Unexpected candidate archive entry')
    return true
  } })
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(paths)) throw new Error('Candidate archive file set mismatch')
  const canonical: Record<string, [Uint8Array, { mtime: Date; attrs: number }]> = Object.create(null)
  for (const path of paths) {
    if (sha256(files[path]) !== reviewedCandidateHashes[path]) throw new Error(`Unreviewed candidate archive bytes: ${path}`)
    canonical[path] = [files[path], { mtime: new Date('2000-01-01T00:00:00Z'), attrs: 0o100644 << 16 }]
  }
  if (sha256(zipSync(canonical, { level: 6 })) !== sha256(bytes)) throw new Error('Noncanonical candidate archive')
  return files
}

export async function prepareReviewedCandidateExport(artifactRoot: string) {
  const files = await readReviewedCandidate()
  const policy = templateCommandPolicy(resources)
  const manifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
    stack: 'nextjs-strict-typescript-postgresql', releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' },
    lockfileDigest: reviewedCandidateHashes['package-lock.json'], commandPolicyDigest: canonicalHash(policy), requiredChecks: policy.requiredChecks,
    protectedPaths: paths.filter(path => !path.startsWith('app/') && !path.startsWith('components/')) }
  manifest.template.digest = templateCatalogDigest(manifest, files)
  // No approved image exists. The explicit fixture image reference and storage
  // backend cannot produce release or isolated-execution evidence.
  const catalog = new TemplateCatalog({ manifest, files, evidence: 'fixture' })
  const store = new ArtifactStore(await LocalSyntheticObjectBackend.open(artifactRoot))
  const source = await createTemplateSource(store, scope, catalog, hash)
  const reopened = new ArtifactStore(await LocalSyntheticObjectBackend.open(artifactRoot))
  await validateStoredSource(reopened, scope, source, catalog)
  if (source.manifest.provenance.origin !== 'fixture' || source.manifest.provenance.promptVersion !== 'template-seed-v1')
    throw new Error('Only platform template seed may execute')
  const archive = await prepareSourceExport(reopened, scope, catalog, source,
    sourceExportScanner({ policyDigest: hash, forbiddenValues: ['FORGE_UNUSED_EXPORT_CANARY_123456789'], placeholderExampleDigest: reviewedCandidateHashes['.env.example'] }))
  validateCandidateArchive(archive.bytes)
  if (sha256(await reopened.read(scope, archive.artifact)) !== archive.sha256) throw new Error('Stored archive mismatch')
  return { archive, templateDigest: manifest.template.digest, sourceManifestDigest: canonicalHash(source.manifest) }
}

interface CommandEvidence { argv: string[]; exitCode: number | null; signal: string | null; elapsedMs: number; output: string; timedOut: boolean }
async function command(node: string, args: string[], cwd: string, cache: string, timeoutMs = 180000): Promise<CommandEvidence> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    // An explicit environment prevents ambient provider/database credentials,
    // NODE_OPTIONS, npm user configuration or lifecycle settings being inherited.
    const child = spawn(node, args, { cwd, detached: true, env: { PATH: `${dirname(node)}:/usr/bin:/bin`,
      HOME: join(cwd, '.candidate-home'), TMPDIR: tmpdir(), CI: '1', NEXT_TELEMETRY_DISABLED: '1',
      npm_config_cache: cache, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
      npm_config_userconfig: '/dev/null', npm_config_globalconfig: join(cwd, '.candidate-global-npmrc') }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let timedOut = false
    const append = (data: Buffer) => { output = (output + data.toString('utf8')).slice(-65536) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    const killGroup = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } } }
    const deadline = setTimeout(() => { timedOut = true; killGroup() }, timeoutMs)
    child.on('error', error => { clearTimeout(deadline); reject(error) })
    child.on('close', (exitCode, signal) => {
      clearTimeout(deadline); killGroup()
      resolve({ argv: [node, ...args], exitCode, signal, elapsedMs: Date.now() - started, output, timedOut })
    })
  })
}

export async function runCandidateExportCheck() {
  if (process.env.FORGE_RUN_CANDIDATE_EXPORT !== '1') throw new Error('Candidate export execution requires explicit opt-in')
  if (!process.env.FORGE_CANDIDATE_NODE24) throw new Error('Exact locally reviewed Node24 binary required')
  const node = await realpath(process.env.FORGE_CANDIDATE_NODE24)
  const npm = join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-candidate-export-')))
  const sourceRoot = join(root, 'source'); const objectRoot = join(root, 'objects')
  const commands: CommandEvidence[] = []
  const evidence = { schemaVersion: 1, origin: 'platform-authored-candidate-clean-export', status: 'failed',
    testedAt: new Date().toISOString(), host: `${process.platform}/${process.arch}`, node: '24.20.0',
    isolationAcceptance: false, generatedAppAcceptance: false, providerGeneration: false, databaseTested: false,
    artifactBackendEvidence: 'fixture', sourceBaseline: '33b521e', dependencyBaseline: 'b981ec6',
    sourceManifestDigest: '', templateDigest: '', archiveSha256: '', lockfileDigest: reviewedCandidateHashes['package-lock.json'],
    fileHashes: reviewedCandidateHashes, sourceRoot, objectRoot, cleanupConfirmed: false, commands, error: null as string | null }
  try {
    await mkdir(sourceRoot, { mode: 0o700 }); await mkdir(objectRoot, { mode: 0o700 })
    const cache = join(homedir(), '.npm')
    const version = await command(node, ['--version'], sourceRoot, cache, 10000)
    commands.push(version)
    if (version.exitCode !== 0 || version.output.trim() !== 'v24.20.0') throw new Error('Exact Node24.20.0 required')
    const prepared = await prepareReviewedCandidateExport(objectRoot)
    Object.assign(evidence, { sourceManifestDigest: prepared.sourceManifestDigest, templateDigest: prepared.templateDigest, archiveSha256: prepared.archive.sha256 })
    const files = validateCandidateArchive(prepared.archive.bytes)
    for (const path of paths) {
      await mkdir(dirname(join(sourceRoot, path)), { recursive: true, mode: 0o700 })
      await writeFile(join(sourceRoot, path), files[path], { flag: 'wx', mode: 0o644 })
    }
    const checks = [['--version'], ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
      ['run', 'lint'], ['run', 'typecheck'], ['run', 'test'], ['run', 'build']]
    for (const args of checks) {
      const result = await command(node, [npm, ...args], sourceRoot, cache)
      commands.push(result)
      if (result.exitCode !== 0 || result.timedOut) throw new Error(`Candidate command failed: npm ${args.join(' ')}`)
    }
    // Build-generated files are never adopted into the original immutable source.
    evidence.status = 'passed'
  } catch (error) { evidence.error = error instanceof Error ? error.message : 'Candidate check failed' }
  finally { await rm(root, { recursive: true, force: true }); evidence.cleanupConfirmed = true }
  return evidence
}
