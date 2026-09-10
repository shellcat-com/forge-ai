import { z } from 'zod'
import type { EngineClient } from './client.ts'
import type { FlowJob } from './flow.ts'
import type { SourceReader } from './workspace.ts'

// Browser projections of RFC 0001 source contracts. No server modules or
// node:crypto imports: trust comes from scoped HTTP plus byte/digest bindings.
const version = z.literal(1), origin = z.literal('fixture'), uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/)
const uint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), positive = uint.min(1), label = z.string().min(1).max(120), description = z.string().min(1).max(2000)
const timestamp = z.iso.datetime({ offset: true }), imageDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const checkIds = ['source-policy', 'dependencies', 'secrets', 'migration-fresh', 'migration-prior', 'lint', 'typecheck', 'unit', 'build', 'http', 'browser-crud', 'db-restart', 'keyboard', 'responsive'] as const
const requiredChecks = z.array(z.enum(checkIds)).length(14).refine(items => new Set(items).size === 14)
const resources = z.strictObject({ cpu: positive.max(2), memoryMiB: positive.max(4096), processes: positive.max(512), diskMiB: positive.max(8192),
  logBytes: positive.max(10 * 1024 * 1024), activeMs: positive.max(1_200_000), verificationMs: positive.max(600_000), maxCostMicros: uint })
const network = z.strictObject({ internet: z.literal(false), appDatabase: z.literal('guest-loopback'), maxConnections: z.literal(5) })
const encoder = new TextEncoder(), utf8Length = (value: string) => encoder.encode(value).length
const sourcePath = z.string().min(1).max(240).refine(path => /^[A-Za-z0-9_./()[\]-]+$/.test(path) && path.split('/').every(segment =>
  segment !== '' && segment !== '.' && segment !== '..' && !segment.endsWith('.') && !/^(\.git|node_modules|\.next|\.ssh)$/i.test(segment)
  && !/^(\.npmrc|\.netrc|\.pypirc|credentials\.json|service-account\.json|id_rsa|id_ed25519)$/i.test(segment)
  && !/^\.env(?!\.example$)/i.test(segment) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment) && !/\.(pem|key|p12|pfx)$/i.test(segment)))
const uniquePaths = (files: { path: string }[]) => {
  const paths = files.map(file => file.path.toLowerCase()), set = new Set(paths)
  return set.size === paths.length && paths.every(path => path.split('/').every((_part, index, parts) => !index || !set.has(parts.slice(0, index).join('/'))))
}
const generatedPath = sourcePath.refine(path => /^migrations\/[0-9]{4}_[a-z0-9_]+\.sql$/.test(path) || /^(app|components|lib)\/.+\.(ts|tsx|css|json)$/.test(path)
  && !path.split('/').some(segment => /^(?:__tests__|tests|instrumentation|middleware)(?:\.|$)/i.test(segment))
  && !/(?:^|\/)(?:package|tsconfig)(?:\.[^/]*)?\.json$|\.(?:test|spec)\.[^/]+$/i.test(path))
