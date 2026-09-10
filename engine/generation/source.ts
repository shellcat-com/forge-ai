import { zipSync } from 'fflate'
import type { ArtifactStore } from '../artifacts/store.ts'
import type { ArtifactRef, ArtifactScope } from '../artifacts/store.ts'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { manifestSchema, planSchema, validateProposal } from '../contracts/source.ts'
import type { FileBatchV1, ManifestV1, PlanV1 } from '../contracts/source.ts'
import { commandPolicySchema, executionReviewSchema } from '../contracts/review.ts'
import type { ExecutionReviewV1 } from '../contracts/review.ts'
import type { TemplateCatalog } from './catalog.ts'

export interface StoredSource { manifest: ManifestV1; manifestArtifact: ArtifactRef; blobs: ArtifactRef[] }
const encoder = new TextEncoder()
const decoder = () => new TextDecoder('utf-8', { fatal: true })
const mediaType = (path: string): ManifestV1['files'][number]['mediaType'] => path.endsWith('.sql') ? 'application/sql'
  : path.endsWith('.json') ? 'application/json' : path.endsWith('.css') ? 'text/css' : 'text/typescript'

export async function readSourceFile(store: ArtifactStore, s: ArtifactScope, source: StoredSource, path: string): Promise<Uint8Array> {
  const file = source.manifest.files.find(f => f.path === path)
  const ref = source.blobs.find(b => b.id === file?.blobId && b.kind === 'source-blob')
  if (!file || !ref || ref.bytes !== file.bytes || ref.sha256 !== file.sha256) throw new Error('Source blob unavailable')
  return store.read(s, ref)
}
export async function validateStoredSource(store: ArtifactStore, s: ArtifactScope, source: StoredSource, catalog: TemplateCatalog) {
  const manifest = manifestSchema.parse(source.manifest)
  catalog.validateSource(manifest)
  if (source.manifestArtifact.kind !== 'source-manifest' || source.manifestArtifact.sha256 !== canonicalHash(manifest)) throw new Error('Manifest artifact mismatch')
  await store.read(s, source.manifestArtifact)
  for (const file of manifest.files) await readSourceFile(store, s, source, file.path)
  return manifest
}
async function persistManifest(store: ArtifactStore, s: ArtifactScope, manifestInput: ManifestV1, blobs: ArtifactRef[]): Promise<StoredSource> {
  const manifest = manifestSchema.parse(manifestInput)
  const manifestArtifact = await store.putJson(s, 'source-manifest', manifest)
  return { manifest, manifestArtifact, blobs: blobs.filter(b => manifest.files.some(f => f.blobId === b.id)) }
}
/** Template seed is labelled fixture (it is not generated provider source).
 * Release catalog approval/image testing is a distinct E3/operator gate. */
export async function createTemplateSource(store: ArtifactStore, s: ArtifactScope, catalog: TemplateCatalog, presetDigest: string): Promise<StoredSource> {
  const files: ManifestV1['files'] = []
  const blobs: ArtifactRef[] = []
  for (const file of catalog.files()) {
    const blob = await store.put(s, 'source-blob', file.bytes)
    blobs.push(blob)
    files.push({ path: file.path, blobId: blob.id, sha256: blob.sha256, bytes: blob.bytes, mediaType: file.mediaType, mode: '0644' })
  }
  const migrations = migrationList(files)
  return persistManifest(store, s, { schemaVersion: 1, template: catalog.manifest.template, baseSnapshotId: null,
    planDigest: canonicalHash({ kind: 'template-seed', templateDigest: catalog.manifest.template.digest }), presetDigest,
    files: files.sort(comparePaths), migrations, commandPolicyDigest: catalog.manifest.commandPolicyDigest,
    provenance: { origin: 'fixture', jobId: s.jobId, provider: null, model: null, promptVersion: 'template-seed-v1' } }, blobs)
}
function comparePaths(a: { path: string }, b: { path: string }) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0 }
function migrationList(files: ManifestV1['files']): ManifestV1['migrations'] {
  return files.filter(f => f.path.startsWith('migrations/')).sort(comparePaths).map((f, i) => ({ id: f.path.slice(11, -4), path: f.path, sha256: f.sha256, order: i + 1 }))
}
export interface CandidateInput { plan: PlanV1; base: StoredSource; batches: FileBatchV1[]; baseSnapshotId: string | null;
  provenance: ManifestV1['provenance'] }
