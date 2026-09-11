import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { commandPolicySchema } from '../contracts/review.ts'
import type { ExecutionReviewV1 } from '../contracts/review.ts'
import type { GenerationRequest } from '../contracts/provider.ts'
import type { ArtifactRef, ArtifactStore } from '../artifacts/store.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import { hostedProviderId } from '../providers/hosted-catalog.ts'
import { accountedProviderHooks } from '../providers/accounting.ts'
import type { CallAccounting } from '../providers/accounting.ts'
import type { TemplateCatalog } from './catalog.ts'
import { buildGenerationRequest } from './context.ts'
import type { ContextInput } from './context.ts'
import { generatePlan } from './pipeline.ts'
import { batchBindingSchema, batchScope, generateResumableFiles } from './resumable.ts'
import type { BatchBinding, ResumableFilesInput } from './resumable.ts'
import { validateStoredSource } from './source.ts'
import type { StoredSource } from './source.ts'

/** Only server-owned E1 context. Never construct from request JSON. Each dispatch
 * is one existing durable job_step and one existing provider_attempts operation.
 * Accounting and save/adopt ports must serialize against the same current lease,
 * account/session, provider choice/revision, expiry and free-capacity authority. */
export interface HostedGenerationContext {
  binding: BatchBinding
  stepId: string
  leaseEpoch: number
  operationId: string
  deadlineAt: string
  instruction: string
  brief: string
  preset: unknown
  templateGuidance: string
  source?: ContextInput['source']
  diagnostics?: ContextInput['diagnostics']
  base: StoredSource
}
export interface HostedGenerationPorts {
  accounting: CallAccounting
  assertCurrent(context: Readonly<HostedGenerationContext>, signal: AbortSignal): Promise<void>
  /** Resolve this user's exact pinned key only, after fresh current authorization.
   * No operator key, env fallback, browser token, model switch or discovery. */
  credential(
    context: Readonly<HostedGenerationContext>,
    signal: AbortSignal
  ): Promise<string | null>
  /** Atomically adopt the immutable product ref for recovery. Worker-step success
   * and its next state are separately committed by the fenced outbox settlement. */
  saveProduct(
    context: Readonly<HostedGenerationContext>,
    request: GenerationRequest,
    ref: ArtifactRef,
    signal: AbortSignal
  ): Promise<void>
}

/** Actual hosted adapters only; no fixture fetch seam or synthetic default. This
 * component performs bounded model/source work, never executes generated code,
 * approves a review, promotes a snapshot or starts a sandbox. */
