import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { canonicalHash, canonicalJson, sha256, planSchema, manifestSchema, fileBatchSchema,
  executionReviewSchema, brokerDescriptorSchema, approvalSchema, validateApproval, validateDescriptor,
  validateProposal, sourcePath, generatedPath, assertUniquePaths, parseJson, limits,
  jobEventSchema, parseEventCursor, generationRequestSchema, validateProviderResponse } from '../../engine/contracts/index.ts'
import { checkIds, validatePassingVerification } from '../../engine/contracts/index.ts'
import { FixtureProvider, FixtureRunner, requireLiveProvider } from '../../engine/testing/fakes.ts'
import { approval, batch, context, descriptor, hash, id, manifest, now, plan, review, scope } from './fixtures.ts'

describe('canonical JSON v1', () => {
  it('matches independent SHA-256 golden vectors and sorted JSON', () => {
    expect(canonicalHash({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
    expect(canonicalHash({ b: 2, a: 1 })).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(canonicalJson({ z: -0, a: [1, 'é', null] })).toBe('{"a":[1,"é",null],"z":0}')
    expect(canonicalHash({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalHash({ b: { d: 3, c: 2 }, a: 1 }))
    expect(canonicalHash(['a', 'b'])).not.toBe(canonicalHash(['b', 'a']))
    expect(canonicalHash('é')).not.toBe(canonicalHash('e\u0301'))
  })
  it.each([undefined, NaN, Infinity, 1.1, 9007199254740992, 1n, new Date(), '\ud800', { x: undefined }, Array(1)])('rejects lossy/non-JSON value %s', value => {
    expect(() => canonicalHash(value)).toThrow()
  })
  it('rejects cycles, getters, symbols and excessive depth', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(() => canonicalHash(cyclic)).toThrow()
    expect(() => canonicalHash({ get x() { throw new Error('getter executed') } })).toThrow('Accessors')
    expect(() => canonicalHash({ [Symbol()]: 1 })).toThrow()
    expect(() => canonicalHash(Object.assign([1], { [Symbol()]: 1 }))).toThrow()
    const accessor = [1]
    Object.defineProperty(accessor, '0', { get() { throw new Error('getter executed') } })
    expect(() => canonicalHash(accessor)).toThrow('accessor')
    let deep: unknown = {}; for (let i = 0; i < 66; i++) deep = { deep }
    expect(() => canonicalHash(deep)).toThrow('nesting')
  })
})

describe('strict runtime contracts and source policy', () => {
  for (const [name, schema, fixture] of [
    ['plan', planSchema, plan], ['manifest', manifestSchema, manifest], ['batch', fileBatchSchema, batch],
    ['execution review', executionReviewSchema, review], ['broker descriptor', brokerDescriptorSchema, descriptor], ['approval', approvalSchema, approval],
  ] as const) it(`${name} round-trips and rejects unknown fields/versions`, () => {
    expect(schema.parse(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture)
    expect(schema.safeParse({ ...fixture, schemaVersion: 2 }).success).toBe(false)
    expect(schema.safeParse({ ...fixture, execute: true }).success).toBe(false)
  })
  it('exports structural JSON schemas while retaining authoritative semantic runtime checks', () => {
    expect(z.toJSONSchema(planSchema).additionalProperties).toBe(false)
  })
  it.each(['/etc/passwd', '../file', 'app/../foo.ts', 'app//foo.ts', 'app/%2e%2e/x', 'app\\foo.ts', 'C:/x', '.git/config', '.env', '.env.local', 'app/CON.ts', 'app/x\0.ts', 'app/x.pem', 'app/é.ts', 'app/a./x', 'x'.repeat(241)])('rejects hostile path %s', path => {
    expect(sourcePath.safeParse(path).success).toBe(false)
  })
  it('allows Next.js route groups and rejects protected configuration/harness writes', () => {
    expect(generatedPath.parse('app/(board)/tasks/[id]/page.tsx')).toBeTruthy()
    for (const path of ['package.json', 'tsconfig.json', '.github/workflows/x.yml', 'app/a.test.ts', 'lib/__tests__/x.ts', 'public/x.png']) expect(generatedPath.safeParse(path).success).toBe(false)
    expect(() => assertUniquePaths(['app/A.ts', 'app/a.ts'])).toThrow()
    expect(() => assertUniquePaths(['app/a.ts', 'app/a.ts/b.ts'])).toThrow()
  })
  it('validates UTF-8 bytes, JSON caps, source count, media/mode, migration references and provenance', () => {
    expect(fileBatchSchema.safeParse({ ...batch, changes: [{ op: 'create', path: 'lib/x.ts', content: 'é'.repeat(131073) }] }).success).toBe(false)
    expect(() => parseJson(planSchema, JSON.stringify(plan), 10)).toThrow()
    expect(planSchema.safeParse({ ...plan, requiredChecks: ['lint'] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...manifest, files: Array(201).fill(manifest.files[0]) }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...manifest, files: [{ ...manifest.files[0], mode: '0755' }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...manifest, files: [{ ...manifest.files[0], bytes: limits.fileBytes + 1 }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...manifest, migrations: [{ id: '0001_tasks', path: 'migrations/0001_tasks.sql', sha256: hash, order: 1 }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...manifest, provenance: { ...manifest.provenance, origin: 'provider' } }).success).toBe(false)
  })
  it('validates whole proposal atomicity and bindings, not merely each batch', () => {
    expect(validateProposal(plan, manifest, [batch], [])).toEqual([batch])
    for (const changed of [{ ...batch, finalBatch: false }, { ...batch, batchIndex: 1 }, { ...batch, planDigest: hash }, { ...batch, baseManifestDigest: hash }, { ...batch, changes: [{ ...batch.changes[0], expectedSha256: hash }] }])
      expect(() => validateProposal(plan, manifest, [changed], [])).toThrow()
    expect(() => validateProposal(plan, manifest, [batch], ['APP/page.tsx'])).toThrow()
    expect(() => validateProposal(plan, manifest, [batch, batch], [])).toThrow()
    expect(fileBatchSchema.safeParse({ ...batch, changes: [{ op: 'delete', path: 'migrations/0001_tasks.sql', expectedSha256: hash }] }).success).toBe(false)
  })
})

describe('approval and broker binding', () => {
  it('rejects fixture, stale candidate and fabricated-success verification evidence', () => {
    const verification = { schemaVersion: 1, ...scope, origin: 'runner', candidateDigest: descriptor.sourceManifestDigest,
      templateDigest: descriptor.templateDigest, imageDigest: descriptor.imageDigest, policyDigest: descriptor.commandPolicyDigest,
      buildOutputDigest: hash, leaseEpoch: 1,
      checks: checkIds.map(checkId => ({ checkId, startedAt: now, finishedAt: now, exitCode: 0, timedOut: false, oom: false, evidenceDigest: hash })) }
    expect(validatePassingVerification(verification, descriptor).checks).toHaveLength(14)
    for (const patch of [{ origin: 'fixture' }, { candidateDigest: hash }, { leaseEpoch: 2 }, { checks: [] },
      { checks: verification.checks.map(c => ({ ...c, oom: true })) }]) expect(() => validatePassingVerification({ ...verification, ...patch }, descriptor)).toThrow()
  })
  it('accepts the exact reviewed subject for a current editor', () => {
    expect(validateApproval(approval, review, context)).toEqual(approval)
    expect(validateDescriptor(descriptor, review, approval, context, 1)).toEqual(descriptor)
  })
  it.each([
    { currentRole: 'viewer' }, { currentRole: null }, { userDisabled: true }, { cancelRequested: true },
    { policyRevoked: true }, { stateVersion: 7 }, { subjectDigest: hash }, { baseRevision: 2 }, { baseSnapshotId: id(99) },
    { workspaceId: id(99) }, { projectId: id(99) }, { jobId: id(99) }, { actorId: id(99) },
    { now: '2026-09-10T12:00:00.000Z' }, { policyDigest: hash }, { templateDigest: sha256('new template') },
  ])('rejects stale/revoked/mis-scoped approval %j', change => {
    expect(() => validateApproval(approval, review, { ...context, ...change })).toThrow()
  })
  it('rejects modified candidate/commands, future approval, oversized resources, mounts and stale epochs', () => {
    expect(() => validateApproval(approval, { ...review, candidateDigest: hash }, context)).toThrow()
    expect(() => validateApproval({ ...approval, createdAt: '2026-09-09T13:00:00.000Z' }, review, context)).toThrow()
    for (const patch of [{ sourceManifestDigest: hash }, { workspaceId: id(99) }, { expiresAt: now }, { leaseEpoch: 2 }, { resources: { ...descriptor.resources, cpu: 99 } }, { mounts: [] }])
      expect(() => validateDescriptor({ ...descriptor, ...patch }, review, approval, context, 1)).toThrow()
    const runner = new FixtureRunner()
    expect(runner.create(descriptor, review, approval, context, 1)).toMatchObject({ origin: 'fixture', executed: false })
    runner.create({ ...descriptor, leaseEpoch: 2 }, review, approval, context, 2)
    expect(() => runner.create(descriptor, review, approval, context, 1)).toThrow('Stale')
  })
})

describe('provider and durable event contracts', () => {
  const request = generationRequestSchema.parse({ schemaVersion: 1, requestId: id(10), model: 'fixture-model', stage: 'plan', promptVersion: 'fixture-v1',
    context: [{ role: 'user', content: 'Fixture task board' }], outputSchemaId: 'PlanV1', maxOutputTokens: 1000, deadlineAt: now })
  const completed = { schemaVersion: 1 as const, type: 'completed' as const, finish: 'stop' as const, origin: 'fixture' as const, payload: plan }
  it('accepts completed structured and split text output but cannot label fake work live', async () => {
    const fake = new FixtureProvider([completed])
    const events = []; for await (const event of fake.generate(request, new AbortController().signal)) events.push(event)
    const result = validateProviderResponse(request, events)
    expect(result.payload).toEqual(plan)
    expect(() => requireLiveProvider(result)).toThrow('Fixture')
    const raw = JSON.stringify(plan)
    expect(validateProviderResponse(request, [{ schemaVersion: 1, type: 'text.delta', text: raw.slice(0, 30) },
      { schemaVersion: 1, type: 'text.delta', text: raw.slice(30) }, { ...completed, payload: undefined }]).payload).toEqual(plan)
  })
  it('rejects partial, malformed, truncated, refused, tool, duplicate and post-terminal outputs', () => {
    for (const events of [[], [{ ...completed, finish: 'length' }], [{ ...completed, finish: 'refusal' }], [completed, completed],
      [{ schemaVersion: 1, type: 'tool.proposal', name: 'exec', arguments: { command: 'echo success' } }],
      [{ schemaVersion: 1, type: 'text.delta', text: '{' }, { ...completed, payload: undefined }],
      [{ schemaVersion: 1, type: 'error', code: 'AUTH', retryable: false }],
      [{ schemaVersion: 1, type: 'text.delta', text: '{}' }, completed]]) expect(() => validateProviderResponse(request, events)).toThrow()
  })
  it('does not conflate unknown token usage with zero; fake cancellation is explicit', async () => {
    expect(validateProviderResponse(request, [{ schemaVersion: 1, type: 'usage', usage: { classification: 'uncertain' } }, completed]).origin).toBe('fixture')
    const signal = AbortSignal.abort(); const events = []
    for await (const event of new FixtureProvider([completed]).generate(request, signal)) events.push(event)
    expect(events).toEqual([{ schemaVersion: 1, type: 'error', code: 'CANCELLED', retryable: false }])
  })
  it('rejects invented event fields, forged success, future and cross-job cursors', () => {
    const event = { schemaVersion: 1, ...scope, seq: 1, at: now, stateVersion: 1, type: 'check.result',
      data: { check: 'typecheck', status: 'passed', exitCode: 0, evidenceId: id(11), candidateDigest: hash, origin: 'fixture' } }
    expect(jobEventSchema.parse(event)).toEqual(event)
    expect(jobEventSchema.safeParse({ ...event, data: { ...event.data, stdout: 'secret' } }).success).toBe(false)
    expect(jobEventSchema.safeParse({ ...event, data: { ...event.data, exitCode: 1 } }).success).toBe(false)
    expect(parseEventCursor(`${scope.jobId}:1`, scope.jobId, 1)).toBe(1)
    for (const cursor of [`${id(99)}:1`, `${scope.jobId}:2`, `${scope.jobId}:01`, `${scope.jobId}:9007199254740992`]) expect(() => parseEventCursor(cursor, scope.jobId, 1)).toThrow()
  })
})
