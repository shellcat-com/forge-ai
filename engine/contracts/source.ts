import { z } from 'zod'
import { boundedJson, description, digest, imageDigest, label, limits, networkSchema,
  positive, requiredChecks, resourcesSchema, textContent, uint, utf8Bytes, uuid, version } from './primitives.ts'
import { assertUniquePaths, generatedPath, sourcePath } from './paths.ts'
import { canonicalHash, sha256 } from './canonical.ts'

export const templateRefSchema = z.strictObject({ id: z.literal('next-postgres-v1'), digest, imageDigest })
export const templateManifestSchema = z.strictObject({ schemaVersion: version, template: templateRefSchema,
  stack: z.literal('nextjs-strict-typescript-postgresql'),
  releases: z.strictObject({ next: label, node: label, postgres: label }).refine(v => Object.values(v).every(x => /^\d+\.\d+(?:\.\d+)?$/.test(x)), 'Exact releases required'),
  lockfileDigest: digest, commandPolicyDigest: digest, requiredChecks,
  protectedPaths: z.array(sourcePath).min(1).max(200),
})
export const planSchema = boundedJson(z.strictObject({
  schemaVersion: version, briefHash: digest, templateDigest: digest, presetDigest: digest,
  userStories: z.array(description).min(1).max(30),
  routes: z.array(z.strictObject({ path: z.string().regex(/^\/[A-Za-z0-9_/[\]()-]*$/).max(240), purpose: description })).max(30),
  dataEntities: z.array(z.strictObject({ name: label, fields: z.array(label).min(1).max(30) })).max(30),
  apiOperations: z.array(z.strictObject({ method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']), route: label, purpose: description })).max(50),
  fileTasks: z.array(z.strictObject({ path: generatedPath, instruction: description })).min(1).max(100),
  migrationIntent: z.array(description).max(20), requiredChecks,
  unsupportedRequirements: z.array(description).max(30), assumptions: z.array(description).max(30),
  resources: resourcesSchema, network: networkSchema,
}).refine(p => { try { assertUniquePaths(p.fileTasks.map(f => f.path)); return true } catch { return false } }, 'Duplicate file tasks'), limits.planBytes)

export const changeSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('create'), path: generatedPath, content: textContent }),
  z.strictObject({ op: z.literal('replace'), path: generatedPath, expectedSha256: digest, content: textContent }),
  z.strictObject({ op: z.literal('delete'), path: generatedPath, expectedSha256: digest }),
]).refine(c => !c.path.startsWith('migrations/') || c.op === 'create', 'Existing migrations are immutable')
export const fileBatchSchema = boundedJson(z.strictObject({ schemaVersion: version, planDigest: digest,
  baseManifestDigest: digest, batchIndex: uint.max(99), finalBatch: z.boolean(),
  changes: z.array(changeSchema).min(1).max(limits.operations),
}).refine(b => { try { assertUniquePaths(b.changes.map(c => c.path)); return true } catch { return false } }, 'Duplicate paths'), limits.batchBytes)
export const migrationSchema = z.strictObject({ id: z.string().regex(/^[0-9]{4}_[a-z0-9_]+$/),
  path: generatedPath.refine(p => p.startsWith('migrations/')), sha256: digest, order: positive.max(200) })