const planSchema = z.strictObject({ schemaVersion: version, briefHash: digest, templateDigest: digest, presetDigest: digest,
  userStories: z.array(description).min(1).max(30), routes: z.array(z.strictObject({ path: z.string().regex(/^\/[A-Za-z0-9_/[\]()-]*$/).max(240), purpose: description })).max(30),
  dataEntities: z.array(z.strictObject({ name: label, fields: z.array(label).min(1).max(30) })).max(30),
  apiOperations: z.array(z.strictObject({ method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']), route: label, purpose: description })).max(50),
  fileTasks: z.array(z.strictObject({ path: generatedPath, instruction: description })).min(1).max(100), migrationIntent: z.array(description).max(20), requiredChecks,
  unsupportedRequirements: z.array(description).max(30), assumptions: z.array(description).max(30), resources, network,
}).refine(plan => uniquePaths(plan.fileTasks) && utf8Length(JSON.stringify(plan)) <= 64 * 1024)
const mediaType = z.enum(['text/plain', 'text/typescript', 'text/css', 'application/json', 'application/sql', 'image/png', 'image/jpeg', 'image/webp', 'font/woff2'])
const fileSchema = z.strictObject({ path: sourcePath, sha256: digest, bytes: uint.max(5 * 1024 * 1024), mediaType })
const validAssets = (files: { path: string; mediaType: string; bytes: number }[]) => {
  const assets = files.filter(file => /^(image|font)\//.test(file.mediaType))
  const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'font/woff2': '.woff2' }
  return assets.length <= 10 && assets.reduce((sum, file) => sum + file.bytes, 0) <= 5 * 1024 * 1024
    && assets.every(file => file.path.startsWith('public/assets/') && file.path.endsWith(extensions[file.mediaType]))
}
const filesSchema = z.array(fileSchema).min(1).max(200).refine(files => uniquePaths(files) && validAssets(files) && files.reduce((total, file) => total + file.bytes, 0) <= 10 * 1024 * 1024
  && files.every(file => /^(image|font)\//.test(file.mediaType) || file.bytes <= 256 * 1024))
const migration = z.strictObject({ id: z.string().regex(/^[0-9]{4}_[a-z0-9_]+$/), path: generatedPath.refine(path => path.startsWith('migrations/')), sha256: digest, order: positive.max(200) })
const manifestSchema = z.strictObject({ schemaVersion: version, template: z.strictObject({ id: z.literal('next-postgres-v1'), digest, imageDigest }),
  baseSnapshotId: uuid.nullable(), planDigest: digest, presetDigest: digest,
  files: z.array(fileSchema.extend({ blobId: uuid, mode: z.literal('0644') })).min(1).max(200), migrations: z.array(migration).max(200), commandPolicyDigest: digest,
  provenance: z.strictObject({ origin: z.enum(['fixture', 'restore']), jobId: uuid, provider: z.null(), model: z.null(), promptVersion: label }),
}).refine(manifest => utf8Length(JSON.stringify(manifest)) <= 256 * 1024 && filesSchema.safeParse(manifest.files.map(({ path, sha256, bytes, mediaType }) => ({ path, sha256, bytes, mediaType }))).success
  && new Set(manifest.migrations.map(item => item.id)).size === manifest.migrations.length
  && manifest.migrations.every((item, index) => item.order === index + 1 && item.path === `migrations/${item.id}.sql` && manifest.files.some(file => file.path === item.path && file.sha256 === item.sha256 && file.mediaType === 'application/sql'))
  && manifest.files.every(file => !file.path.startsWith('migrations/') || manifest.migrations.some(item => item.path === file.path)))
const verificationSchema = z.strictObject({ schemaVersion: version, workspaceId: uuid, projectId: uuid, jobId: uuid, origin,
  candidateDigest: digest, templateDigest: digest, imageDigest, policyDigest: digest, buildOutputDigest: digest, leaseEpoch: positive,
  checks: z.array(z.strictObject({ checkId: z.enum(checkIds), startedAt: timestamp, finishedAt: timestamp, exitCode: uint.max(255), timedOut: z.boolean(), oom: z.boolean(), evidenceDigest: digest })).length(14),
}).refine(value => new Set(value.checks.map(check => check.checkId)).size === 14 && value.checks.every(check => Date.parse(check.finishedAt) >= Date.parse(check.startedAt)))
const commonEnvelope = { schemaVersion: version, origin, stateVersion: positive, reviewDigest: digest }
const planEnvelope = z.strictObject({ ...commonEnvelope, plan: planSchema, planDigest: digest })
const changesEnvelope = z.strictObject({ ...commonEnvelope, snapshotId: uuid, manifest: manifestSchema, manifestDigest: digest,
  diff: z.strictObject({ artifactId: uuid, sha256: digest, bytes: uint.max(24 * 1024 * 1024), unified: z.string() }), verification: verificationSchema.nullable(), verificationDigest: digest.nullable() })
const filesEnvelope = z.strictObject({ schemaVersion: version, origin, snapshotId: uuid, manifestDigest: digest, files: filesSchema })
const reviewSchema = z.object({ schemaVersion: version, workspaceId: uuid, projectId: uuid, jobId: uuid, baseRevision: positive, baseSnapshotId: uuid.nullable(),
  templateDigest: digest, policyDigest: digest, expiresAt: timestamp, planDigest: digest.optional(), candidateDigest: digest.optional(), diffDigest: digest.optional(), verificationDigest: digest.optional() }).passthrough()
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); if (!result.success) throw new Error('INVALID_SOURCE_RESPONSE'); return result.data }
function requireBinding(condition: boolean): asserts condition { if (!condition) throw new Error('SOURCE_BINDING_MISMATCH') }

/** Same canonical JSON v1 rules as the server: safe integers, sorted UTF-16
 * keys, unchanged arrays/Unicode, no accessors/coercion/cycles, depth <= 64. */
export function sourceCanonicalJson(value: unknown): string {
  const seen = new Set<object>(), wellFormed = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  function encode(value: unknown, depth: number): string {
    if (depth > 64) throw new Error('INVALID_SOURCE_JSON')
    if (value === null) return 'null'
    if (typeof value === 'boolean') return String(value)
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value === 0 ? 0 : value)
    if (typeof value === 'string' && wellFormed(value)) return JSON.stringify(value)
    if (typeof value !== 'object' || value === null || seen.has(value)) throw new Error('INVALID_SOURCE_JSON')
    seen.add(value); let output: string
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error('INVALID_SOURCE_JSON')
      output = '[' + Array.from({ length: value.length }, (_, index) => { const entry = Object.getOwnPropertyDescriptor(value, String(index));
        if (!entry?.enumerable || !('value' in entry)) throw new Error('INVALID_SOURCE_JSON'); return encode(entry.value, depth + 1) }).join(',') + ']'
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('INVALID_SOURCE_JSON')
      const keys = Reflect.ownKeys(value)
      if (keys.some(key => typeof key !== 'string' || !wellFormed(key))) throw new Error('INVALID_SOURCE_JSON')
      output = '{' + (keys as string[]).sort().map(key => { const entry = Object.getOwnPropertyDescriptor(value, key)!;
        if (!entry.enumerable || !('value' in entry)) throw new Error('INVALID_SOURCE_JSON'); return JSON.stringify(key) + ':' + encode(entry.value, depth + 1) }).join(',') + '}'
    }
    seen.delete(value); return output
  }
  return encode(value, 0)
}
const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const canonicalHash = (value: unknown) => hash(encoder.encode(sourceCanonicalJson(value)))
type FileIndex = z.infer<typeof filesEnvelope>

export class EngineSourceReader implements SourceReader {
  private readonly indexes = new Map<string, FileIndex>()
  constructor(private readonly client: EngineClient) {}
  private remember(index: FileIndex) {
    const prior = this.indexes.get(index.snapshotId)
    if (prior) requireBinding(prior.manifestDigest === index.manifestDigest && sourceCanonicalJson(prior.files) === sourceCanonicalJson(index.files))
    this.indexes.set(index.snapshotId, structuredClone(index))
    if (this.indexes.size > 100) this.indexes.delete(this.indexes.keys().next().value!)
  }
  async review(job: FlowJob, signal?: AbortSignal) {
    const subject = parse(reviewSchema, job.review)
    requireBinding(job.origin === 'fixture' && subject.workspaceId === job.workspaceId && subject.projectId === job.projectId && subject.jobId === job.id
      && subject.baseRevision === job.baseRevision && subject.baseSnapshotId === job.baseSnapshotId && Date.parse(subject.expiresAt) > Date.now()
      && await canonicalHash(job.review) === job.reviewDigest)
    const prefix = 'EXPLICIT FIXTURE — no live provider, app execution, or private preview evidence.\n\n'
    if (job.state === 'AWAITING_PLAN_APPROVAL') {
      const result = await this.client.read(`/jobs/${uuid.parse(job.id)}/plan`, input => parse(planEnvelope, input), signal)
      requireBinding(result.stateVersion === job.stateVersion && result.reviewDigest === job.reviewDigest && result.planDigest === subject.planDigest
        && await canonicalHash(result.plan) === result.planDigest && result.plan.templateDigest === subject.templateDigest)
      signal?.throwIfAborted()
      return { reviewDigest: result.reviewDigest, stateVersion: result.stateVersion, text: prefix + JSON.stringify(result.plan, null, 2) }
    }
    requireBinding(['AWAITING_EXECUTION_APPROVAL', 'AWAITING_PROMOTION'].includes(job.state))
    const result = await this.client.read(`/jobs/${uuid.parse(job.id)}/changes`, input => parse(changesEnvelope, input), signal, { maxBytes: 32 * 1024 * 1024 })
    requireBinding(result.stateVersion === job.stateVersion && result.reviewDigest === job.reviewDigest && result.snapshotId === job.candidateSnapshotId
      && result.manifestDigest === subject.candidateDigest && await canonicalHash(result.manifest) === result.manifestDigest
      && result.manifest.provenance.jobId === job.id && result.manifest.baseSnapshotId === job.baseSnapshotId && result.manifest.template.digest === subject.templateDigest
      && result.manifest.commandPolicyDigest === subject.policyDigest && utf8Length(result.diff.unified) === result.diff.bytes
      && await hash(encoder.encode(result.diff.unified)) === result.diff.sha256)
    if (job.state === 'AWAITING_EXECUTION_APPROVAL') requireBinding(result.diff.sha256 === subject.diffDigest && subject.imageDigest === result.manifest.template.imageDigest)
    if (result.verification) {
      const verification = result.verification
      requireBinding(verification.workspaceId === job.workspaceId && verification.projectId === job.projectId && verification.jobId === job.id
        && verification.candidateDigest === result.manifestDigest && verification.templateDigest === subject.templateDigest
        && verification.imageDigest === result.manifest.template.imageDigest && verification.policyDigest === subject.policyDigest
        && await canonicalHash(verification) === result.verificationDigest)
    } else requireBinding(result.verificationDigest === null)
    if (job.state === 'AWAITING_PROMOTION') requireBinding(!!result.verification && result.verificationDigest === subject.verificationDigest
      && result.verification.checks.every(check => check.exitCode === 0 && !check.timedOut && !check.oom))
    signal?.throwIfAborted()
    this.remember({ schemaVersion: 1, origin: 'fixture', snapshotId: result.snapshotId, manifestDigest: result.manifestDigest,
      files: result.manifest.files.map(({ path, sha256, bytes, mediaType }) => ({ path, sha256, bytes, mediaType })) })
    return { reviewDigest: result.reviewDigest, stateVersion: result.stateVersion,
      text: prefix + 'SOURCE MANIFEST\n' + JSON.stringify(result.manifest, null, 2) + '\n\nUNIFIED DIFF\n' + result.diff.unified
        + (result.verification ? '\n\nFIXTURE VERIFICATION\n' + JSON.stringify(result.verification, null, 2) : '') }
  }
  async files(snapshotId: string, signal?: AbortSignal) {
    uuid.parse(snapshotId)
    const result = await this.client.read(`/snapshots/${snapshotId}/files`, input => parse(filesEnvelope, input), signal)
    requireBinding(result.snapshotId === snapshotId); signal?.throwIfAborted(); this.remember(result)
    return result.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }))
  }
  async file(snapshotId: string, path: string, signal?: AbortSignal) {
    sourcePath.parse(path); await this.files(snapshotId, signal)
    const index = this.indexes.get(snapshotId)!, file = index.files.find(file => file.path === path)
    requireBinding(!!file && !/^(image|font)\//.test(file.mediaType))
    const result = await this.client.attachment(`/snapshots/${snapshotId}/file?path=${encodeURIComponent(path)}`, { mediaType: 'text/plain', signal, maxBytes: 256 * 1024 })
    requireBinding(result.manifestDigest === index.manifestDigest && result.sha256 === file.sha256 && result.bytes.byteLength === file.bytes && await hash(result.bytes) === file.sha256)
    signal?.throwIfAborted(); const text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)
    requireBinding(!text.includes('\0')); return text
  }
  async export(snapshotId: string, actionId: string) {
    await this.files(snapshotId)
    const index = this.indexes.get(snapshotId)!
    const result = await this.client.attachment(`/snapshots/${snapshotId}/exports`, { method: 'POST', mediaType: 'application/zip', idempotencyKey: actionId })
    requireBinding(result.manifestDigest === index.manifestDigest && await hash(result.bytes) === result.sha256)
    return { bytes: result.bytes, filename: `fixture-source-${snapshotId}.zip` }
  }
}
