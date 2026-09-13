import { z } from 'zod'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import {
  checkIds,
  digest,
  imageDigest,
  label,
  timestamp,
  uint,
  uuid,
} from '../contracts/primitives.ts'

const result = z.enum(['passed', 'failed', 'not-run'])
export const exportCheckIds = [
  'source-only',
  'secret-scan',
  'clean-environment',
  'lockfile-install',
  'postgres-migration',
  'build',
  'http-run',
] as const
export const providerPinsSchema = z.strictObject({
  provider: label,
  modelSnapshot: label,
  adapterDigest: digest,
  endpointDigest: digest,
  promptDigest: digest,
  modelPolicyDigest: digest,
  templateDigest: digest,
  imageDigest,
  commandPolicyDigest: digest,
  scannerPolicyDigest: digest,
  priceDigest: digest,
})
export const providerPriceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  currency: z.literal('USD'),
  provider: label,
  modelSnapshot: label,
  version: label,
  validFrom: timestamp,
  expiresAt: timestamp,
  inputMicrosPerMillion: uint,
  outputMicrosPerMillion: uint,
  requestMicros: uint,
  billableTokenCoverage: z.literal('all-billable-input-and-output'),
  billableBoundEvidenceDigest: digest,
})
export type ProviderPrice = z.infer<typeof providerPriceSchema>
/** Arithmetic proposal only: never reserves a balance or authorizes dispatch.
 * Bounds MUST include provider framing, hidden billable tokens and rounding. */
export function quoteProviderReservation(
  priceInput: unknown,
  inputBound: number,
  outputBound: number,
  now: number
) {
  const price = providerPriceSchema.parse(priceInput)
  uint.parse(inputBound)
  uint.parse(outputBound)
  if (
    !Number.isSafeInteger(now) ||
    Date.parse(price.validFrom) > now ||
    Date.parse(price.expiresAt) <= now
  )
    throw new Error('PRICE_NOT_CURRENT')
  const ceilMillion = (amount: bigint) => (amount + 999999n) / 1000000n
  return {
    priceDigest: canonicalHash(price),
    maximumMicros: (
      ceilMillion(BigInt(inputBound) * BigInt(price.inputMicrosPerMillion)) +
      ceilMillion(BigInt(outputBound) * BigInt(price.outputMicrosPerMillion)) +
      BigInt(price.requestMicros)
    ).toString(),
    dispatchAuthorized: false as const,
  }
}

/** Frozen proposal, not generated fixtures or benchmark outcomes. Five independent
 * repetitions per case yield 30 slots; priority cases require an approved base. */