export class HostedGenerationStage {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly store: ArtifactStore,
    private readonly catalog: TemplateCatalog,
    private readonly ports: HostedGenerationPorts
  ) {
    if (store.evidence !== 'durable' || catalog.evidence !== 'release')
      throw new Error('HOSTED_SOURCE_CONFIGURATION')
  }
  private prepare(
    raw: HostedGenerationContext,
    signal: AbortSignal,
    stage: GenerationRequest['stage']
  ) {
    // Snapshot caller-owned fields; mutation during asynchronous authorization
    // cannot change a pinned model, key revision, source or operation identity.
    const context = structuredClone(raw)
    context.binding = batchBindingSchema.parse(context.binding)
    const b = context.binding
    hostedProviderId.parse(b.provider)
    const policy = this.registry.policy(b.provider, stage)
    const remaining = Date.parse(context.deadlineAt) - Date.now()
    if (
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > 45_000 ||
      !Number.isSafeInteger(context.leaseEpoch) ||
      context.leaseEpoch < 1 ||
      !policy.price.freeOnly ||
      policy.price.inputMicrosPerMillion !== 0 ||
      policy.price.outputMicrosPerMillion !== 0 ||
      policy.model !== b.model ||
      canonicalHash(policy) !== b.providerPolicyDigest ||
      Date.parse(context.deadlineAt) > Date.parse(policy.price.expiresAt) ||
      context.base.manifest.template.digest !== this.catalog.manifest.template.digest ||
      canonicalHash(context.preset) !== context.base.manifest.presetDigest
    )
      throw new Error('HOSTED_GENERATION_BINDING')
    const current = async () => {
      signal.throwIfAborted()
      if (Date.now() >= Date.parse(context.deadlineAt)) throw new Error('HOSTED_GENERATION_EXPIRED')
      await this.ports.assertCurrent(context, signal)
      signal.throwIfAborted()
      if (Date.now() >= Date.parse(context.deadlineAt)) throw new Error('HOSTED_GENERATION_EXPIRED')
    }
    const adapter = this.registry.adapter(b.provider, async (credentialSignal) => {
      await current()
      credentialSignal.throwIfAborted()
      return this.ports.credential(context, AbortSignal.any([signal, credentialSignal]))
    })
    const hooks = accountedProviderHooks({
      accounting: this.ports.accounting,
      policy,
      binding: {
        ...batchScope(b),
        credentialId: b.credentialId,
        credentialRevision: b.credentialRevision,
        repairNumber: b.repairNumber,
        stepId: context.stepId,
        leaseEpoch: context.leaseEpoch,
      },
      persistProduct: async () => {
        await current()
      },
    })
    const request = (extra: Pick<ContextInput, 'plan' | 'batchIndex' | 'completedPaths'> = {}) =>
      buildGenerationRequest({
        ...context,
        ...extra,
        requestId: context.operationId,
        model: b.model,
        stage,
        promptVersion: b.promptVersion,
        base: context.base.manifest,
        maxOutputTokens: Math.min(policy.maxOutputTokens, 8192),
      })
    const save = async (r: GenerationRequest, ref: ArtifactRef) => {
      await current()
      await this.ports.saveProduct(context, r, ref, signal)
    }
    return { context, adapter, hooks, current, request, save }
  }
  async plan(
    context: HostedGenerationContext,
    commandPolicy: ExecutionReviewV1['commandPolicy'],
    signal: AbortSignal
  ) {
    const prepared = this.prepare(context, signal, 'plan')
    if (prepared.context.binding.repairNumber !== 0) throw new Error('HOSTED_GENERATION_BINDING')
    const policy = commandPolicySchema.parse(commandPolicy)
    if (
      canonicalHash(policy) !== this.catalog.manifest.commandPolicyDigest ||
      policy.resources.maxCostMicros !== 0
    )
      throw new Error('HOSTED_GENERATION_BINDING')
    await prepared.current()
    await validateStoredSource(
      this.store,
      batchScope(prepared.context.binding),
      prepared.context.base,
      this.catalog
    )
    let artifact: ArtifactRef | undefined
    const result = await generatePlan(
      prepared.adapter,
      prepared.request(),
      signal,
      {
        ...prepared.hooks,
        persistProduct: async (r, product) => {
          if (product.origin !== 'provider') throw new Error('HOSTED_SOURCE_ORIGIN')
          await prepared.hooks.persistProduct(r, product)
          artifact = await this.store.putJson(
            batchScope(prepared.context.binding),
            'plan',
            product.payload
          )
          await prepared.save(r, artifact)
        },
      },
      {
        briefHash: sha256(prepared.context.instruction),
        templateDigest: this.catalog.manifest.template.digest,
        presetDigest: prepared.context.base.manifest.presetDigest,
        commandPolicy: policy,
      }
    )
    if (!artifact) throw new Error('HOSTED_PLAN_NOT_SAVED')
    return { origin: 'provider' as const, plan: result.plan, artifact }
  }
  async files(
    context: HostedGenerationContext,
    input: Pick<
      ResumableFilesInput,
      'plan' | 'baseSnapshotId' | 'savedProducts' | 'scan' | 'adopt'
    >,
    signal: AbortSignal
  ) {
    const prepared = this.prepare(
      context,
      signal,
      context.binding.repairNumber ? 'repair' : 'files'
    )
    return generateResumableFiles({
      ...input,
      adapter: prepared.adapter,
      store: this.store,
      catalog: this.catalog,
      binding: prepared.context.binding,
      base: prepared.context.base,
      expectedOrigin: 'provider',
      signal,
      hooks: prepared.hooks,
      assertCurrent: prepared.current,
      saveProduct: prepared.save,
      request: (batchIndex, completedPaths) =>
        prepared.request({ plan: input.plan, batchIndex, completedPaths }),
    })
  }
}