export const manifestSchema = boundedJson(z.strictObject({
  schemaVersion: version, template: templateRefSchema, baseSnapshotId: uuid.nullable(), planDigest: digest, presetDigest: digest,
  files: z.array(z.strictObject({ path: sourcePath, blobId: uuid, sha256: digest, bytes: uint.max(limits.assetBytes),
    mediaType: z.enum(['text/plain', 'text/typescript', 'text/css', 'application/json', 'application/sql', 'image/png', 'image/jpeg', 'image/webp', 'font/woff2']), mode: z.literal('0644') })).min(1).max(limits.files),
  migrations: z.array(migrationSchema).max(200), commandPolicyDigest: digest,
  provenance: z.strictObject({ origin: z.enum(['provider', 'fixture', 'restore']), jobId: uuid,
    provider: label.nullable(), model: label.nullable(), promptVersion: label }),
}).superRefine((m, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  try { assertUniquePaths(m.files.map(f => f.path)) } catch { fail('Duplicate or conflicting paths') }
  if (m.files.reduce((n, f) => n + f.bytes, 0) > limits.sourceBytes) fail('Source too large')
  const assets = m.files.filter(f => /^(image|font)\//.test(f.mediaType))
  const assetExtensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'font/woff2': '.woff2' }
  if (assets.some(f => !f.path.startsWith('public/assets/') || !f.path.endsWith(assetExtensions[f.mediaType]))) fail('Bundled asset path/media mismatch')
  if (assets.length > limits.assets || assets.reduce((n, f) => n + f.bytes, 0) > limits.assetBytes) fail('Asset cap exceeded')
  if (m.files.some(f => !assets.includes(f) && f.bytes > limits.fileBytes)) fail('Text file cap exceeded')
  if (new Set(m.migrations.map(x => x.id)).size !== m.migrations.length) fail('Duplicate migration')
  for (const [i, migration] of m.migrations.entries()) {
    if (migration.order !== i + 1 || migration.path !== `migrations/${migration.id}.sql`
      || !m.files.some(f => f.path === migration.path && f.sha256 === migration.sha256 && f.mediaType === 'application/sql')) fail('Invalid migration reference/order')
  }
  if (m.files.some(f => f.path.startsWith('migrations/') && !m.migrations.some(x => x.path === f.path))) fail('Unlisted migration')
  if (m.provenance.origin === 'provider' ? !m.provenance.provider || !m.provenance.model : m.provenance.provider !== null || m.provenance.model !== null) fail('Invalid provenance')
}), 256 * 1024)

export type PlanV1 = z.infer<typeof planSchema>
export type FileBatchV1 = z.infer<typeof fileBatchSchema>
export type ChangeV1 = z.infer<typeof changeSchema>
export type ManifestV1 = z.infer<typeof manifestSchema>
export type TemplateManifestV1 = z.infer<typeof templateManifestSchema>

/** Pure proposal validation only; never writes or executes files. Template paths
 * and asset IDs must additionally resolve through the E2 immutable catalog. */
export function validateProposal(planInput: unknown, baseInput: unknown, batchInputs: unknown[], protectedPaths: readonly string[]): FileBatchV1[] {
  const plan = planSchema.parse(planInput)
  const base = manifestSchema.parse(baseInput)
  if (base.template.digest !== plan.templateDigest || base.presetDigest !== plan.presetDigest) throw new Error('Template/preset mismatch')
  const batches = batchInputs.map(b => fileBatchSchema.parse(b))
  if (!batches.length || batches.length > 100) throw new Error('Incomplete proposal')
  const changes = batches.flatMap(b => b.changes)
  if (changes.length > limits.operations) throw new Error('Proposal operation cap')
  assertUniquePaths(changes.map(c => c.path))
  const protectedSet = new Set(protectedPaths.map(p => sourcePath.parse(p).toLowerCase()))
  const files = new Map(base.files.map(f => [f.path, f]))
  batches.forEach((b, i) => {
    if (b.batchIndex !== i || b.finalBatch !== (i === batches.length - 1) || b.planDigest !== canonicalHash(plan) || b.baseManifestDigest !== canonicalHash(base)) throw new Error('Batch binding/order mismatch')
  })
  for (const change of changes) {
    if (protectedSet.has(change.path.toLowerCase()) || !plan.fileTasks.some(t => t.path === change.path)) throw new Error('Unowned/protected file task')
    const prior = files.get(change.path)
    if (change.op === 'create' ? !!prior : !prior || prior.sha256 !== change.expectedSha256) throw new Error('Base content mismatch')
    if (change.op === 'delete') files.delete(change.path)
    else files.set(change.path, { path: change.path, bytes: utf8Bytes(change.content), sha256: sha256(change.content), blobId: prior?.blobId ?? base.files[0].blobId, mediaType: 'text/plain', mode: '0644' })
  }
  assertUniquePaths([...files.keys()])
  if (files.size > limits.files || [...files.values()].reduce((n, f) => n + f.bytes, 0) > limits.sourceBytes) throw new Error('Resulting source cap')
  return batches
}
