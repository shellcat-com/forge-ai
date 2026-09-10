import { describe, expect, it, vi } from 'vitest'
import { canonicalHash, canonicalJson, sha256 } from '../../engine/contracts/canonical.ts'
import { plan, manifest as baseManifest, id, hash, scope } from '../../tests/engine/fixtures.ts'
import { checkIds } from '../../engine/contracts/primitives.ts'
import { EngineClient } from './client.ts'
import { EngineSourceReader, sourceCanonicalJson } from './source-client.ts'
import type { FlowJob } from './flow.ts'

// Explicit transport fixtures; no model, authentication, runner or app execution.
const snapshotId = id(20), diff = '+ synthetic source\n', source = 'fixture base'
const manifest = { ...baseManifest, planDigest: canonicalHash(plan) }, manifestDigest = canonicalHash(manifest)
const common = { schemaVersion: 1, ...scope, baseRevision: 1, baseSnapshotId: null, templateDigest: hash, policyDigest: hash, expiresAt: '2099-01-01T00:00:00Z' }
const planReview = { ...common, planDigest: canonicalHash(plan) }
const executionReview = { ...common, candidateDigest: manifestDigest, diffDigest: sha256(diff), imageDigest: manifest.template.imageDigest,
  commandPolicy: {}, migrations: [], migrationBundleDigest: hash, dataReset: 'synthetic-data-only' }
const verification = { schemaVersion: 1, ...scope, origin: 'fixture', candidateDigest: manifestDigest, templateDigest: hash, imageDigest: manifest.template.imageDigest,
  policyDigest: hash, buildOutputDigest: hash, leaseEpoch: 1, checks: checkIds.map(checkId => ({ checkId, startedAt: '2026-09-10T00:00:00Z', finishedAt: '2026-09-10T00:00:01Z', exitCode: 0, timedOut: false, oom: false, evidenceDigest: hash })) }
const promotionReview = { ...common, candidateDigest: manifestDigest, verificationDigest: canonicalHash(verification) }
const job = (state: FlowJob['state'], review: unknown): FlowJob => ({ schemaVersion: 1, origin: 'fixture', id: scope.jobId, workspaceId: scope.workspaceId, projectId: scope.projectId,
  state, stateVersion: 6, baseRevision: 1, baseSnapshotId: null, reviewDigest: canonicalHash(review), review, candidateSnapshotId: snapshotId, cleanupPending: false, finishedAt: null })
const planResult = { schemaVersion: 1, origin: 'fixture', plan, planDigest: canonicalHash(plan), stateVersion: 6, reviewDigest: canonicalHash(planReview) }
const changes = { schemaVersion: 1, origin: 'fixture', snapshotId, manifest, manifestDigest, diff: { artifactId: id(21), sha256: sha256(diff), bytes: new TextEncoder().encode(diff).length, unified: diff }, stateVersion: 6,
  reviewDigest: canonicalHash(executionReview), verification: null, verificationDigest: null }
const files = { schemaVersion: 1, origin: 'fixture', snapshotId, manifestDigest, files: manifest.files.map(({ path, sha256, bytes, mediaType }) => ({ path, sha256, bytes, mediaType })) }
const raw = (value: string | Uint8Array, zip = false, headers = {}) => new Response(value as BodyInit, { headers: { 'Content-Type': zip ? 'application/zip' : 'text/plain; charset=utf-8',
  [zip ? 'X-Artifact-Sha256' : 'X-Source-Sha256']: sha256(value), 'X-Manifest-Digest': manifestDigest, ...(zip ? { 'Content-Disposition': 'attachment; filename="UNTRUSTED.html"' } : {}), ...headers } })