export function providerReferenceCorpus() {
  return {
    schemaVersion: 1 as const,
    version: 'forge-provider-reference-v1',
    cases: [
      {
        id: 'board-basic',
        workload: 'task-board' as const,
        base: 'template',
        baseCaseId: null,
        instruction:
          'Build a PostgreSQL task board with title, description, status, create, edit and delete. Persist tasks across app restart. Include empty and validation states.',
      },
      {
        id: 'board-keyboard',
        workload: 'task-board' as const,
        base: 'template',
        baseCaseId: null,
        instruction:
          'Build a task board with keyboard-accessible create, edit and delete, status filtering, clear form errors and responsive layouts. Store task data in PostgreSQL.',
      },
      {
        id: 'priority-filter',
        workload: 'task-board-priority' as const,
        base: 'verified-task-board',
        baseCaseId: 'board-basic',
        instruction:
          'Add low, normal and high priority to the existing task board with an append-only migration and priority filter. Preserve existing tasks and CRUD behavior.',
      },
      {
        id: 'priority-sort',
        workload: 'task-board-priority' as const,
        base: 'verified-task-board',
        baseCaseId: 'board-keyboard',
        instruction:
          'Extend the existing task board with priority, accessible editing and priority sorting. Keep prior data intact and validate fresh and prior-seeded PostgreSQL migrations.',
      },
      {
        id: 'pomodoro-history',
        workload: 'pomodoro-history' as const,
        base: 'template',
        baseCaseId: null,
        instruction:
          'Build a Pomodoro timer with start, pause and reset, accessible controls and PostgreSQL session history. Completed sessions must survive an app-process restart.',
      },
      {
        id: 'pomodoro-summary',
        workload: 'pomodoro-history' as const,
        base: 'template',
        baseCaseId: null,
        instruction:
          'Build a Pomodoro timer with work and break modes, keyboard controls, persisted completed-session history and daily totals. Include responsive empty and error states.',
      },
    ],
  }
}
const callSchema = z.strictObject({
  id: uuid,
  stage: z.enum(['plan', 'files', 'repair']),
  inputTokenBound: uint,
  outputTokenBound: uint,
  reservedMicros: uint,
  priceDigest: digest,
  usage: z.strictObject({
    classification: z.enum(['measured', 'estimated', 'uncertain']),
    inputTokens: uint.nullable(),
    outputTokens: uint.nullable(),
    chargedMicros: uint.nullable(),
  }),
})
const checkSchema = z.strictObject({ checkId: z.enum(checkIds), result })
const exportSchema = z.strictObject({
  origin: z.enum(['live', 'fixture']),
  candidateDigest: digest,
  archiveDigest: digest,
  checks: z
    .array(z.strictObject({ checkId: z.enum(exportCheckIds), result }))
    .length(exportCheckIds.length),
})
export const providerRunSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: uuid,
    caseId: label,
    repetition: uint.min(1).max(100),
    corpusDigest: digest,
    pins: providerPinsSchema,
    origin: z.enum(['live', 'fixture']),
    outcome: z.enum(['passed', 'failed', 'timeout', 'cancelled', 'denied']),
    failureCode: z.enum([
      'AUTH',
      'RATE_LIMIT',
      'TIMEOUT',
      'REFUSAL',
      'INVALID_OUTPUT',
      'UNAVAILABLE',
      'CHECK_FAILURE',
      'CANCELLED',
      'QUOTA',
      'NONE',
    ]),
    repairs: uint.max(100),
    calls: z.array(callSchema).max(100),
    activeMs: uint.nullable(),
    structuredSource: result,
    candidateDigest: digest.nullable(),
    baseSourceDigest: digest.nullable(),
    checks: z.array(checkSchema).length(checkIds.length),
    promoted: z.boolean(),
    export: exportSchema.nullable(),
  })
  .superRefine((run, ctx) => {
    if (
      new Set(run.calls.map((c) => c.id)).size !== run.calls.length ||
      new Set(run.checks.map((c) => c.checkId)).size !== checkIds.length ||
      (run.export &&
        new Set(run.export.checks.map((c) => c.checkId)).size !== exportCheckIds.length)
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate evidence component' })
    if (
      run.export &&
      (run.export.origin !== run.origin || run.export.candidateDigest !== run.candidateDigest)
    )
      ctx.addIssue({ code: 'custom', message: 'Export evidence binding' })
    if (
      run.outcome === 'denied' &&
      (run.calls.length ||
        run.promoted ||
        run.candidateDigest ||
        run.export ||
        run.structuredSource !== 'not-run' ||
        run.checks.some((c) => c.result !== 'not-run'))
    )
      ctx.addIssue({ code: 'custom', message: 'Denied run has side effects' })
  })
export type ProviderRun = z.infer<typeof providerRunSchema>
export const providerEvaluationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    origin: z.enum(['live', 'fixture']),
    startedAt: timestamp,
    finishedAt: timestamp,
    expiresAt: timestamp,
    repetitions: uint.min(5).max(100),
    corpusDigest: digest,
    pins: providerPinsSchema,
    price: providerPriceSchema,
    approvedModelEnvelopeMicros: uint,
    perJobLimitMicros: uint,
    samples: z.array(z.strictObject({ run: providerRunSchema, receiptDigest: digest })).max(600),
  })
  .superRefine((campaign, ctx) => {
    const ids = new Set<string>(),
      slots = new Set<string>(),
      calls = new Set<string>()
    const corpus = providerReferenceCorpus()
    if (
      campaign.corpusDigest !== canonicalHash(corpus) ||
      campaign.pins.priceDigest !== canonicalHash(campaign.price) ||
      campaign.pins.provider !== campaign.price.provider ||
      campaign.pins.modelSnapshot !== campaign.price.modelSnapshot ||
      Date.parse(campaign.finishedAt) < Date.parse(campaign.startedAt) ||
      Date.parse(campaign.expiresAt) <= Date.parse(campaign.finishedAt)
    )
      ctx.addIssue({ code: 'custom', message: 'Campaign binding' })
    for (const { run } of campaign.samples) {
      const slot = `${run.caseId}:${run.repetition}`
      if (
        ids.has(run.id) ||
        slots.has(slot) ||
        run.calls.some((c) => calls.has(c.id)) ||
        run.repetition > campaign.repetitions ||
        run.origin !== campaign.origin ||
        run.corpusDigest !== campaign.corpusDigest ||
        canonicalHash(run.pins) !== canonicalHash(campaign.pins) ||
        !corpus.cases.some((c) => c.id === run.caseId) ||
        run.calls.some((c) => c.priceDigest !== campaign.pins.priceDigest)
      )
        ctx.addIssue({ code: 'custom', message: 'Mixed, duplicate or unplanned evidence' })
      ids.add(run.id)
      slots.add(slot)
      run.calls.forEach((c) => calls.add(c.id))
    }
  })