/** All operations validate before the first candidate write. Failed storage writes
 * leave only unreferenced quarantine objects, never a partial adopted candidate. */
export async function buildCandidate(store: ArtifactStore, s: ArtifactScope, catalog: TemplateCatalog, input: CandidateInput): Promise<StoredSource> {
  const plan = planSchema.parse(input.plan)
  const base = await validateStoredSource(store, s, input.base, catalog)
  if (plan.unsupportedRequirements.length) throw new Error('Unsupported requirements require a revised plan')
  if (input.provenance.jobId !== s.jobId) throw new Error('Candidate provenance scope mismatch')
  const batches = validateProposal(plan, base, input.batches, catalog.manifest.protectedPaths)
  const changes = batches.flatMap(b => b.changes)
  if (plan.fileTasks.some(task => !changes.some(c => c.path === task.path))) throw new Error('Incomplete file tasks')
  const proposedFiles = new Map(base.files.map(f => [f.path, structuredClone(f)]))
  for (const change of changes) {
    if (change.op === 'delete') proposedFiles.delete(change.path)
    else proposedFiles.set(change.path, { path: change.path, blobId: base.files[0].blobId,
      sha256: sha256(change.content), bytes: encoder.encode(change.content).length, mediaType: mediaType(change.path), mode: '0644' })
  }
  const proposedList = [...proposedFiles.values()].sort(comparePaths)
  const proposed = manifestSchema.parse({ ...base, baseSnapshotId: input.baseSnapshotId, planDigest: canonicalHash(plan),
    files: proposedList, migrations: migrationList(proposedList), provenance: input.provenance })
  if (base.migrations.some((m, i) => canonicalHash(m) !== canonicalHash(proposed.migrations[i] ?? null))) throw new Error('Migration history must append')
  catalog.validateSource(proposed)
  const files = new Map(base.files.map(f => [f.path, structuredClone(f)]))
  const blobs = [...input.base.blobs]
  for (const change of changes) {
    if (change.op === 'delete') { files.delete(change.path); continue }
    const bytes = encoder.encode(change.content)
    const blob = await store.put(s, 'source-blob', bytes)
    blobs.push(blob)
    files.set(change.path, { path: change.path, blobId: blob.id, sha256: blob.sha256, bytes: bytes.length, mediaType: mediaType(change.path), mode: '0644' })
  }
  const resultFiles = [...files.values()].sort(comparePaths)
  const manifest = manifestSchema.parse({ ...base, baseSnapshotId: input.baseSnapshotId, planDigest: canonicalHash(plan),
    files: resultFiles, migrations: migrationList(resultFiles), provenance: input.provenance })
  // Migrations append; a provider cannot reorder prior migration history by filename.
  if (base.migrations.some((m, i) => canonicalHash(m) !== canonicalHash(manifest.migrations[i] ?? null))) throw new Error('Migration history must append')
  catalog.validateSource(manifest)
  return persistManifest(store, s, manifest, blobs)
}
export interface SourceDiff { schemaVersion: 1; baseManifestDigest: string; candidateManifestDigest: string;
  files: { path: string; op: 'create' | 'replace' | 'delete'; before: string | null; after: string | null }[]; unified: string }
/** Full-file unified hunks avoid quadratic diff behavior on hostile repeated lines.
 * Consumers MUST display this untrusted text as escaped text, never HTML. */
