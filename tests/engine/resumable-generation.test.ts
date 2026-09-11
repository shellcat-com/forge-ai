/** Synthetic provider/catalog/storage only; no live acceptance or paid call. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactStore, MemoryObjectBackend } from '../../engine/artifacts/store.ts'
import type { ArtifactRef } from '../../engine/artifacts/store.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import type {
  GenerationEvent,
  GenerationRequest,
  ProviderAdapter,
} from '../../engine/contracts/provider.ts'
import type { FileBatchV1, TemplateManifestV1 } from '../../engine/contracts/source.ts'
import { TemplateCatalog, templateCatalogDigest } from '../../engine/generation/catalog.ts'
import { createTemplateSource, readSourceFile } from '../../engine/generation/source.ts'
import {
  batchScope,
  generateResumableFiles,
  readSavedBatches,
} from '../../engine/generation/resumable.ts'
import type { ResumableFilesInput } from '../../engine/generation/resumable.ts'
import { commandPolicy, plan as fixturePlan, hash } from './fixtures.ts'
import { HostedGenerationStage } from '../../engine/generation/hosted-stage.ts'
import { ProviderRegistry } from '../../engine/providers/registry.ts'
import { hostedCatalog } from '../../engine/providers/hosted-catalog.ts'
import { byokPolicy } from './byok-fixtures.ts'
import type { CallAccounting } from '../../engine/providers/accounting.ts'

async function setup() {
  const encode = (path: string, value: string) => ({
    path,
    mediaType: 'text/plain' as const,
    bytes: new TextEncoder().encode(value),
  })
  const files = [
    encode('package.json', '{"dependencies":{"next":"1.0.0"}}'),
    encode(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/next': {
            version: '1.0.0',
            resolved: 'https://fixture.test/next.tgz',
            integrity: 'sha512-AAAA',
          },
        },
      })
    ),
    encode('tsconfig.json', '{"compilerOptions":{"strict":true}}'),
    encode('README.md', 'Synthetic, never executed'),
    encode('.env.example', 'DATABASE_URL=REPLACE_ME'),
    encode('app/page.tsx', 'export default function Page() { return null }\n'),
  ]
  const manifest: TemplateManifestV1 = {
    schemaVersion: 1,
    template: { id: 'next-postgres-v1', digest: hash, imageDigest: `sha256:${hash}` },
    stack: 'nextjs-strict-typescript-postgresql',
    releases: { next: '1.0.0', node: '1.0.0', postgres: '1.0.0' },
    lockfileDigest: sha256(files[1].bytes),
    commandPolicyDigest: canonicalHash(commandPolicy),
    requiredChecks: commandPolicy.requiredChecks,
    protectedPaths: files.slice(0, 5).map((f) => f.path),
  }
  manifest.template.digest = templateCatalogDigest(manifest, files)
  const catalog = new TemplateCatalog({ manifest, files, evidence: 'fixture' })
  const store = new ArtifactStore(new MemoryObjectBackend())
  const binding = {
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    jobId: randomUUID(),
    credentialId: randomUUID(),
    credentialRevision: 1,
    provider: 'synthetic',
    model: 'synthetic-model',
    providerPolicyDigest: hash,
    promptVersion: 'synthetic-v1',
    repairNumber: 0,
  }
  const base = await createTemplateSource(store, batchScope(binding), catalog, hash)
  const plan = {
    ...fixturePlan,
    templateDigest: catalog.manifest.template.digest,
    presetDigest: hash,
    fileTasks: [
      { path: 'app/page.tsx', instruction: 'Change page' },
      { path: 'app/about/page.tsx', instruction: 'Add about page' },
    ],
  }
  const batches: FileBatchV1[] = [
    {
      schemaVersion: 1,
      planDigest: canonicalHash(plan),
      baseManifestDigest: canonicalHash(base.manifest),
      batchIndex: 0,
      finalBatch: false,
      changes: [
        {
          op: 'replace',
          path: 'app/page.tsx',
          expectedSha256: base.manifest.files.find((f) => f.path === 'app/page.tsx')!.sha256,
          content: 'export default function Page() { return "changed" }\n',
        },
      ],
    },
    {
      schemaVersion: 1,
      planDigest: canonicalHash(plan),
      baseManifestDigest: canonicalHash(base.manifest),
      batchIndex: 1,
      finalBatch: true,
      changes: [
        {
          op: 'create',
          path: 'app/about/page.tsx',
          content: 'export default function About() { return "about" }\n',
        },
      ],
    },
  ]
  let next = 0
  const generated = vi.fn(async function* (): AsyncGenerator<GenerationEvent> {
    yield {
      schemaVersion: 1,
      type: 'completed',
      finish: 'stop',
      origin: 'fixture',
      payload: batches[next++],
    }
  })
  const adapter: ProviderAdapter = {
    id: 'synthetic',
    listModels: async () => [],
    validateCredentials: async () => ({
      schemaVersion: 1,
      configured: true,
      verified: false,
      checkedAt: new Date().toISOString(),
    }),
    generate: generated,
  }
  const saved: ArtifactRef[] = []
  const request = vi.fn((index: number): GenerationRequest => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    model: binding.model,
    stage: 'files',
    promptVersion: binding.promptVersion,
    context: [{ role: 'user', content: 'Synthetic batch ' + index }],
    outputSchemaId: 'FileBatchV1',
    maxOutputTokens: 4000,
    deadlineAt: new Date(Date.now() + 30000).toISOString(),
  }))
  const input: ResumableFilesInput = {
    store,
    catalog,
    adapter,
    binding,
    base,
    plan,
    baseSnapshotId: null,
    savedProducts: [],
    expectedOrigin: 'fixture',
    signal: new AbortController().signal,
    request,
    assertCurrent: vi.fn(async () => undefined),
    hooks: {
      beforeDispatch: vi.fn(async () => ({ callNumber: next + 1 })),
      recordUsage: vi.fn(async () => undefined),
      persistProduct: vi.fn(async () => undefined),
    },
    saveProduct: vi.fn(async (_r, ref) => {
      saved.push(ref)
    }),
    scan: vi.fn(async () => undefined),
    adopt: vi.fn(async () => undefined),
  }
  return { input, store, saved, generated, batches, request }
}
describe('durable one-call source steps', () => {
  it('saves one partial batch, resumes with one further call, and builds real source bytes', async () => {
    const f = await setup()
    const first = await generateResumableFiles(f.input)
    expect(first).toMatchObject({ state: 'continue', nextBatchIndex: 1 })
    expect(f.generated).toHaveBeenCalledTimes(1)
    expect(f.input.adopt).not.toHaveBeenCalled()
    const second = await generateResumableFiles({ ...f.input, savedProducts: first.products })
    expect(f.generated).toHaveBeenCalledTimes(2)
    expect(second.state).toBe('candidate')
    if (second.state !== 'candidate') throw Error('Candidate required')
    expect(
      Buffer.from(
        await readSourceFile(
          f.store,
          batchScope(f.input.binding),
          second.candidate,
          'app/about/page.tsx'
        )
      ).toString()
    ).toContain('"about"')
    expect(second.candidate.manifest.provenance.origin).toBe('fixture')
    expect(f.input.scan).toHaveBeenCalledOnce()
    expect(f.input.adopt).toHaveBeenCalledOnce()
    expect(f.request.mock.calls[1][0]).toBe(1)
  })
  it('recovers after the final product is saved but candidate adoption fails without another provider call', async () => {
    const f = await setup()
    const first = await generateResumableFiles(f.input)
    const failed = {
      ...f.input,
      savedProducts: first.products,
      adopt: async () => {
        throw Error('LEASE_LOST')
      },
    }
    await expect(generateResumableFiles(failed)).rejects.toThrow('LEASE_LOST')
    expect(f.saved).toHaveLength(2)
    const retry = await generateResumableFiles({ ...f.input, savedProducts: f.saved })
    expect(retry.state).toBe('candidate')
    expect(f.generated).toHaveBeenCalledTimes(2)
    expect(f.input.hooks.beforeDispatch).toHaveBeenCalledTimes(2)
  })
  it.each([
    'credentialRevision',
    'model',
    'providerPolicyDigest',
    'repairNumber',
    'promptVersion',
  ] as const)('rejects resumed %s drift before provider dispatch', async (field) => {
    const f = await setup()
    const first = await generateResumableFiles(f.input)
    const b = {
      ...f.input.binding,
      [field]:
        typeof f.input.binding[field] === 'number'
          ? 2
          : field === 'providerPolicyDigest'
            ? 'b'.repeat(64)
            : 'changed',
    }
    await expect(
      generateResumableFiles({ ...f.input, binding: b, savedProducts: first.products })
    ).rejects.toThrow('PROVIDER_BATCH_HISTORY_INVALID')
    expect(f.generated).toHaveBeenCalledTimes(1)
  })
  it('rejects foreign job and project artifacts', async () => {
    const f = await setup()
    const first = await generateResumableFiles(f.input)
    for (const key of ['jobId', 'projectId'] as const) {
      await expect(
        generateResumableFiles({
          ...f.input,
          binding: { ...f.input.binding, [key]: randomUUID() },
          savedProducts: first.products,
        })
      ).rejects.toThrow()
    }
    expect(f.generated).toHaveBeenCalledTimes(1)
  })
  it('rejects duplicate refs, wrong immutable versions and changed hashes', async () => {
    const f = await setup()
    const first = await generateResumableFiles(f.input)
    const ref = first.products[0]
    for (const refs of [
      [ref, ref],
      [{ ...ref, storageVersion: randomUUID() }],
      [{ ...ref, sha256: 'b'.repeat(64) }],
    ]) {
      await expect(readSavedBatches({ ...f.input, refs })).rejects.toThrow()
    }
  })
  it('rejects a false final marker before persisting a partial product', async () => {
    const f = await setup()
    f.batches[0].finalBatch = true
    await expect(generateResumableFiles(f.input)).rejects.toThrow('PROVIDER_BATCH_INCOMPLETE')
    expect(f.saved).toHaveLength(0)
    expect(f.input.hooks.persistProduct).not.toHaveBeenCalled()
  })
  it('rejects changed batch ordering before storage', async () => {
    const f = await setup()
    f.batches[0].batchIndex = 1
    await expect(generateResumableFiles(f.input)).rejects.toThrow('PROVIDER_BATCH_ORDER')
    expect(f.saved).toHaveLength(0)
  })
  it('rejects protected source edits before storage', async () => {
    const f = await setup()
    f.batches[0].changes[0] = { op: 'create', path: 'package.json', content: '{}' }
    await expect(generateResumableFiles(f.input)).rejects.toThrow()
    expect(f.saved).toHaveLength(0)
  })
  it('does not dispatch when accounting refuses a duplicate or exhausted call', async () => {
    const f = await setup()
    f.input.hooks.beforeDispatch = async () => {
      throw Error('PROVIDER_DISPATCH_DENIED')
    }
    await expect(generateResumableFiles(f.input)).rejects.toThrow('PROVIDER_DISPATCH_DENIED')
    expect(f.generated).not.toHaveBeenCalled()
    expect(f.saved).toHaveLength(0)
  })
  it('blocks cancellation after output but before product adoption', async () => {
    const f = await setup()
    let authorized = 0
    f.input.assertCurrent = async () => {
      if (++authorized === 4) throw Error('CANCELLED')
    }
    await expect(generateResumableFiles(f.input)).rejects.toThrow('CANCELLED')
    expect(f.saved).toHaveLength(0)
    expect(f.input.adopt).not.toHaveBeenCalled()
  })
  it('rejects fixture storage/catalog for a production call before accounting', async () => {
    const f = await setup()
    await expect(
      generateResumableFiles({ ...f.input, expectedOrigin: 'provider' })
    ).rejects.toThrow('PROVIDER_SOURCE_CONFIGURATION')
    expect(f.generated).not.toHaveBeenCalled()
  })
  it('does not adopt a candidate when its source scan fails', async () => {
    const f = await setup()
    const first = await generateResumableFiles(f.input)
    await expect(
      generateResumableFiles({
        ...f.input,
        savedProducts: first.products,
        scan: async () => {
          throw Error('SOURCE_REJECTED')
        },
      })
    ).rejects.toThrow('SOURCE_REJECTED')
    expect(f.saved).toHaveLength(2)
    expect(f.input.adopt).not.toHaveBeenCalled()
  })
})

// Explicit structural doubles exercise hosted binding rejection and actual
// accounting hooks. They are not release catalog, storage or provider evidence.
async function hostedSetup() {
  const f = await setup()
  const catalog = new TemplateCatalog({
    manifest: f.input.catalog.manifest,
    files: f.input.catalog.files(),
    evidence: 'release',
  })
  const backend = new MemoryObjectBackend()
  Object.defineProperty(backend, 'evidence', { value: 'durable' })
  const store = new ArtifactStore(backend)
  const preset = { fixture: true }
  const base = await createTemplateSource(
    store,
    batchScope(f.input.binding),
    catalog,
    canonicalHash(preset)
  )
  const provider = hostedCatalog.find((p) => p.id === 'groq')!
  const policy = {
    ...byokPolicy,
    id: provider.id,
    endpoint: provider.endpoint,
    model: provider.models[0],
    price: {
      ...byokPolicy.price,
      version: 'synthetic-free-v1',
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      freeOnly: true as const,
      entitlementDigest: hash,
      validFrom: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  }
  const registry = new ProviderRegistry([policy], [policy.endpoint])
  const binding = {
    ...f.input.binding,
    provider: policy.id,
    model: policy.model,
    providerPolicyDigest: canonicalHash(policy),
  }
  const context = {
    binding,
    stepId: randomUUID(),
    leaseEpoch: 1,
    operationId: randomUUID(),
    deadlineAt: new Date(Date.now() + 40000).toISOString(),
    instruction: 'Create a basic page',
    brief: 'Create a basic page',
    preset,
    templateGuidance: 'Synthetic test configuration; no source execution.',
    base,
  }
  const accounting: CallAccounting = {
    reserve: vi.fn(async (t) => ({
      created: true,
      receipt: {
        ...batchScope(binding),
        requestId: t.requestId,
        termsDigest: canonicalHash(t),
        callNumber: 1,
      },
    })),
    dispatch: vi.fn(async () => true),
    settle: vi.fn(async () => undefined),
  }
  const ports = {
    accounting,
    assertCurrent: vi.fn(async () => undefined),
    credential: vi.fn(async () => null),
    saveProduct: vi.fn(async () => undefined),
  }
  const stage = new HostedGenerationStage(registry, store, catalog, ports)
  return { ...f, context, registry, policy, ports, stage, hostedStore: store, catalog }
}
describe('actual hosted source composition guard', () => {
  it('rejects fixture catalog/storage at construction', async () => {
    const f = await hostedSetup()
    expect(() => new HostedGenerationStage(f.registry, f.store, f.input.catalog, f.ports)).toThrow(
      'HOSTED_SOURCE_CONFIGURATION'
    )
  })
  it.each(['model', 'providerPolicyDigest', 'provider'] as const)(
    'rejects pinned %s changes before a key or provider call',
    async (field) => {
      const f = await hostedSetup()
      const changed = {
        ...f.context,
        binding: {
          ...f.context.binding,
          [field]:
            field === 'providerPolicyDigest'
              ? 'b'.repeat(64)
              : field === 'provider'
                ? 'openrouter'
                : 'changed',
        },
      }
      await expect(
        f.stage.plan(changed, commandPolicy, new AbortController().signal)
      ).rejects.toThrow()
      expect(f.ports.credential).not.toHaveBeenCalled()
      expect(f.ports.accounting.reserve).not.toHaveBeenCalled()
    }
  )
  it('rejects a stale or overlong step deadline before reserving a call', async () => {
    const f = await hostedSetup()
    for (const offset of [-1, 46000])
      await expect(
        f.stage.plan(
          { ...f.context, deadlineAt: new Date(Date.now() + offset).toISOString() },
          commandPolicy,
          new AbortController().signal
        )
      ).rejects.toThrow('HOSTED_GENERATION_BINDING')
    expect(f.ports.accounting.reserve).not.toHaveBeenCalled()
  })
  it('rejects altered execution policy without contacting a model', async () => {
    const f = await hostedSetup()
    await expect(
      f.stage.plan(
        f.context,
        { ...commandPolicy, resources: { ...commandPolicy.resources, maxCostMicros: 1 } },
        new AbortController().signal
      )
    ).rejects.toThrow('HOSTED_GENERATION_BINDING')
    expect(f.ports.credential).not.toHaveBeenCalled()
  })
  it('a missing user key is charged as an uncertain attempt and never produces source', async () => {
    const f = await hostedSetup()
    await expect(
      f.stage.plan(f.context, commandPolicy, new AbortController().signal)
    ).rejects.toThrow()
    expect(f.ports.accounting.reserve).toHaveBeenCalledOnce()
    expect(f.ports.accounting.dispatch).toHaveBeenCalledOnce()
    expect(f.ports.credential).toHaveBeenCalledOnce()
    expect(f.ports.accounting.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ classification: 'uncertain' })
    )
    expect(f.ports.saveProduct).not.toHaveBeenCalled()
  })
  it('validates plan bytes and durably saves the plan only after accounting and current authority', async () => {
    const f = await hostedSetup()
    const payload = {
      ...f.input.plan,
      briefHash: sha256(f.context.instruction),
      templateDigest: f.catalog.manifest.template.digest,
      presetDigest: canonicalHash(f.context.preset),
    }
    // Test-only substitution; the production class has no fixture transport option.
    vi.spyOn(f.registry, 'adapter').mockReturnValue({
      id: f.policy.id,
      generate: async function* () {
        yield { schemaVersion: 1, type: 'completed', origin: 'provider', finish: 'stop', payload }
      },
      listModels: async () => [],
      validateCredentials: async () => ({
        schemaVersion: 1,
        configured: true,
        verified: false,
        checkedAt: new Date().toISOString(),
      }),
    } as unknown as ReturnType<ProviderRegistry['adapter']>)
    const result = await f.stage.plan(f.context, commandPolicy, new AbortController().signal)
    expect(result.artifact.kind).toBe('plan')
    expect(result.artifact.backendEvidence).toBe('durable')
    expect(
      JSON.parse(
        Buffer.from(
          await f.hostedStore.read(batchScope(f.context.binding), result.artifact)
        ).toString()
      )
    ).toEqual(payload)
    expect(f.ports.saveProduct).toHaveBeenCalledOnce()
  })
})