export interface ProviderEvidenceReader {
  /** Trusted evidence-store boundary; must verify signer/attestation, ownership,
   * original producer provenance and revocation. Digest alone is not provenance. */
  read(
    receiptDigest: string,
    signal: AbortSignal
  ): Promise<{
    bytes: Uint8Array
    authenticated: boolean
    origin: 'live' | 'fixture'
    revoked: boolean
    expiresAt: string
  }>
}
const percentile = (values: number[], fraction: number) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null
function wilson(passed: number, total: number) {
  if (!total) return null
  const z = 1.959963984540054,
    p = passed / total,
    divisor = 1 + (z * z) / total
  const center = (p + (z * z) / (2 * total)) / divisor
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / divisor
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}
async function boundedReceipt(reader: ProviderEvidenceReader, hash: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error('EVIDENCE_DEADLINE')
  let abort: () => void = () => undefined
  try {
    return await Promise.race([
      reader.read(hash, signal),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('EVIDENCE_DEADLINE'))
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } catch {
    throw new Error(signal.aborted ? 'EVIDENCE_DEADLINE' : 'INVALID_PROVIDER_EVIDENCE')
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
/** Offline by default. Even authenticated captured results never enable a model,
 * reserve funds, contact a provider, launch source or declare alpha release. */
export async function evaluateProviderEvidence(
  input: unknown,
  options: { reader?: ProviderEvidenceReader; now?: number; signal?: AbortSignal } = {}
) {
  const parsed = providerEvaluationSchema.safeParse(input)
  if (!parsed.success) throw new Error('INVALID_PROVIDER_EVALUATION')
  const campaign = parsed.data,
    now = options.now ?? Date.now(),
    corpus = providerReferenceCorpus()
  if (!Number.isSafeInteger(now)) throw new Error('INVALID_EVALUATION_TIME')
  const fresh =
    Date.parse(campaign.finishedAt) <= now &&
    Date.parse(campaign.expiresAt) > now &&
    Date.parse(campaign.price.validFrom) <= Date.parse(campaign.startedAt) &&
    Date.parse(campaign.price.expiresAt) > Date.parse(campaign.finishedAt)
  const controller = new AbortController(),
    abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = setTimeout(abort, 60000)
  let verified = 0
  try {
    if (options.reader)
      for (const sample of campaign.samples) {
        const receipt = await boundedReceipt(
          options.reader,
          sample.receiptDigest,
          controller.signal
        )
        if (
          !receipt.authenticated ||
          receipt.revoked ||
          receipt.origin !== campaign.origin ||
          Date.parse(receipt.expiresAt) <= now ||
          !Number.isFinite(Date.parse(receipt.expiresAt)) ||
          receipt.bytes.length > 1024 * 1024 ||
          sha256(receipt.bytes) !== sample.receiptDigest
        )
          throw new Error('INVALID_PROVIDER_EVIDENCE')
        let raw: unknown
        try {
          raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receipt.bytes))
        } catch {
          throw new Error('INVALID_PROVIDER_EVIDENCE')
        }
        const evidence = providerRunSchema.safeParse(raw)
        if (!evidence.success || canonicalHash(evidence.data) !== canonicalHash(sample.run))
          throw new Error('INVALID_PROVIDER_EVIDENCE')
        verified++
      }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    controller.abort()
  }
  const admitted = campaign.samples.filter((s) => s.run.outcome !== 'denied')
  const dispatchedRuns = admitted.filter((s) => s.run.calls.length > 0).length
  let observed = 0n,
    liability = 0n,
    unknownCalls = 0,
    unknownRuns = 0,
    violations = 0,
    sourcePassed = 0,
    buildPassed = 0,
    exportPassed = 0,
    unsafePromotions = 0
  const measuredRunCosts: number[] = [],
    perCase = Object.fromEntries(
      corpus.cases.map((c) => [
        c.id,
        { attempts: 0, admitted: 0, buildsPassed: 0, exportsPassed: 0 },
      ])
    )
  for (const { run } of campaign.samples) {
    let unsafe =
        run.repairs > 2 ||
        run.calls.length > 12 ||
        (run.repairs === 0 && run.calls.some((c) => c.stage === 'repair')),
      runUnknown = false,
      runCharge = 0n,
      runLiability = 0n
    for (const call of run.calls) {
      const usage = call.usage
      let required: bigint | null = null
      try {
        required = BigInt(
          quoteProviderReservation(
            campaign.price,
            call.inputTokenBound,
            call.outputTokenBound,
            Date.parse(campaign.startedAt)
          ).maximumMicros
        )
      } catch {
        unsafe = true
      }
      if (required !== null && BigInt(call.reservedMicros) < required) unsafe = true
      if (
        (usage.inputTokens !== null && usage.inputTokens > call.inputTokenBound) ||
        (usage.outputTokens !== null && usage.outputTokens > call.outputTokenBound) ||
        (usage.chargedMicros !== null && usage.chargedMicros > call.reservedMicros)
      )
        unsafe = true
      const unknown =
        usage.classification !== 'measured' ||
        usage.inputTokens === null ||
        usage.outputTokens === null ||
        usage.chargedMicros === null
      if (unknown) {
        unknownCalls++
        runUnknown = true
      }
      const charge = BigInt(usage.chargedMicros ?? 0)
      runCharge += charge
      runLiability += unknown
        ? charge > BigInt(call.reservedMicros)
          ? charge
          : BigInt(call.reservedMicros)
        : charge
    }
    if (runLiability > BigInt(campaign.perJobLimitMicros)) unsafe = true
    observed += runCharge
    liability += runLiability
    if (runUnknown) unknownRuns++
    else if (run.outcome !== 'denied' && runCharge <= BigInt(Number.MAX_SAFE_INTEGER))
      measuredRunCosts.push(Number(runCharge))
    const spec = corpus.cases.find((c) => c.id === run.caseId)!
    if (run.outcome !== 'denied' && spec.base === 'verified-task-board' && !run.baseSourceDigest)
      unsafe = true
    if (run.outcome !== 'denied' && spec.baseCaseId) {
      const prior = campaign.samples.find(
        (s) => s.run.caseId === spec.baseCaseId && s.run.repetition === run.repetition
      )?.run
      if (
        !prior ||
        prior.outcome !== 'passed' ||
        prior.candidateDigest !== run.baseSourceDigest ||
        prior.checks.some((c) => c.result !== 'passed')
      )
        unsafe = true
    }
    const sourceOK = run.structuredSource === 'passed' && run.candidateDigest !== null
    const checksOK = run.checks.every((c) => c.result === 'passed')
    const buildOK =
      run.outcome === 'passed' &&
      sourceOK &&
      checksOK &&
      run.calls.some((c) => c.stage === 'plan') &&
      run.calls.some((c) => c.stage === 'files') &&
      !unsafe
    const exportOK =
      buildOK && run.export !== null && run.export.checks.every((c) => c.result === 'passed')
    if (sourceOK) sourcePassed++
    if (buildOK) buildPassed++
    if (exportOK) exportPassed++
    if (run.promoted && !buildOK) unsafePromotions++
    if (unsafe) violations++
    perCase[run.caseId].attempts++
    if (run.outcome !== 'denied') perCase[run.caseId].admitted++
    if (buildOK) perCase[run.caseId].buildsPassed++
    if (exportOK) perCase[run.caseId].exportsPassed++
  }
  const planned = corpus.cases.length * campaign.repetitions,
    missing = planned - campaign.samples.length
  const completeCoverage = missing === 0 && Object.values(perCase).every((c) => c.admitted >= 5)
  const authenticated = !!options.reader && verified === campaign.samples.length && verified > 0
  const live = campaign.origin === 'live'
  const budgetOK =
    unknownCalls === 0 &&
    liability <= BigInt(campaign.approvedModelEnvelopeMicros) &&
    violations === 0
  const active = admitted.flatMap((s) => (s.run.activeMs === null ? [] : [s.run.activeMs]))
  return {
    schemaVersion: 1,
    evidence: authenticated ? 'authenticated-captured-receipts' : 'supplied-not-attested',
    origin: campaign.origin,
    releaseReady: false,
    dispatchAuthorized: false,
    pinsDigest: canonicalHash(campaign.pins),
    corpusDigest: campaign.corpusDigest,
    planned,
    reported: campaign.samples.length,
    notRun: missing,
    admitted: admitted.length,
    dispatchedRuns,
    denied: campaign.samples.length - admitted.length,
    outcomes: Object.fromEntries(
      ['passed', 'failed', 'timeout', 'cancelled', 'denied'].map((outcome) => [
        outcome,
        campaign.samples.filter((s) => s.run.outcome === outcome).length,
      ])
    ),
    failureCodes: Object.fromEntries(
      [
        'AUTH',
        'RATE_LIMIT',
        'TIMEOUT',
        'REFUSAL',
        'INVALID_OUTPUT',
        'UNAVAILABLE',
        'CHECK_FAILURE',
        'CANCELLED',
        'QUOTA',
      ].map((code) => [code, campaign.samples.filter((s) => s.run.failureCode === code).length])
    ),
    structuredSourceRate: admitted.length ? sourcePassed / admitted.length : null,
    admittedDemandRatio: planned ? admitted.length / planned : null,
    sourcePassed,
    buildPassed,
    exportPassed,
    unsafePromotions,
    violations,
    perCase,
    buildSuccessRate: admitted.length ? buildPassed / admitted.length : null,
    buildSuccess95PercentInterval: wilson(buildPassed, admitted.length),
    exportSuccessRate: admitted.length ? exportPassed / admitted.length : null,
    latency: {
      samples: active.length,
      missing: admitted.length - active.length,
      p50ActiveMs: percentile(active, 0.5),
      p95ActiveMs: percentile(active, 0.95),
    },
    cost: {
      observedMicros: observed.toString(),
      maximumLiabilityMicros: liability.toString(),
      unknownCalls,
      unknownRuns,
      measuredRuns: measuredRunCosts.length,
      p50Micros: percentile(measuredRunCosts, 0.5),
      p95Micros: percentile(measuredRunCosts, 0.95),
      overApprovedEnvelope: liability > BigInt(campaign.approvedModelEnvelopeMicros),
    },
    a22EvidenceMeetsTargets:
      live &&
      authenticated &&
      fresh &&
      completeCoverage &&
      dispatchedRuns >= 30 &&
      buildPassed / admitted.length >= 0.9 &&
      unsafePromotions === 0 &&
      budgetOK,
    a04EvidenceComplete:
      live &&
      authenticated &&
      fresh &&
      completeCoverage &&
      dispatchedRuns >= 30 &&
      exportPassed === admitted.length &&
      budgetOK,
  }
}
