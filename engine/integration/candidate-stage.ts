import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { commandPolicySchema } from '../contracts/review.ts'
import type { ExecutionReviewV1 } from '../contracts/review.ts'
import { planSchema, fileBatchSchema } from '../contracts/source.ts'
import { buildGenerationRequest } from '../generation/context.ts'
import { generatePlan, generateFileBatches } from '../generation/pipeline.ts'
import type { ProviderAttemptHooks } from '../generation/pipeline.ts'
import {
  buildCandidate,
  createTemplateSource,
  prepareDiff,
  readSourceFile,
} from '../generation/source.ts'
import { FixtureProvider } from '../testing/fakes.ts'
import { FixtureStageAdapter } from '../control/fixture-stage.ts'
import type { ControlCatalog } from '../control/catalog.ts'
import type { StageAdapter, StageInput, StageResult } from '../control/stage-adapter.ts'
import type { SourceRepository } from './source-repository.ts'

export const candidateImageDigest = `sha256:${sha256('E2 NONRELEASE synthetic candidate image; no image exists or is dispatched')}`
/** Caller loads reviewed candidate bytes/preset server-side. No import of template
 * trees is required by the standalone control build. D7 release stays blocked. */
export function candidateControlCatalog(
  sources: SourceRepository,
  policyInput: ExecutionReviewV1['commandPolicy'],
  preset: { id: string; version: number }
): ControlCatalog {
  const policy = commandPolicySchema.parse(policyInput)
  if (
    sources.catalog.evidence !== 'fixture' ||
    sources.catalog.manifest.template.imageDigest !== candidateImageDigest ||
    policy.resources.maxCostMicros !== 0 ||
    canonicalHash(policy) !== sources.catalog.manifest.commandPolicyDigest
  )
    throw new Error('Candidate fixture catalog binding')
  const selected = { ...preset }
  return Object.freeze({
    name: 'e2-candidate-fixture' as const,
    templateDigest: sources.catalog.manifest.template.digest,
    imageDigest: candidateImageDigest,
    presetDigest: canonicalHash(preset),
    policy: (cap: number) => {
      if (cap !== 0) throw new Error('Candidate fixture must cost zero')
      return structuredClone(policy)
    },
    assertProject: (id: string, version: number) => {
      if (id !== selected.id || version !== selected.version)
        throw new Error('Candidate preset unavailable')
    },
  })
}
/** One explicitly fake provider product per E1-reserved stage. All source and
 * context validation/storage are real; checks, databases and previews are fake. */
