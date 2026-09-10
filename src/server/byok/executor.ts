import { randomUUID, createHash } from 'node:crypto'
import type { ModelResult, RunSnapshot, Selection } from '../../shared/byok'
import { routingSchema } from '../../shared/byok'
import type { ConnectionStore } from './store'
import type { Principal } from './store'
import { ModelAdapter } from './adapters'
import type { ModelRequest } from './adapters'
import { ByokError } from './transport'
import { bindingFor, inputBound, priceFor, quote, observedCost } from './accounting'
import type { Price } from './accounting'
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export interface RunRow {
  id: string
  owner_id: string
  job_id: string | null
  session_id: string | null
  snapshot: RunSnapshot
  status: string
  resolved: Record<string, Selection> | null
  calls: number
}
export interface AttemptRow {
  id: string
  status: string
  result: ModelResult | null
  request_hash: string
  error_code: string | null
  reserved_micros: string
  internal_campaign: boolean
  price: Price | null
}
export class RunExecutor {
  constructor(
    readonly store: ConnectionStore,
    readonly who: Principal,
    readonly run: RunRow
  ) {}
  async call(
    stageKey: string,
    role: string,
    selection: Selection,
    request: Omit<ModelRequest, 'model'>,
    signal: AbortSignal
  ): Promise<ModelResult> {
    const bound = bindingFor(this.run.snapshot, selection)
    const maxOutput = Math.min(
      request.maxTokens,
      bound.profile.maxOutputTokens,
      this.run.snapshot.routing.limits.maxOutputTokens
    )
    const full = {
      stream: bound.profile.capabilities.streaming,
      ...request,
      model: selection.modelId,
      maxTokens: maxOutput,
    }
    if (inputBound(full.system, full.prompt) + maxOutput > bound.profile.contextWindow)
      throw new ByokError(
        'CONTEXT',
        'This model’s context is too small. Select a larger-context model or shorten the request.'
      )
    const requestHash = digest({ selection, role, request: full }),
      attemptId = randomUUID()
    // Decrypt first; the subsequent dispatch transaction locks and rechecks the exact version.
    const connection = await this.store.transaction(this.who, (tx) =>
      this.store.read(tx, this.who.id, selection.connectionId)
    )
    if (connection.revision !== bound.revision)
      throw new ByokError(
        'REVOKED',
        'A connection changed. Start a new run with the current key.',
        409
      )
    const key = await this.store.key(connection, this.who)
    const price = priceFor(connection.provider, connection.base_url, selection.modelId)
    const dollars = this.run.snapshot.routing.limits.budgetMode === 'dollars'
    if (dollars && (!price || inputBound(full.system, full.prompt) > price.inputTokenCeiling))
      throw new ByokError(
        'PRICE',
        'Dollar-budget mode needs a current, complete price and token-bound policy for this model.'
      )
    const reserved = price ? quote(price, maxOutput, !!full.research) : 0
    signal.throwIfAborted()
    const prior = await this.store.transaction(this.who, async (tx) => {
      const current = await tx.query<RunRow>(
        'SELECT * FROM forge_model_runs WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [this.who.id, this.run.id]
      )
      const run = current.rows[0]
      if (!run || !['ready', 'running'].includes(run.status))
        throw new ByokError('RUN', 'This run is no longer active.', 409)
      if (run.job_id) {
        const job = await tx.query(
          'SELECT j.status,j.cancelled,j.base_revision,p.active_revision,p.owner_id,p.archived FROM forge_jobs j JOIN forge_projects p ON p.id=j.project_id WHERE j.id=$1 AND j.owner_id=$2 FOR UPDATE OF j,p',
          [run.job_id, this.who.id]
        )
        const j = job.rows[0]
        if (
          !j ||
          j.status !== 'running' ||
          j.cancelled ||
          j.archived ||
          j.owner_id !== this.who.id ||
          j.base_revision !== j.active_revision
        )
          throw new ByokError('CANCELLED', 'The job was cancelled or its source changed.', 409)
      }
      const old = await tx.query<AttemptRow>(
        'SELECT * FROM forge_model_attempts WHERE owner_id=$1 AND run_id=$2 AND stage_key=$3',
        [this.who.id, run.id, stageKey]
      )
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== requestHash)
          throw new ByokError('STALE', 'The saved stage has different input.', 409)
        if (old.rows[0].status === 'complete' && old.rows[0].result) return old.rows[0].result
        throw new ByokError(
          'UNKNOWN',
          'This request may already have reached the provider. Review usage and start a new run to retry.',
          409
        )
      }
      const row = await this.store.read(tx, this.who.id, connection.id, true)
      if (row.revision !== bound.revision)
        throw new ByokError('REVOKED', 'Connection changed before dispatch.', 409)
      const active = await tx.query(
        "SELECT count(*)::int AS count,count(*) FILTER (WHERE connection_id=$2)::int AS connection_count FROM forge_model_attempts WHERE owner_id=$1 AND status='dispatched'",
        [this.who.id, connection.id]
      )
      const concurrency = Math.max(1, Math.min(8, Number(process.env.FORGE_BYOK_CONCURRENCY) || 1))
      const connectionConcurrency = Math.max(
        1,
        Math.min(8, Number(process.env.FORGE_BYOK_CONNECTION_CONCURRENCY) || 1)
      )
      if (
        active.rows[0].count >= concurrency ||
        active.rows[0].connection_count >= connectionConcurrency
      )
        throw new ByokError(
          'BUSY',
          'A model request is already running. Wait for it to complete.',
          429
        )
      if (run.calls >= run.snapshot.routing.limits.maxCalls)
        throw new ByokError('CALL_LIMIT', 'The run reached its model-call limit.')
      const spent = await tx.query(
        'SELECT coalesce(sum(coalesce(charged_micros,reserved_micros)),0)::text AS amount FROM forge_model_attempts WHERE owner_id=$1 AND run_id=$2',
        [this.who.id, run.id]
      )
      if (
        dollars &&
        BigInt(spent.rows[0].amount) + BigInt(reserved) >
          BigInt(run.snapshot.routing.limits.maxCostMicros!)
      )
        throw new ByokError('BUDGET', 'The next request could exceed your remaining budget.')
      // Optional operator-wide internal campaign cap is durable and shared across accounts.
      const campaign = Number(process.env.FORGE_BYOK_TEST_BUDGET_MICROS ?? 0)
      if (campaign) {
        if (!dollars || !Number.isSafeInteger(campaign) || campaign < 1)
          throw new ByokError('BUDGET', 'Internal testing requires a valid dollar budget.')
        await tx.query(
          "INSERT INTO forge_model_budget(scope) VALUES('internal-test') ON CONFLICT DO NOTHING"
        )
        const b = await tx.query(
          "UPDATE forge_model_budget SET liability_micros=liability_micros+$1 WHERE scope='internal-test' AND liability_micros+$1<=$2 RETURNING scope",
          [reserved, campaign]
        )
        if (!b.rowCount)
          throw new ByokError('BUDGET', 'The shared internal test budget is exhausted.')
      }
      signal.throwIfAborted()
      await tx.query(
        "INSERT INTO forge_model_attempts(id,owner_id,run_id,connection_id,credential_revision,model_id,task,stage_key,request_hash,status,reserved_micros,price,internal_campaign) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'dispatched',$10,$11,$12)",
        [
          attemptId,
          this.who.id,
          run.id,
          connection.id,
          bound.revision,
          selection.modelId,
          role,
          stageKey,
          requestHash,
          reserved,
          price ?? null,
          !!campaign,
        ]
      )
      await tx.query(
        "UPDATE forge_model_runs SET calls=calls+1,status='running' WHERE owner_id=$1 AND id=$2",
        [this.who.id, run.id]
      )
      return null
    })
    if (prior) return prior
    try {
      const adapter = new ModelAdapter(
        {
          provider: connection.provider,
          protocol: connection.protocol,
          baseUrl: connection.base_url,
        },
        key
      )
      const result = await adapter.generate(full, signal)
      const charge = price
        ? observedCost(price, result.usage, maxOutput, !!full.research)
        : undefined
      await this.settle(attemptId, 'complete', result, charge)
      return result
    } catch (error) {
      const rejected =
        error instanceof ByokError && ['AUTH', 'RATE_LIMIT', 'CREDITS'].includes(error.code)
      await this.settle(
        attemptId,
        rejected ? 'rejected' : 'unknown',
        undefined,
        rejected ? 0 : undefined,
        error instanceof ByokError ? error.code : 'UNKNOWN'
      ).catch(() => {})
      throw error instanceof ByokError
        ? error
        : new ByokError(
            'UNKNOWN',
            'The provider request was interrupted. Its cost may be unknown.',
            502
          )
    }
  }
  private async settle(
    id: string,
    status: string,
    result?: ModelResult,
    charge?: number,
    error?: string
  ) {
    // Settlement survives logout: it records only this already dispatched attempt,
    // never authorizes further calls or source promotion.
    await this.store.transaction({ id: this.who.id, local: true }, async (tx) => {
      const rows = await tx.query<AttemptRow>(
        'SELECT * FROM forge_model_attempts WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [this.who.id, id]
      )
      const old = rows.rows[0]
      if (!old) throw new Error('ATTEMPT')
      if (old.status !== 'dispatched') {
        if (old.status !== status || digest(old.result) !== digest(result ?? null))
          throw new Error('SETTLEMENT_CONFLICT')
        return
      }
      if (charge !== undefined && charge > Number(old.reserved_micros)) charge = undefined
      await tx.query(
        'UPDATE forge_model_attempts SET status=$3,result=$4,usage=$5,charged_micros=$6,error_code=$7 WHERE owner_id=$1 AND id=$2',
        [
          this.who.id,
          id,
          status,
          result ?? null,
          result?.usage ?? null,
          charge ?? null,
          error ?? null,
        ]
      )
      if (old.internal_campaign && charge !== undefined)
        await tx.query(
          "UPDATE forge_model_budget SET liability_micros=liability_micros-$1 WHERE scope='internal-test'",
          [Number(old.reserved_micros) - charge]
        )
    })
  }
}
export async function readRun(store: ConnectionStore, who: Principal, id: string) {
  return store.transaction(who, async (tx) => {
    const r = await tx.query<RunRow>('SELECT * FROM forge_model_runs WHERE owner_id=$1 AND id=$2', [
      who.id,
      id,
    ])
    const row = r.rows[0]
    if (!row) throw new ByokError('RUN', 'Run not found.', 404)
    routingSchema.parse(row.snapshot.routing)
    return row
  })
}
