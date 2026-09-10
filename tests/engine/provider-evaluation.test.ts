import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { canonicalHash, canonicalJson, sha256 } from '../../engine/contracts/canonical.ts'
import { checkIds } from '../../engine/contracts/primitives.ts'
import {
  evaluateProviderEvidence,
  exportCheckIds,
  providerReferenceCorpus,
  quoteProviderReservation,
} from '../../engine/operations/provider-evaluation.ts'
import type { ProviderPrice, ProviderRun } from '../../engine/operations/provider-evaluation.ts'
const hash = sha256('explicit evidence fixture'),
  at = '2026-09-10T00:00:00Z',
  end = '2026-09-10T01:00:00Z',
  expiry = '2026-09-11T00:00:00Z',
  now = Date.parse(end)
function fixture(origin: 'fixture' | 'live' = 'fixture') {
  const price: ProviderPrice = {
    schemaVersion: 1,
    currency: 'USD',
    provider: 'fixture-vendor',
    modelSnapshot: 'fixture-model-pinned',
    version: 'fixture-price-v1',
    validFrom: at,
    expiresAt: expiry,
    inputMicrosPerMillion: 400000,
    outputMicrosPerMillion: 1600000,
    requestMicros: 0,
    billableTokenCoverage: 'all-billable-input-and-output',
    billableBoundEvidenceDigest: hash,
  }
  const pins = {
    provider: price.provider,
    modelSnapshot: price.modelSnapshot,
    adapterDigest: hash,
    endpointDigest: hash,
    promptDigest: hash,
    modelPolicyDigest: hash,
    templateDigest: hash,
    imageDigest: `sha256:${hash}`,
    commandPolicyDigest: hash,
    scannerPolicyDigest: hash,
    priceDigest: canonicalHash(price),
  }
  const corpus = providerReferenceCorpus(),
    corpusDigest = canonicalHash(corpus)
  const samples = corpus.cases.flatMap((spec) =>
    Array.from({ length: 5 }, (_, repetition) => {
      const run: ProviderRun = {
        schemaVersion: 1,
        id: randomUUID(),
        caseId: spec.id,
        repetition: repetition + 1,
        corpusDigest,
        pins,
        origin,
        outcome: 'passed',
        failureCode: 'NONE',
        repairs: 0,
        activeMs: 100,
        structuredSource: 'passed',
        candidateDigest: hash,
        baseSourceDigest: spec.base === 'verified-task-board' ? hash : null,
        promoted: true,
        calls: [
          {
            id: randomUUID(),
            stage: 'plan',
            inputTokenBound: 100,
            outputTokenBound: 100,
            reservedMicros: 200,
            priceDigest: pins.priceDigest,
            usage: {
              classification: 'measured',
              inputTokens: 100,
              outputTokens: 100,
              chargedMicros: 200,
            },
          },
        ],
        checks: checkIds.map((checkId) => ({ checkId, result: 'passed' })),
        export: {
          origin,
          candidateDigest: hash,
          archiveDigest: hash,
          checks: exportCheckIds.map((checkId) => ({ checkId, result: 'passed' })),
        },
      }
      run.calls[0].inputTokenBound = 50
      run.calls[0].outputTokenBound = 50
      run.calls[0].reservedMicros = 100
      run.calls[0].usage = {
        classification: 'measured',
        inputTokens: 50,
        outputTokens: 50,
        chargedMicros: 100,
      }
      run.calls.push({ ...structuredClone(run.calls[0]), id: randomUUID(), stage: 'files' })
      return { run, receiptDigest: canonicalHash(run) }
    })
  )
  const campaign = {
    schemaVersion: 1 as const,
    origin,
    startedAt: at,
    finishedAt: end,
    expiresAt: expiry,
    repetitions: 5,
    corpusDigest,
    pins,
    price,
    approvedModelEnvelopeMicros: 6000,
    perJobLimitMicros: 200,
    samples,
  }
  const reader = {
    read: vi.fn(async (digest: string) => {
      const sample = campaign.samples.find((s) => s.receiptDigest === digest)!
      return {
        bytes: Buffer.from(canonicalJson(sample.run)),
        authenticated: true,
        origin,
        revoked: false,
        expiresAt: expiry,
      }
    }),
  }
  const refresh = () => {
    campaign.samples.forEach((s) => {
      s.receiptDigest = canonicalHash(s.run)
    })
  }
  return { campaign, reader, refresh }
}
describe('offline provider evaluation arithmetic (all test evidence is synthetic)', () => {
  it('is offline by default and never treats caller live labels as acceptance', async () => {
    const f = fixture('live')
    const evaluation = await evaluateProviderEvidence(f.campaign, { now })
    expect(f.reader.read).not.toHaveBeenCalled()
    expect(evaluation).toMatchObject({
      planned: 30,
      reported: 30,
      buildPassed: 30,
      evidence: 'supplied-not-attested',
      a22EvidenceMeetsTargets: false,
      a04EvidenceComplete: false,
      releaseReady: false,
      dispatchAuthorized: false,
    })
  })
  it('refuses fixture and live mixtures rather than filtering inconvenient rows', async () => {
    const f = fixture('live')
    f.campaign.samples[2].run.origin = 'fixture'
    await expect(evaluateProviderEvidence(f.campaign)).rejects.toThrow(
      'INVALID_PROVIDER_EVALUATION'
    )
    const g = fixture()
    const result = await evaluateProviderEvidence(g.campaign, { now, reader: g.reader })
    expect(result.a22EvidenceMeetsTargets).toBe(false)
    expect(result.a04EvidenceComplete).toBe(false)
  })
  it('validates captured receipt digests and reports targets without release or spending authority', async () => {
    const f = fixture('live')
    const result = await evaluateProviderEvidence(f.campaign, { now, reader: f.reader })
    expect(result).toMatchObject({
      a22EvidenceMeetsTargets: true,
      a04EvidenceComplete: true,
      releaseReady: false,
      dispatchAuthorized: false,
    })
    expect(result.buildSuccess95PercentInterval![0]).toBeLessThan(0.9)
    expect(result.cost).toMatchObject({
      observedMicros: '6000',
      maximumLiabilityMicros: '6000',
      measuredRuns: 30,
      p95Micros: 200,
    })
  })
  it.each(['modelSnapshot', 'templateDigest', 'promptDigest', 'priceDigest'] as const)(
    'refuses changed %s pins',
    async (pin) => {
      const f = fixture()
      f.campaign.samples[2].run.pins = {
        ...f.campaign.pins,
        [pin]: pin === 'modelSnapshot' ? 'other-model' : 'b'.repeat(64),
      }
      await expect(evaluateProviderEvidence(f.campaign)).rejects.toThrow(
        'INVALID_PROVIDER_EVALUATION'
      )
    }
  )
  it('retains missing, timeout, cancelled and denied outcomes in denominator reports', async () => {
    const f = fixture('live')
    f.campaign.samples.pop()
    f.campaign.samples[0].run.outcome = 'timeout'
    f.campaign.samples[0].run.promoted = false
    f.campaign.samples[0].run.activeMs = 1_200_000
    f.campaign.samples[1].run.outcome = 'cancelled'
    f.campaign.samples[1].run.promoted = false
    f.campaign.samples[1].run.activeMs = 1_200_000
    f.campaign.samples[2].run.outcome = 'denied'
    f.campaign.samples[2].run.promoted = false
    f.campaign.samples[2].run.calls = []
    f.campaign.samples[2].run.structuredSource = 'not-run'
    f.campaign.samples[2].run.candidateDigest = null
    f.campaign.samples[2].run.export = null
    f.campaign.samples[2].run.checks.forEach((c) => {
      c.result = 'not-run'
    })
    f.refresh()
    const result = await evaluateProviderEvidence(f.campaign, { now, reader: f.reader })
    expect(result).toMatchObject({
      planned: 30,
      reported: 29,
      notRun: 1,
      admitted: 28,
      denied: 1,
      buildPassed: 23,
      a22EvidenceMeetsTargets: false,
    })
    expect(result.latency.p95ActiveMs).toBe(1_200_000)
  })
  it('does not drop over-cap repairs/calls or unsafe promotions from failures', async () => {
    const f = fixture('live')
    f.campaign.samples[0].run.repairs = 3
    const prototype = f.campaign.samples[1].run.calls[0]
    f.campaign.samples[1].run.calls = Array.from({ length: 13 }, () => ({
      ...structuredClone(prototype),
      id: randomUUID(),
    }))
    f.refresh()
    const result = await evaluateProviderEvidence(f.campaign, { now, reader: f.reader })
    expect(result).toMatchObject({
      admitted: 30,
      violations: 2,
      buildPassed: 28,
      unsafePromotions: 2,
      a22EvidenceMeetsTargets: false,
    })
  })
  it('retains full reservation for missing/estimated/uncertain usage even with a reported zero', async () => {
    const f = fixture('live')
    f.campaign.samples[0].run.calls[0].usage = {
      classification: 'uncertain',
      inputTokens: null,
      outputTokens: null,
      chargedMicros: 0,
    }
    f.campaign.samples[1].run.calls[0].usage.classification = 'estimated'
    f.refresh()
    const result = await evaluateProviderEvidence(f.campaign, { now, reader: f.reader })
    expect(result.cost).toMatchObject({
      observedMicros: '5900',
      maximumLiabilityMicros: '6000',
      unknownCalls: 2,
      unknownRuns: 2,
      measuredRuns: 28,
    })
    expect(result.a22EvidenceMeetsTargets).toBe(false)
  })
  it('blocks A04 when source-only ZIP claims lack a clean isolated install/migrate/run result', async () => {
    const f = fixture('live')
    f.campaign.samples[0].run.export!.checks.find(
      (c) => c.checkId === 'clean-environment'
    )!.result = 'not-run'
    f.refresh()
    const result = await evaluateProviderEvidence(f.campaign, { now, reader: f.reader })
    expect(result.a04EvidenceComplete).toBe(false)
    expect(result.a22EvidenceMeetsTargets).toBe(true)
  })
  it('rejects revoked/forged/fixture receipts and stale campaigns cannot meet targets', async () => {
    const f = fixture('live')
    await expect(
      evaluateProviderEvidence(f.campaign, {
        now,
        reader: {
          read: async () => ({
            bytes: Buffer.from('{}'),
            authenticated: true,
            origin: 'live',
            revoked: false,
            expiresAt: expiry,
          }),
        },
      })
    ).rejects.toThrow('INVALID_PROVIDER_EVIDENCE')
    const original = f.reader.read
    await expect(
      evaluateProviderEvidence(f.campaign, {
        now,
        reader: { read: async (digest) => ({ ...(await original(digest)), revoked: true }) },
      })
    ).rejects.toThrow('INVALID_PROVIDER_EVIDENCE')
    await expect(
      evaluateProviderEvidence(f.campaign, {
        now,
        reader: { read: async (digest) => ({ ...(await original(digest)), origin: 'fixture' }) },
      })
    ).rejects.toThrow('INVALID_PROVIDER_EVIDENCE')
    expect(
      (await evaluateProviderEvidence(f.campaign, { now: Date.parse(expiry) }))
        .a22EvidenceMeetsTargets
    ).toBe(false)
  })
  it('quotes exact integer conservative costs but never authorizes dispatch', () => {
    const f = fixture()
    expect(quoteProviderReservation(f.campaign.price, 65536, 8192, now)).toMatchObject({
      maximumMicros: '39323',
      dispatchAuthorized: false,
    })
    expect(
      quoteProviderReservation(
        { ...f.campaign.price, inputMicrosPerMillion: 2000000, outputMicrosPerMillion: 8000000 },
        65536,
        8192,
        now
      )
    ).toMatchObject({ maximumMicros: '196608', dispatchAuthorized: false })
    expect(() => quoteProviderReservation(f.campaign.price, 10, 10, Date.parse(expiry))).toThrow(
      'PRICE_NOT_CURRENT'
    )
    expect(
      quoteProviderReservation(
        { ...f.campaign.price, inputMicrosPerMillion: Number.MAX_SAFE_INTEGER },
        Number.MAX_SAFE_INTEGER,
        0,
        now
      ).maximumMicros
    ).toBe(((BigInt(Number.MAX_SAFE_INTEGER) ** 2n + 999999n) / 1000000n).toString())
  })
  it('bounds a receipt store that ignores cancellation without making a second read', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture('live'),
        read = vi.fn(() => new Promise<never>(() => undefined))
      const outcome = evaluateProviderEvidence(f.campaign, { now, reader: { read } })
      const assertion = expect(outcome).rejects.toThrow('EVIDENCE_DEADLINE')
      await vi.advanceTimersByTimeAsync(60000)
      await assertion
      expect(read).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('rejects duplicate slots/calls and counts zero-dispatch failures against minimum live runs', async () => {
    const f = fixture('live')
    f.campaign.samples[1].run.repetition = f.campaign.samples[0].run.repetition
    await expect(evaluateProviderEvidence(f.campaign)).rejects.toThrow(
      'INVALID_PROVIDER_EVALUATION'
    )
    const g = fixture('live')
    g.campaign.samples[1].run.calls[0].id = g.campaign.samples[0].run.calls[0].id
    await expect(evaluateProviderEvidence(g.campaign)).rejects.toThrow(
      'INVALID_PROVIDER_EVALUATION'
    )
    const h = fixture('live')
    h.campaign.samples[0].run.calls = []
    h.campaign.samples[0].run.outcome = 'failed'
    h.campaign.samples[0].run.promoted = false
    h.refresh()
    expect(await evaluateProviderEvidence(h.campaign, { now, reader: h.reader })).toMatchObject({
      admitted: 30,
      dispatchedRuns: 29,
      a22EvidenceMeetsTargets: false,
    })
  })
  it('rejects arbitrary priority bases and redacts upstream evidence-store errors', async () => {
    const f = fixture('live')
    f.campaign.samples.find((s) => s.run.caseId === 'priority-filter')!.run.baseSourceDigest =
      sha256('unrelated baseline')
    f.refresh()
    expect(await evaluateProviderEvidence(f.campaign, { now, reader: f.reader })).toMatchObject({
      violations: 1,
      a22EvidenceMeetsTargets: false,
    })
    await expect(
      evaluateProviderEvidence(f.campaign, {
        now,
        reader: {
          read: async () => {
            throw new Error('SECRET_CANARY_STORE_TOKEN')
          },
        },
      })
    ).rejects.toThrow(/^INVALID_PROVIDER_EVIDENCE$/)
  })
})