export class CandidateStageAdapter implements StageAdapter {
  readonly origin = 'fixture' as const
  private readonly preset: unknown
  private readonly execution = new FixtureStageAdapter()
  constructor(
    readonly sources: SourceRepository,
    readonly catalog: ControlCatalog,
    preset: unknown
  ) {
    this.preset = structuredClone(preset)
    if (
      canonicalHash(this.preset) !== catalog.presetDigest ||
      catalog.name !== 'e2-candidate-fixture' ||
      sources.catalog.manifest.template.digest !== catalog.templateDigest
    )
      throw new Error('Candidate catalog mismatch')
  }
  async run(input: StageInput, signal: AbortSignal): Promise<StageResult> {
    signal.throwIfAborted()
    const policy = this.catalog.policy(input.maxCostMicros)
    const scope = { workspaceId: input.workspaceId, projectId: input.projectId, jobId: input.jobId }
    if (!['PLANNING', 'GENERATING', 'REPAIRING'].includes(input.stage)) {
      const result = await this.execution.run(input, signal)
      // Explicit E1 fake receipts bound to this NONRELEASE catalog; never dispatch.
      if (result.kind === 'verification')
        return {
          ...result,
          verification: {
            ...result.verification,
            templateDigest: this.catalog.templateDigest,
            imageDigest: this.catalog.imageDigest,
            policyDigest: canonicalHash(policy),
          },
        }
      return result
    }
    const base =
      input.baseSource ??
      (await createTemplateSource(
        this.sources.store,
        scope,
        this.sources.catalog,
        canonicalHash(this.preset)
      ))
    await this.sources.validate(scope, base)
    let dispatched = false
    // E1 already reserved the one UNIQUE(job,step) attempt. This local hook only
    // forbids hidden batching. E1 persists the final stage result before adoption.
    const hooks: ProviderAttemptHooks = {
      beforeDispatch: async () => {
        if (dispatched) throw new Error('One product per E1 stage')
        dispatched = true
        return { callNumber: 1 }
      },
      recordUsage: async () => undefined,
      persistProduct: async () => undefined,
    }
    const request = (stage: 'plan' | 'files' | 'repair') =>
      buildGenerationRequest({
        requestId: input.operationId,
        model: 'explicit-e2-fixture',
        stage,
        promptVersion: 'fixture-e1-v1',
        deadlineAt: new Date(Date.now() + 120000).toISOString(),
        maxOutputTokens: 8192,
        templateGuidance:
          'Synthetic candidate source demonstration; no live model or released image.',
        preset: this.preset,
        brief: input.instruction,
        instruction: input.instruction,
        base: base.manifest,
        ...(stage === 'plan' ? {} : { plan: input.plan, batchIndex: 0, completedPaths: [] }),
      })
    if (input.stage === 'PLANNING') {
      const product = planSchema.parse({
        schemaVersion: 1,
        briefHash: sha256(input.instruction),
        templateDigest: this.catalog.templateDigest,
        presetDigest: canonicalHash(this.preset),
        userStories: ['Display an explicitly synthetic source candidate'],
        routes: [{ path: '/', purpose: 'Synthetic source demonstration' }],
        dataEntities: [],
        apiOperations: [],
        fileTasks: [
          { path: 'app/page.tsx', instruction: 'Render the explicit source fixture label' },
        ],
        migrationIntent: [],
        requiredChecks: policy.requiredChecks,
        unsupportedRequirements: [],
        assumptions: ['Provider, execution and preview evidence remains fixture-only'],
        resources: policy.resources,
        network: policy.network,
      })
      const provider = new FixtureProvider([
        {
          schemaVersion: 1,
          type: 'completed',
          origin: 'fixture',
          finish: 'stop',
          payload: product,
        },
      ])
      const result = await generatePlan(provider, request('plan'), signal, hooks, {
        briefHash: sha256(input.instruction),
        templateDigest: this.catalog.templateDigest,
        presetDigest: canonicalHash(this.preset),
        commandPolicy: policy,
      })
      return {
        schemaVersion: 1,
        origin: 'fixture',
        kind: 'stored-plan',
        plan: result.plan,
        base,
        planArtifact: await this.sources.store.putJson(scope, 'plan', result.plan),
      }
    }
    if (!input.plan || !input.baseSource) throw new Error('Persisted approved plan/base required')
    if (input.stage === 'REPAIRING' && !input.manifest)
      throw new Error('Failed candidate manifest required for fixture repair')
    // The admitted base remains fixed for review. Bind each explicit fixture
    // repair to the failed candidate and reserved operation so it changes source
    // bytes/diff, rather than merely receiving fresh random artifact IDs.
    const repairNote = input.stage === 'REPAIRING'
      ? `// Explicit fixture repair for ${canonicalHash(input.manifest!)}; operation ${input.operationId}; diagnostic FIXTURE_CHECK_FAILURE.\n`
      : ''
    const content = `// Explicit E2 synthetic source candidate ${input.jobId}; no model generated this code.\n${repairNote}export default function Page() { return <main><h1>Synthetic candidate source</h1><p>Build, database, and preview checks are fixtures.</p></main> }\n`
    const prior = base.manifest.files.find((f) => f.path === 'app/page.tsx')!
    await readSourceFile(this.sources.store, scope, base, prior.path)
    const batch = fileBatchSchema.parse({
      schemaVersion: 1,
      planDigest: canonicalHash(input.plan),
      baseManifestDigest: canonicalHash(base.manifest),
      batchIndex: 0,
      finalBatch: true,
      changes: [{ op: 'replace', path: prior.path, expectedSha256: prior.sha256, content }],
    })
    const provider = new FixtureProvider([
      { schemaVersion: 1, type: 'completed', origin: 'fixture', finish: 'stop', payload: batch },
    ])
    const generated = await generateFileBatches({
      adapter: provider,
      plan: input.plan,
      base: base.manifest,
      protectedPaths: this.sources.catalog.manifest.protectedPaths,
      signal,
      hooks,
      request: () => request(input.stage === 'REPAIRING' ? 'repair' : 'files'),
    })
    const source = await buildCandidate(this.sources.store, scope, this.sources.catalog, {
      plan: input.plan,
      base,
      batches: generated.batches,
      baseSnapshotId: input.baseSnapshotId,
      provenance: {
        origin: 'fixture',
        jobId: input.jobId,
        provider: null,
        model: null,
        promptVersion: 'fixture-e1-v1',
      },
    })
    const diff = await prepareDiff(this.sources.store, scope, base, source)
    return {
      schemaVersion: 1,
      origin: 'fixture',
      kind: 'stored-candidate',
      source,
      diff: diff.artifact,
    }
  }
}
