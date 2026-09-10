import { randomUUID } from 'node:crypto'
import type { ControlDatabase, Tx } from '../control/database.ts'
import { number, one } from '../control/database.ts'
import { canonicalHash } from '../contracts/canonical.ts'
import { callTermsSchema, priceAtRates } from './accounting.ts'
import type { CallAccounting, CallReceipt, CallSettlement, CallTerms } from './accounting.ts'

/** Task01 integration supplies the global/project/job/step lock and authorization
 * order, pinned price-policy and key-revision check. It MUST run in this transaction.
 * Global/workspace job envelopes are reserved by admission; calls suballocate them. */
export interface CallDispatchGate {
  lockAndAuthorize(c: Tx, terms: CallTerms): Promise<void>
}
interface Attempt {
  workspace_id: string
  project_id: string
  job_id: string
  operation_id: string
  input_digest: string
  terms_json: CallTerms
  call_number: number
  state: string
  maximum_micros: string
  usage_digest: string | null
}
/** Uses E1 provider_attempts/usage_reservations/usage_ledger only. Requires the Task01
 * 0005 proposal; deliberately not wired into the fixture worker or any HTTP route. */
export class PostgresCallAccounting implements CallAccounting {
  constructor(
    private readonly db: ControlDatabase,
    private readonly gate: CallDispatchGate
  ) {
    if (db.role !== 'forge_control_worker') throw new Error('PROVIDER_ACCOUNTING_ROLE')
  }
  private receipt(t: CallTerms, callNumber: number): CallReceipt {
    return {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      jobId: t.jobId,
      requestId: t.requestId,
      termsDigest: canonicalHash(t),
      callNumber,
    }
  }
  async reserve(input: CallTerms) {
    const t = callTermsSchema.parse(input)
    return this.db.scoped(t.workspaceId, async (c) => {
      await this.gate.lockAndAuthorize(c, t)
      const job = await one<{ provider_calls: number; repair_count: number }>(
        c,
        'SELECT provider_calls,repair_count FROM jobs WHERE id=$1 AND project_id=$2 FOR UPDATE',
        [t.jobId, t.projectId]
      )
      const prior = (
        await c.query<Attempt>('SELECT * FROM provider_attempts WHERE operation_id=$1', [
          t.requestId,
        ])
      ).rows[0]
      if (prior) {
        if (
          prior.input_digest !== canonicalHash(t) ||
          prior.job_id !== t.jobId ||
          prior.project_id !== t.projectId
        )
          throw new Error('PROVIDER_CALL_CONFLICT')
        return { created: false, receipt: this.receipt(t, prior.call_number) }
      }
      if (job.provider_calls >= 12 || job.repair_count !== t.repairNumber)
        throw new Error('PROVIDER_CALL_CAP')
      const r = await one<{
        reserved_micros: string
        settled_micros: string
        released_micros: string
        status: string
      }>(c, 'SELECT * FROM usage_reservations WHERE job_id=$1 FOR UPDATE', [t.jobId])
      const pending = await one<{ amount: string }>(
        c,
        "SELECT COALESCE(sum(maximum_micros),0)::text AS amount FROM provider_attempts WHERE job_id=$1 AND state IN ('reserved','dispatched','uncertain')",
        [t.jobId]
      )
      if (
        r.status !== 'open' ||
        BigInt(r.settled_micros) +
          BigInt(r.released_micros) +
          BigInt(pending.amount) +
          BigInt(t.maximumMicros) >
          BigInt(r.reserved_micros)
      )
        throw new Error('PROVIDER_BUDGET_EXHAUSTED')
      const first = (
        await c.query<Attempt>(
          'SELECT * FROM provider_attempts WHERE job_id=$1 AND terms_json IS NOT NULL LIMIT 1',
          [t.jobId]
        )
      ).rows[0]
      if (
        first &&
        (first.terms_json.policyDigest !== t.policyDigest ||
          first.terms_json.credentialId !== t.credentialId ||
          first.terms_json.credentialRevision !== t.credentialRevision)
      )
        throw new Error('PROVIDER_POLICY_CHANGED')
      const callNumber = job.provider_calls + 1
      await c.query(
        `INSERT INTO provider_attempts(workspace_id,project_id,job_id,step_id,operation_id,input_digest,maximum_micros,state,terms_json,call_number)
        VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9)`,
        [
          t.workspaceId,
          t.projectId,
          t.jobId,
          t.stepId,
          t.requestId,
          canonicalHash(t),
          t.maximumMicros,
          t,
          callNumber,
        ]
      )
      await c.query('UPDATE jobs SET provider_calls=$2 WHERE id=$1', [t.jobId, callNumber])
      return { created: true, receipt: this.receipt(t, callNumber) }
    })
  }
  private async load(c: Tx, receipt: CallReceipt) {
    const row = await one<Attempt>(
      c,
      'SELECT * FROM provider_attempts WHERE workspace_id=$1 AND project_id=$2 AND job_id=$3 AND operation_id=$4 FOR UPDATE',
      [receipt.workspaceId, receipt.projectId, receipt.jobId, receipt.requestId]
    )
    if (
      row.input_digest !== receipt.termsDigest ||
      row.call_number !== receipt.callNumber ||
      !row.terms_json
    )
      throw new Error('PROVIDER_CALL_CONFLICT')
    return row
  }
  async dispatch(receipt: CallReceipt) {
    return this.db.scoped(receipt.workspaceId, async (c) => {
      // Read immutable terms before taking the integration gate's prescribed locks.
      const terms = await one<{ terms_json: CallTerms }>(
        c,
        'SELECT terms_json FROM provider_attempts WHERE operation_id=$1 AND job_id=$2 AND project_id=$3',
        [receipt.requestId, receipt.jobId, receipt.projectId]
      )
      await this.gate.lockAndAuthorize(c, callTermsSchema.parse(terms.terms_json))
      await c.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE', [receipt.jobId])
      const row = await this.load(c, receipt)
      if (row.state !== 'reserved') return false
      await c.query("UPDATE provider_attempts SET state='dispatched' WHERE operation_id=$1", [
        receipt.requestId,
      ])
      return true
    })
  }
  async settle(receipt: CallReceipt, settlement: CallSettlement) {
    // Settlement is worker-authenticated evidence, never an HTTP body. Lease loss
    // does not erase a charge. Source adoption is a separate fenced transaction.
    return this.db.scoped(receipt.workspaceId, async (c) => {
      await c.query('SELECT id FROM jobs WHERE id=$1 AND project_id=$2 FOR UPDATE', [
        receipt.jobId,
        receipt.projectId,
      ])
      const row = await this.load(c, receipt)
      if (!['dispatched', 'uncertain', 'completed'].includes(row.state)) throw new Error('PROVIDER_NOT_DISPATCHED')
      if (row.state === 'completed') {
        if (row.usage_digest !== canonicalHash(settlement)) throw new Error('PROVIDER_USAGE_CONFLICT')
        return
      }
      if (settlement.classification === 'uncertain') {
        await c.query("UPDATE provider_attempts SET state='uncertain' WHERE operation_id=$1", [
          receipt.requestId,
        ])
        return
      }
      for (const value of [
        settlement.inputTokens,
        settlement.outputTokens,
        settlement.amountMicros,
      ])
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('PROVIDER_USAGE_INVALID')
      if (
        settlement.amountMicros !==
          priceAtRates(settlement.inputTokens, settlement.outputTokens, row.terms_json.price) ||
        settlement.amountMicros > number(row.maximum_micros) ||
        settlement.inputTokens > row.terms_json.inputTokenBound ||
        settlement.outputTokens > row.terms_json.outputTokenBound ||
        !/^[a-f0-9]{64}$/.test(settlement.usageDigest)
      )
        throw new Error('PROVIDER_USAGE_INVALID')
      const r = await one<{ period_start: Date }>(
        c,
        'SELECT period_start FROM usage_reservations WHERE job_id=$1 FOR UPDATE',
        [receipt.jobId]
      )
      await c.query(
        `INSERT INTO usage_ledger(id,workspace_id,project_id,job_id,step_id,provider_request_id,input_tokens,output_tokens,amount_micros,price_version,classification,dedupe_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'measured',$11)`,
        [
          randomUUID(),
          receipt.workspaceId,
          receipt.projectId,
          receipt.jobId,
          row.terms_json.stepId,
          receipt.requestId,
          settlement.inputTokens,
          settlement.outputTokens,
          settlement.amountMicros,
          row.terms_json.priceVersion,
          `provider-call:${receipt.requestId}`,
        ]
      )
      await c.query(
        'UPDATE workspace_quotas SET reserved_micros=reserved_micros-$3,spent_micros=spent_micros+$3 WHERE workspace_id=$1 AND period_start=$2',
        [receipt.workspaceId, r.period_start, settlement.amountMicros]
      )
      await c.query(
        'UPDATE usage_reservations SET settled_micros=settled_micros+$2 WHERE job_id=$1',
        [receipt.jobId, settlement.amountMicros]
      )
      await c.query(
        "UPDATE provider_attempts SET state='completed',amount_micros=$2,usage_digest=$3 WHERE operation_id=$1",
        [receipt.requestId, settlement.amountMicros, canonicalHash(settlement)]
      )
      // Job/global remainder release stays with E1 reconciliation; never release
      // another call's uncertain maximum here or invent a zero-cost observation.
    })
  }
}