export async function prepareDiff(store: ArtifactStore, s: ArtifactScope, base: StoredSource, candidate: StoredSource): Promise<{ diff: SourceDiff; artifact: ArtifactRef }> {
  const paths = [...new Set([...base.manifest.files, ...candidate.manifest.files].map(f => f.path))].sort()
  const files: SourceDiff['files'] = []
  let unified = ''
  for (const path of paths) {
    const oldFile = base.manifest.files.find(f => f.path === path)
    const newFile = candidate.manifest.files.find(f => f.path === path)
    if (oldFile?.sha256 === newFile?.sha256) continue
    if ((oldFile && /^(image|font)\//.test(oldFile.mediaType)) || (newFile && /^(image|font)\//.test(newFile.mediaType))) throw new Error('Asset changes require catalog release')
    const before = oldFile ? decoder().decode(await readSourceFile(store, s, base, path)) : null
    const after = newFile ? decoder().decode(await readSourceFile(store, s, candidate, path)) : null
    files.push({ path, op: oldFile ? newFile ? 'replace' : 'delete' : 'create', before, after })
    const oldLines = before === null || before === '' ? [] : before.replace(/\n$/, '').split('\n')
    const newLines = after === null || after === '' ? [] : after.replace(/\n$/, '').split('\n')
    unified += `--- ${oldFile ? 'a/' + path : '/dev/null'}\n+++ ${newFile ? 'b/' + path : '/dev/null'}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n`
    unified += oldLines.map(line => '-' + line + '\n').join('')
    if (before && !before.endsWith('\n')) unified += '\\ No newline at end of file\n'
    unified += newLines.map(line => '+' + line + '\n').join('')
    if (after && !after.endsWith('\n')) unified += '\\ No newline at end of file\n'
  }
  const diff: SourceDiff = { schemaVersion: 1, baseManifestDigest: canonicalHash(base.manifest), candidateManifestDigest: canonicalHash(candidate.manifest), files, unified }
  return { diff, artifact: await store.put(s, 'diff', encoder.encode(unified)) }
}
/** Pure preparation only. E1 persists this with the state transition and later
 * validates actor, digest, revision, revocation and expiry under row locks. */
export function prepareExecutionReview(s: ArtifactScope, candidate: StoredSource, preparedDiff: { diff: SourceDiff; artifact: ArtifactRef },
  input: { baseRevision: number; expiresAt: string; commandPolicy: ExecutionReviewV1['commandPolicy'] }): ExecutionReviewV1 {
  const manifest = manifestSchema.parse(candidate.manifest)
  const diffArtifact = preparedDiff.artifact
  if (preparedDiff.diff.candidateManifestDigest !== canonicalHash(manifest) || sha256(preparedDiff.diff.unified) !== diffArtifact.sha256) throw new Error('Diff candidate binding mismatch')
  const commandPolicy = commandPolicySchema.parse(input.commandPolicy)
  if (manifest.provenance.jobId !== s.jobId || diffArtifact.kind !== 'diff'
    || diffArtifact.workspaceId !== s.workspaceId || diffArtifact.projectId !== s.projectId || diffArtifact.jobId !== s.jobId
    || canonicalHash(commandPolicy) !== manifest.commandPolicyDigest) throw new Error('Review artifact/policy scope mismatch')
  return executionReviewSchema.parse({ schemaVersion: 1, ...s, baseRevision: input.baseRevision, baseSnapshotId: manifest.baseSnapshotId,
    candidateDigest: canonicalHash(manifest), diffDigest: diffArtifact.sha256, templateDigest: manifest.template.digest, imageDigest: manifest.template.imageDigest,
    policyDigest: manifest.commandPolicyDigest, commandPolicy, migrations: manifest.migrations,
    migrationBundleDigest: canonicalHash(manifest.migrations), dataReset: 'synthetic-data-only', expiresAt: input.expiresAt })
}
export async function restoreSource(store: ArtifactStore, s: ArtifactScope, catalog: TemplateCatalog, selected: StoredSource,
  currentHeadId: string | null): Promise<StoredSource> {
  const source = await validateStoredSource(store, s, selected, catalog)
  return persistManifest(store, s, { ...source, baseSnapshotId: currentHeadId,
    provenance: { origin: 'restore', jobId: s.jobId, provider: null, model: null, promptVersion: 'source-restore-v1' } }, selected.blobs)
}
/** Produces source bytes only; caller must already hold E1 export authorization
 * and fresh scanner evidence. This helper cannot mark verification current. */
export async function prepareSourceExport(store: ArtifactStore, s: ArtifactScope, catalog: TemplateCatalog, source: StoredSource,
  scan: (files: readonly { path: string; bytes: Uint8Array }[], manifestDigest: string) => Promise<void>) {
  const manifest = await validateStoredSource(store, s, source, catalog)
  const files = await Promise.all(manifest.files.map(async f => ({ path: f.path, bytes: await readSourceFile(store, s, source, f.path) })))
  await scan(files.map(f => ({ path: f.path, bytes: f.bytes.slice() })), canonicalHash(manifest))
  const archive: Record<string, [Uint8Array, { mtime: Date; attrs: number }]> = Object.create(null) as Record<string, [Uint8Array, { mtime: Date; attrs: number }]>
  for (const file of files) archive[file.path] = [file.bytes, { mtime: new Date('2000-01-01T00:00:00Z'), attrs: 0o100644 << 16 }]
  const bytes = zipSync(archive, { level: 6 })
  return { artifact: await store.put(s, 'source-export', bytes), sha256: sha256(bytes), bytes }
}
