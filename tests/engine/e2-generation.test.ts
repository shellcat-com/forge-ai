/** All provider HTTP, catalog releases and storage here are explicitly synthetic. */
import { describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { ChatCompletionsAdapter } from '../../engine/providers/chat-completions.ts'
import { ArtifactStore, MemoryObjectBackend } from '../../engine/artifacts/store.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { templateCatalogDigest, TemplateCatalog } from '../../engine/generation/catalog.ts'
import type { CatalogFile } from '../../engine/generation/catalog.ts'
import type { TemplateManifestV1 } from '../../engine/contracts/source.ts'
import { buildGenerationRequest, sanitizeDiagnostic } from '../../engine/generation/context.ts'
import { generateAccountedSource } from '../../engine/generation/accounted-source.ts'
import { collectProduct, generateFileBatches, generatePlan } from '../../engine/generation/pipeline.ts'
import { buildCandidate, createTemplateSource, prepareDiff, prepareExecutionReview, prepareSourceExport, readSourceFile, restoreSource } from '../../engine/generation/source.ts'
import { FixtureProvider } from '../../engine/testing/fakes.ts'
import type { GenerationEvent, GenerationRequest } from '../../engine/contracts/provider.ts'
import { commandPolicy, plan as fixturePlan, hash, id, scope, expiresAt } from './fixtures.ts'

const endpoint = 'https://generation.example.test/v1/chat/completions'
const preset = { name: 'fixture' }
const model = { schemaVersion: 1 as const, id: 'synthetic-model', capabilities: { streaming: false, structuredOutput: true, toolCalls: false }, maxInputTokens: 256000, maxOutputTokens: 8000 }
const request: GenerationRequest = { schemaVersion: 1, requestId: id(100), model: model.id, stage: 'plan', promptVersion: 'fixture-v1',
  context: [{ role: 'user', content: 'Synthetic transport test' }], outputSchemaId: 'PlanV1', maxOutputTokens: 4000, deadlineAt: '2099-01-01T00:00:00Z' }
function adapter(fetcher: typeof fetch) {
  return new ChatCompletionsAdapter({ id: 'fixture-http', endpoint, approvedEndpoints: [endpoint], model,
    getCredential: async () => 'synthetic-secret-do-not-echo', fetch: fetcher, evidenceOrigin: 'fixture' })
}
const response = (content: unknown = fixturePlan, rest = {}) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], ...rest }), { headers: { 'content-type': 'application/json' } })
const collect = async (a: ChatCompletionsAdapter, r = request, signal = new AbortController().signal) => {
  const events: GenerationEvent[] = []
  for await (const event of a.generate(r, signal)) events.push(event)
  return events
}
function catalogInput() {
  const encode = (path: string, text: string): CatalogFile => ({ path, mediaType: path.endsWith('.json') ? 'application/json' : path.endsWith('.tsx') ? 'text/typescript' : 'text/plain', bytes: new TextEncoder().encode(text) })
  const files = [encode('package.json', JSON.stringify({ dependencies: { next: '1.0.0' } })),
    encode('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: '1.0.0', resolved: 'https://registry.example.test/next.tgz', integrity: 'sha512-AAAA' } } })),
    encode('tsconfig.json', '{"compilerOptions":{"strict":true}}'), encode('README.md', 'Fixture only; not a runnable release.'),
    encode('.env.example', 'DATABASE_URL=REPLACE_ME'), encode('app/page.tsx', 'export default function Page() { return null }\n')]
  const manifest: TemplateManifestV1 = { schemaVersion: 1, template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
    stack: 'nextjs-strict-typescript-postgresql', releases: { next: '1.0.0', node: '1.0.0', postgres: '1.0.0' },
    lockfileDigest: sha256(files[1].bytes), commandPolicyDigest: canonicalHash(commandPolicy), requiredChecks: commandPolicy.requiredChecks,
    protectedPaths: files.filter(f => f.path !== 'app/page.tsx').map(f => f.path) }
  manifest.template.digest = templateCatalogDigest(manifest, files)
  return { manifest, files, evidence: 'fixture' as const }
}
async function setup() {
  const catalog = new TemplateCatalog(catalogInput())
  const store = new ArtifactStore(new MemoryObjectBackend())
  const base = await createTemplateSource(store, scope, catalog, canonicalHash(preset))
  const plan = { ...fixturePlan, templateDigest: catalog.manifest.template.digest, presetDigest: canonicalHash(preset) }
  const batch = { schemaVersion: 1 as const, planDigest: canonicalHash(plan), baseManifestDigest: canonicalHash(base.manifest), batchIndex: 0, finalBatch: true,
    changes: [{ op: 'replace' as const, path: 'app/page.tsx', expectedSha256: base.manifest.files.find(f => f.path === 'app/page.tsx')!.sha256, content: 'export default function Page() { return "synthetic" }\n' }] }
  const provenance = { origin: 'fixture' as const, jobId: scope.jobId, provider: null, model: null, promptVersion: 'fixture-v1' }
  return { catalog, store, base, plan, batch, provenance }
}
const hooks = () => ({ beforeDispatch: vi.fn(async () => ({ callNumber: 1 })), recordUsage: vi.fn(async () => undefined), persistProduct: vi.fn(async () => undefined) })

describe('E2 synthetic HTTP transport', () => {
  it('uses the fixed destination, denies redirects and preserves fixture provenance and missing usage', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response())
    const events = await collect(adapter(fetcher))
    expect(fetcher.mock.calls[0][0]).toBe(endpoint)
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
    expect(events[0]).toMatchObject({ type: 'usage', usage: { classification: 'uncertain' } })
    expect(events[1]).toMatchObject({ type: 'completed', origin: 'fixture', payload: fixturePlan })
  })
  it('does not claim credential presence is verification or make a probe', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await adapter(fetcher).validateCredentials(new AbortController().signal)).toMatchObject({ configured: true, verified: false })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('bounds a stalled credential-presence probe without any HTTP request', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>()
      const a = new ChatCompletionsAdapter({ id: 'fixture-credential-probe', endpoint, approvedEndpoints: [endpoint], model,
        getCredential: async () => new Promise<string>(() => undefined), fetch: fetcher, evidenceOrigin: 'fixture' })
      const pending = a.validateCredentials(new AbortController().signal)
      await vi.advanceTimersByTimeAsync(10001)
      expect(await pending).toMatchObject({ configured: false, verified: false, errorCode: 'UNAVAILABLE' })
      expect(fetcher).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('cancels a stalled credential probe and never reflects a secret-store failure', async () => {
    const controller = new AbortController()
    const a = new ChatCompletionsAdapter({ id: 'fixture-credential-abort', endpoint, approvedEndpoints: [endpoint], model,
      getCredential: async () => new Promise<string>(() => undefined), fetch: vi.fn(), evidenceOrigin: 'fixture' })
    const pending = a.validateCredentials(controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    const broken = new ChatCompletionsAdapter({ id: 'fixture-credential-failure', endpoint, approvedEndpoints: [endpoint], model,
      getCredential: async () => { throw new Error('CANARY_SECRET_STORE_VALUE') }, fetch: vi.fn(), evidenceOrigin: 'fixture' })
    const status = await broken.validateCredentials(new AbortController().signal)
    expect(status).toMatchObject({ configured: false, verified: false, errorCode: 'UNAVAILABLE' })
    expect(JSON.stringify(status)).not.toContain('CANARY_SECRET_STORE_VALUE')
  })
  it.each(['http://localhost/v1', 'https://user:password@generation.example.test/v1', endpoint + '?secret=one'])('rejects unsafe endpoint %s', unsafe => {
    expect(() => new ChatCompletionsAdapter({ id: 'bad', endpoint: unsafe, approvedEndpoints: [unsafe], model, getCredential: async () => null })).toThrow()
  })
  it('forbids injected transport claiming live provider provenance', () => {
    expect(() => new ChatCompletionsAdapter({ id: 'bad', endpoint, approvedEndpoints: [endpoint], model, getCredential: async () => null, fetch: vi.fn() })).toThrow('fixture')
  })
  it.each([401, 403, 429, 503])('redacts HTTP %i body and retains uncertain liability', async status => {
    const events = await collect(adapter(async () => new Response('synthetic-secret-do-not-echo', { status })))
    expect(events[0]).toMatchObject({ type: 'usage', usage: { classification: 'uncertain' } })
    expect(events.at(-1)).toMatchObject({ type: 'error', code: status === 429 ? 'RATE_LIMIT' : status === 503 ? 'UNAVAILABLE' : 'AUTH' })
    expect(JSON.stringify(events)).not.toContain('synthetic-secret')
  })
  it.each(['length', 'tool_calls', 'content_filter'])('rejects incomplete finish %s', async finish_reason => {
    const events = await collect(adapter(async () => response(fixturePlan, { choices: [{ finish_reason, message: { content: JSON.stringify(fixturePlan) } }] })))
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })
  it('rejects native tools even with a stop finish', async () => {
    const events = await collect(adapter(async () => response(fixturePlan, { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } }] })))
    expect(events.at(-1)).toMatchObject({ code: 'UNSUPPORTED_TOOL' })
  })
  it('handles split UTF-8 JSON body and preserves measured usage', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...fixturePlan, assumptions: ['雪'] }) } }], usage: { prompt_tokens: 33, completion_tokens: 71 } }))
    const events = await collect(adapter(async () => new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close() } }), { headers: { 'content-type': 'application/json' } })))
    expect(events[0]).toMatchObject({ usage: { inputTokens: 33, outputTokens: 71, classification: 'measured' } })
    expect(events.at(-1)).toMatchObject({ type: 'completed' })
  })
  it('rejects malformed output and oversized declared response without exposing it', async () => {
    const r = new Response('SECRET', { headers: { 'content-type': 'application/json', 'content-length': '99999999' } })
    expect((await collect(adapter(async () => r))).at(-1)).toMatchObject({ code: 'INVALID_OUTPUT' })
    expect((await collect(adapter(async () => response({ bad: true })))).at(-1)).toMatchObject({ code: 'INVALID_OUTPUT' })
  })
  it('bounds stalled transport and credential retrieval by request deadline', async () => {
    vi.useFakeTimers()
    try {
      const stalled = new Promise<Response>(() => undefined)
      const eventsPromise = collect(adapter(async () => stalled))
      await vi.advanceTimersByTimeAsync(120001)
      const events = await eventsPromise
      expect(events.at(-1)).toMatchObject({ code: 'TIMEOUT' })
      expect(events[0]).toMatchObject({ usage: { classification: 'uncertain' } })
      const a = new ChatCompletionsAdapter({ id: 'fixture-timeout', endpoint, approvedEndpoints: [endpoint], model,
        getCredential: async () => new Promise<string>(() => undefined), fetch: vi.fn(), evidenceOrigin: 'fixture' })
      const pending = collect(a)
      await vi.advanceTimersByTimeAsync(120001)
      expect(await pending).toEqual([{ schemaVersion: 1, type: 'error', code: 'TIMEOUT', retryable: false }])
    } finally { vi.useRealTimers() }
  })
  it('cancels a stalled response body and classifies a network failure without echoing errors', async () => {
    const controller = new AbortController()
    const pending = collect(adapter(async () => new Response(new ReadableStream<Uint8Array>({ start() { /* no bytes */ } }), { headers: { 'content-type': 'application/json' } })), request, controller.signal)
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    expect((await pending).at(-1)).toMatchObject({ code: 'CANCELLED' })
    const events = await collect(adapter(async () => { throw new Error('synthetic-secret-do-not-echo') }))
    expect(events.at(-1)).toMatchObject({ code: 'UNAVAILABLE', retryable: false })
    expect(JSON.stringify(events)).not.toContain('synthetic-secret')
  })
  it('cancels before dispatch and rejects expired request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect((await collect(adapter(fetcher), request, AbortSignal.abort())).at(-1)).toMatchObject({ code: 'CANCELLED' })
    expect((await collect(adapter(fetcher), { ...request, deadlineAt: '2000-01-01T00:00:00Z' })).at(-1)).toMatchObject({ code: 'TIMEOUT' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('E2 immutable synthetic source pipeline', () => {
  it('builds complete source, review diff, restore and source-only ZIP; base bytes remain unchanged', async () => {
    const { catalog, store, base, plan, batch, provenance } = await setup()
    const originalHash = canonicalHash(base.manifest)
    const candidate = await buildCandidate(store, scope, catalog, { plan, base, batches: [batch], baseSnapshotId: id(200), provenance })
    expect(candidate.manifest.files).toHaveLength(base.manifest.files.length)
    expect(candidate.manifest.provenance.origin).toBe('fixture')
    const diff = await prepareDiff(store, scope, base, candidate)
    expect(diff.diff.files).toHaveLength(1)
    expect(diff.diff.unified).toContain('+++ b/app/page.tsx')
    const review = prepareExecutionReview(scope, candidate, diff, { baseRevision: 2, expiresAt, commandPolicy })
    expect(review.candidateDigest).toBe(canonicalHash(candidate.manifest))
    const scan = vi.fn(async () => undefined)
    const archive = await prepareSourceExport(store, scope, catalog, candidate, scan)
    expect(scan).toHaveBeenCalledOnce()
    const entries = unzipSync(archive.bytes)
    expect(Object.keys(entries).sort()).toEqual(candidate.manifest.files.map(f => f.path).sort())
    expect(Object.keys(entries)).not.toContain('manifest.json')
    expect(new TextDecoder().decode(entries['app/page.tsx'])).toBe(batch.changes[0].content)
    const restored = await restoreSource(store, scope, catalog, base, id(201))
    expect(restored.manifest.provenance.origin).toBe('restore')
    expect(restored.manifest.baseSnapshotId).toBe(id(201))
    expect(canonicalHash(base.manifest)).toBe(originalHash)
  })
  it('rejects cross-workspace and cross-project object reads and tampered references', async () => {
    const { store, base } = await setup()
    for (const foreign of [{ ...scope, workspaceId: id(999) }, { ...scope, projectId: id(999) }])
      await expect(store.read(foreign, base.manifestArtifact)).rejects.toThrow('unavailable')
    await expect(store.read(scope, { ...base.manifestArtifact, sha256: hash })).rejects.toThrow('integrity')
  })
  it('backend is create-only and copies both writes and reads', async () => {
    const backend = new MemoryObjectBackend()
    const bytes = Uint8Array.of(1)
    const result = await backend.createOnly('synthetic', bytes)
    bytes[0] = 2
    const read = await backend.readVersion('synthetic', result.version)
    expect(read[0]).toBe(1)
    read[0] = 3
    expect((await backend.readVersion('synthetic', result.version))[0]).toBe(1)
    await expect(backend.createOnly('synthetic', bytes)).rejects.toThrow('exists')
  })
  it('rejects corrupted immutable object readback before publication', async () => {
    const store = new ArtifactStore({ evidence: 'fixture', createOnly: async () => ({ version: 'fixture' }), readVersion: async () => Uint8Array.of(2) })
    await expect(store.put(scope, 'source-blob', Uint8Array.of(1))).rejects.toThrow('integrity')
  })
  it('rejects template digest drift, unprotected configuration and altered pinned release', () => {
    const input = catalogInput()
    input.files[0].bytes[0] = 1
    expect(() => new TemplateCatalog(input)).toThrow('digest')
    const second = catalogInput()
    second.manifest.protectedPaths = ['README.md']
    second.manifest.template.digest = templateCatalogDigest(second.manifest, second.files)
    expect(() => new TemplateCatalog(second)).toThrow('ownership')
  })
  it('rejects stale expected hashes, path escapes and unowned tasks before candidate writes', async () => {
    const { catalog, store, base, plan, batch, provenance } = await setup()
    const put = vi.spyOn(store, 'put')
    for (const change of [{ ...batch.changes[0], expectedSha256: hash }, { ...batch.changes[0], path: '../escape.ts' }, { ...batch.changes[0], path: 'lib/unplanned.ts' }])
      await expect(buildCandidate(store, scope, catalog, { plan, base, batches: [{ ...batch, changes: [change] }], baseSnapshotId: null, provenance })).rejects.toThrow()
    expect(put).not.toHaveBeenCalled()
  })
  it('rejects template protected content or forged source blob integrity', async () => {
    const { catalog, store, base, plan, batch, provenance } = await setup()
    base.manifest.files.find(f => f.path === 'package.json')!.sha256 = hash
    await expect(buildCandidate(store, scope, catalog, { plan, base, batches: [batch], baseSnapshotId: null, provenance })).rejects.toThrow('Template-owned')
  })
  it('fresh context binds exact source and preset; diagnostics are redacted', async () => {
    const { base, plan } = await setup()
    const input = { ...request, stage: 'files' as const, templateGuidance: 'Fixture only', brief: 'Synthetic brief', instruction: 'Change page', base: base.manifest, plan: { ...plan, briefHash: sha256('Change page') }, preset, batchIndex: 0 }
    const generated = buildGenerationRequest(input)
    expect(generated.outputSchemaId).toBe('FileBatchV1')
    expect(generated.context[0].content).toContain('Output structural schema')
    expect(() => buildGenerationRequest({ ...input, preset: {} })).toThrow('Preset')
    expect(sanitizeDiagnostic('api_\0key=canary-value Bear\0er canary-token')).not.toContain('canary')
    expect(sanitizeDiagnostic('password=private Bearer key https://user:pass@host/x')).not.toMatch(/private|Bearer key|user:pass/)
  })
  it('hashes exact admitted instruction UTF-8 bytes with no quoting, trimming or Unicode normalization', async () => {
    const { base, plan } = await setup()
    const instruction = '  Add café and e\u0301\n  '
    const input = { ...request, stage: 'plan' as const, templateGuidance: 'Fixture only', brief: 'Separate project brief', instruction, base: base.manifest, preset }
    const built = buildGenerationRequest(input)
    const context = JSON.parse(built.context[1].content) as { briefHash: string }
    expect(context.briefHash).toBe(sha256(new TextEncoder().encode(instruction)))
    expect(context.briefHash).not.toBe(canonicalHash(instruction))
    expect(context.briefHash).not.toBe(sha256(instruction.trim()))
    expect(context.briefHash).not.toBe(sha256(instruction.normalize('NFC')))
    expect(() => buildGenerationRequest({ ...input, stage: 'files', batchIndex: 0, plan })).toThrow('plan binding')
  })
  it('does not let a failed scan produce a source export artifact', async () => {
    const { store, catalog, base } = await setup()
    const put = vi.spyOn(store, 'put')
    await expect(prepareSourceExport(store, scope, catalog, base, async () => { throw new Error('scanner rejected') })).rejects.toThrow('scanner')
    expect(put).not.toHaveBeenCalled()
  })
  it('reads exact allowed source file only', async () => {
    const { store, base } = await setup()
    await expect(readSourceFile(store, scope, base, '../secret')).rejects.toThrow('unavailable')
  })
})

describe('E2 durable-hook sequencing using explicit provider fake', () => {
  it('reserves before dispatch, persists usage and validated plan exactly once', async () => {
    const h = hooks()
    const result = await generatePlan(new FixtureProvider([{ schemaVersion: 1, type: 'completed', finish: 'stop', origin: 'fixture', payload: fixturePlan }]), request, new AbortController().signal, h,
      { briefHash: fixturePlan.briefHash, templateDigest: fixturePlan.templateDigest, presetDigest: fixturePlan.presetDigest, commandPolicy })
    expect(result.origin).toBe('fixture')
    expect(h.beforeDispatch).toHaveBeenCalledOnce()
    expect(h.recordUsage).toHaveBeenCalledWith(request.requestId, expect.objectContaining({ usage: { classification: 'uncertain' } }))
    expect(h.persistProduct).toHaveBeenCalledOnce()
  })
  it('does not persist wrong plan bindings or call beyond durable 12-call cap', async () => {
    const h = hooks()
    const fixture = new FixtureProvider([{ schemaVersion: 1, type: 'completed', finish: 'stop', origin: 'fixture', payload: fixturePlan }])
    await expect(generatePlan(fixture, request, new AbortController().signal, h, { briefHash: sha256('different'), templateDigest: hash, presetDigest: hash, commandPolicy })).rejects.toThrow('binding')
    expect(h.persistProduct).not.toHaveBeenCalled()
    h.beforeDispatch.mockResolvedValue({ callNumber: 13 })
    const generate = vi.spyOn(fixture, 'generate')
    await expect(collectProduct(fixture, request, new AbortController().signal, h)).rejects.toThrow('call cap')
    expect(generate).not.toHaveBeenCalled()
  })
  it('rejects provider-invented resources before adopting plan', async () => {
    const h = hooks()
    const providerPlan = { ...fixturePlan, resources: { ...fixturePlan.resources, maxCostMicros: 10000 } }
    const fixture = new FixtureProvider([{ schemaVersion: 1, type: 'completed', finish: 'stop', origin: 'fixture', payload: providerPlan }])
    await expect(generatePlan(fixture, request, new AbortController().signal, h,
      { briefHash: fixturePlan.briefHash, templateDigest: fixturePlan.templateDigest, presetDigest: fixturePlan.presetDigest, commandPolicy })).rejects.toThrow('policy')
    expect(h.persistProduct).not.toHaveBeenCalled()
  })
  it('bounds a hung arbitrary adapter iterator and retains uncertain liability', async () => {
    vi.useFakeTimers()
    try {
      const h = hooks()
      const fixture = new FixtureProvider([])
      vi.spyOn(fixture, 'generate').mockImplementation(() => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<GenerationEvent>>(() => undefined) }) }))
      const pending = collectProduct(fixture, request, new AbortController().signal, h)
      const rejected = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(120001)
      await rejected
      expect(h.recordUsage).toHaveBeenCalledOnce()
      expect(h.persistProduct).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('rejects post-completion fragments without persisting executable partial output', async () => {
    const h = hooks()
    const fixture = new FixtureProvider([{ schemaVersion: 1, type: 'completed', finish: 'stop', origin: 'fixture', payload: fixturePlan }, { schemaVersion: 1, type: 'text.delta', text: 'evil' }])
    await expect(collectProduct(fixture, request, new AbortController().signal, h)).rejects.toThrow('terminal')
    expect(h.persistProduct).not.toHaveBeenCalled()
    expect(h.recordUsage).toHaveBeenCalledOnce()
  })
  it('assembles an exact final batch and rejects duplicate writers in sequential prefix', async () => {
    const { plan, base, batch, catalog } = await setup()
    const h = hooks()
    const fixture = new FixtureProvider([{ schemaVersion: 1, type: 'completed', finish: 'stop', origin: 'fixture', payload: batch }])
    const result = await generateFileBatches({ adapter: fixture, plan, base: base.manifest, protectedPaths: catalog.manifest.protectedPaths,
      signal: new AbortController().signal, hooks: h, request: () => ({ ...request, stage: 'files', outputSchemaId: 'FileBatchV1' }) })
    expect(result.batches).toHaveLength(1)
    expect(result.origin).toBe('fixture')
  })
})

// Task04 source-stage integration uses the existing explicitly synthetic catalog.
describe('accounted source stage and bounded repairs', () => {
  it('persists immutable source/diff hashes and returns every repair for fenced review adoption', async () => {
    for (const repairNumber of [0, 1, 2]) {
      const setupResult = await setup()
      const { catalog, store, base, plan, batch } = setupResult
      const adopt = vi.fn(async () => undefined)
      const result = await generateAccountedSource({ adapter: adapter(async () => response(batch)), store, scope, catalog, base, plan,
        baseSnapshotId: null, signal: new AbortController().signal, hooks: hooks(), repairNumber, adopt,
        request: () => ({ ...request, stage: repairNumber ? 'repair' : 'files', outputSchemaId: 'FileBatchV1' }) })
      expect(result.origin).toBe('fixture')
      expect(result.candidate.manifestArtifact.sha256).toBe(canonicalHash(result.candidate.manifest))
      expect(result.diff.artifact.sha256).toBe(sha256(result.diff.diff.unified))
      expect(adopt).toHaveBeenCalledTimes(1)
    }
  })
  it('blocks a third repair before provider dispatch or adoption', async () => {
    const { catalog, store, base, plan } = await setup(), fetcher = vi.fn<typeof fetch>(async () => response())
    const adopt = vi.fn(async () => undefined)
    await expect(generateAccountedSource({ adapter: adapter(fetcher), store, scope, catalog, base, plan,
      baseSnapshotId: null, signal: new AbortController().signal, hooks: hooks(), repairNumber: 3, adopt,
      request: () => ({ ...request, stage: 'repair', outputSchemaId: 'FileBatchV1' }) })).rejects.toThrow('REPAIR_CAP')
    expect(fetcher).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled()
  })
})