function setup(override?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url), response = override?.(path, init); if (response) return response
    if (path.endsWith('/plan')) return Response.json(planResult)
    if (path.endsWith('/changes')) return Response.json(changes)
    if (path.endsWith('/files')) return Response.json(files)
    if (path.includes('/file?')) return raw(source)
    if (path.endsWith('/exports')) return raw(new Uint8Array([80, 75, 3, 4]), true)
    throw new Error('UNEXPECTED_SYNTHETIC_ROUTE')
  })
  const client = new EngineClient(transport); client.setCsrf('a'.repeat(43))
  return { client, reader: new EngineSourceReader(client), transport }
}
describe('browser source reader with explicit HTTP fixtures', () => {
  it('matches server canonical JSON rules including Unicode, key sorting and negative zero', () => {
    const value = { z: ['é', '\u2028', -0], a: { y: 1, x: true }, emoji: '😀' }
    expect(sourceCanonicalJson(value)).toBe(canonicalJson(value))
    for (const invalid of [NaN, 1.2, '\ud800', [undefined], new Date(), Object.defineProperty({}, 'x', { get: () => 1, enumerable: true })]) expect(() => sourceCanonicalJson(invalid)).toThrow('INVALID_SOURCE_JSON')
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => sourceCanonicalJson(cycle)).toThrow()
  })
  it('loads a hash-bound plan and explicitly labels the review as fixture evidence', async () => {
    const { reader } = setup(), result = await reader.review(job('AWAITING_PLAN_APPROVAL', planReview))
    expect(result.reviewDigest).toBe(canonicalHash(planReview)); expect(result.stateVersion).toBe(6)
    expect(result.text).toContain('EXPLICIT FIXTURE'); expect(result.text).toContain(plan.userStories[0])
  })
  it.each([
    ['foreign scope', { ...planReview, projectId: id(90) }, planResult],
    ['wrong version', planReview, { ...planResult, stateVersion: 7 }],
    ['wrong review digest', planReview, { ...planResult, reviewDigest: hash }],
    ['changed bytes', planReview, { ...planResult, plan: { ...plan, userStories: ['Spoofed source'] } }],
    ['malformed plan', planReview, { ...planResult, plan: { ...plan, resources: { ...plan.resources, cpu: 200 } } }],
    ['live mislabel', planReview, { ...planResult, origin: 'provider' }],
  ])('rejects plan %s', async (_name, review, response) => {
    const { reader } = setup(path => path.endsWith('/plan') ? Response.json(response) : undefined)
    await expect(reader.review(job('AWAITING_PLAN_APPROVAL', review))).rejects.toThrow()
  })
  it('rejects a changed job review even before any request', async () => {
    const { reader, transport } = setup(), target = job('AWAITING_PLAN_APPROVAL', planReview)
    target.reviewDigest = hash; await expect(reader.review(target)).rejects.toThrow('SOURCE_BINDING_MISMATCH'); expect(transport).not.toHaveBeenCalled()
  })
  it('loads the exact candidate manifest and diff and keeps source bytes as text', async () => {
    const { reader, transport } = setup(); const result = await reader.review(job('AWAITING_EXECUTION_APPROVAL', executionReview))
    expect(result.text).toContain(diff); expect(result.text).toContain('SOURCE MANIFEST')
    expect(await reader.file(snapshotId, 'app/page.tsx')).toBe(source)
    expect(transport.mock.calls.some(([url]) => String(url).endsWith('/file?path=app%2Fpage.tsx'))).toBe(true)
  })
  it.each([
    ['foreign snapshot', { ...changes, snapshotId: id(91) }],
    ['wrong manifest', { ...changes, manifestDigest: hash }],
    ['changed file manifest', { ...changes, manifest: { ...manifest, files: [{ ...manifest.files[0], bytes: 13 }] } }],
    ['changed diff', { ...changes, diff: { ...changes.diff, unified: '+ Forged\n' } }],
    ['wrong diff length', { ...changes, diff: { ...changes.diff, bytes: 0 } }],
    ['foreign provenance', { ...changes, manifest: { ...manifest, provenance: { ...manifest.provenance, jobId: id(92) } } }],
  ])('rejects changes %s', async (_name, response) => {
    const { reader } = setup(path => path.endsWith('/changes') ? Response.json(response) : undefined)
    await expect(reader.review(job('AWAITING_EXECUTION_APPROVAL', executionReview))).rejects.toThrow()
  })
  it('displays passing fixture verification for promotion and rejects absent/failing/spoofed evidence', async () => {
    const response = { ...changes, reviewDigest: canonicalHash(promotionReview), verification, verificationDigest: canonicalHash(verification) }
    const { reader } = setup(path => path.endsWith('/changes') ? Response.json(response) : undefined)
    const result = await reader.review(job('AWAITING_PROMOTION', promotionReview)); expect(result.text).toContain('FIXTURE VERIFICATION')
    for (const invalid of [null, { ...verification, origin: 'runner' }, { ...verification, checks: verification.checks.map(check => ({ ...check, exitCode: 1 })) }, { ...verification, jobId: id(92) }]) {
      const changed = { ...response, verification: invalid, verificationDigest: invalid ? canonicalHash(invalid) : null }
      const subject = { ...promotionReview, verificationDigest: changed.verificationDigest }
      changed.reviewDigest = canonicalHash(subject)
      await expect(setup(path => path.endsWith('/changes') ? Response.json(changed) : undefined).reader.review(job('AWAITING_PROMOTION', subject))).rejects.toThrow()
    }
  })
  it.each([
    ['foreign snapshot', { ...files, snapshotId: id(92) }],
    ['path traversal', { ...files, files: [{ ...files.files[0], path: '../secret' }] }],
    ['case-fold duplicate', { ...files, files: [...files.files, { ...files.files[0], path: 'app/Page.tsx' }] }],
    ['text oversize', { ...files, files: [{ ...files.files[0], bytes: 256 * 1024 + 1 }] }],
  ])('rejects file index %s', async (_name, response) => {
    const { reader } = setup(path => path.endsWith('/files') ? Response.json(response) : undefined)
    await expect(reader.files(snapshotId)).rejects.toThrow()
  })
  it('refuses immutable manifest drift after review and exact-path/binary violations', async () => {
    const { reader } = setup(path => path.endsWith('/files') ? Response.json({ ...files, manifestDigest: hash }) : undefined)
    await reader.review(job('AWAITING_EXECUTION_APPROVAL', executionReview)); await expect(reader.files(snapshotId)).rejects.toThrow('BINDING')
    await expect(setup().reader.file(snapshotId, 'app/Page.tsx')).rejects.toThrow('BINDING')
    const binary = setup(path => path.endsWith('/files') ? Response.json({ ...files, files: [{ ...files.files[0], mediaType: 'image/png', path: 'public/assets/x.png' }] }) : undefined)
    await expect(binary.reader.file(snapshotId, 'public/assets/x.png')).rejects.toThrow('BINDING')
    expect(binary.transport).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['hash', () => raw('tampered!!!!')],
    ['header hash', () => raw(source, false, { 'X-Source-Sha256': hash })],
    ['manifest header', () => raw(source, false, { 'X-Manifest-Digest': hash })],
    ['binary mime', () => raw(source, false, { 'Content-Type': 'application/octet-stream' })],
  ])('rejects source file %s mismatch', async (_name, response) => {
    const { reader } = setup(path => path.includes('/file?') ? response() : undefined)
    await expect(reader.file(snapshotId, 'app/page.tsx')).rejects.toThrow()
  })
  it('retains export key/body and uses its own safe filename rather than upstream filename', async () => {
    const { reader, transport } = setup(), key = id(50)
    const a = await reader.export(snapshotId, key), b = await reader.export(snapshotId, key)
    expect(a.filename).toBe(`fixture-source-${snapshotId}.zip`); expect(b.bytes).toEqual(a.bytes)
    const posts = transport.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2); expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers)
    expect(posts[0][1]).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store', body: '{"schemaVersion":1}', headers: { 'X-CSRF-Token': 'a'.repeat(43), 'Idempotency-Key': key } })
  })
  it('rejects export digest mismatch and redacts a 401 while clearing in-memory CSRF', async () => {
    const mismatch = setup(path => path.endsWith('/exports') ? raw('tampered', true, { 'X-Artifact-Sha256': hash }) : undefined)
    await expect(mismatch.reader.export(snapshotId, id(50))).rejects.toThrow('BINDING')
    const h = setup(path => path.endsWith('/exports') ? Response.json({ error: { code: 'CANARY<script>', message: 'SECRET' } }, { status: 401 }) : undefined)
    await expect(h.reader.export(snapshotId, id(50))).rejects.toThrow('ENGINE_UNAVAILABLE')
    await expect(h.client.attachment('/anything', { method: 'POST', mediaType: 'application/zip', idempotencyKey: id(51) })).rejects.toThrow('SESSION_REQUIRED')
  })
})
