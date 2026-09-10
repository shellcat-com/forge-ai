import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ConnectionStore } from './store'
import type { Principal } from './store'
import { ModelAdapter } from './adapters'
import { ByokError } from './transport'
import { digest, readRun, RunExecutor } from './executor'
import type { RunRow } from './executor'
import {
  limitsSchema,
  modelProfileSchema,
  routingSchema,
  singleModelRouting,
} from '../../shared/byok'
import type { ModelProfile, RunSnapshot, RoutingProfile } from '../../shared/byok'
export async function discover(
  store: ConnectionStore,
  who: Principal,
  id: string,
  signal: AbortSignal
) {
  const row = await store.transaction(who, (tx) => store.read(tx, who.id, id))
  const models = await new ModelAdapter(
    { provider: row.provider, protocol: row.protocol, baseUrl: row.base_url },
    await store.key(row, who)
  ).discover(signal)
  const merged = models.map((m) => {
    const old = row.models.find((x) => x.id === m.id)
    return old ?? m
  })
  // Manual models absent from discovery are preserved; discovery is not entitlement proof.
  return store.saveModels(who, id, row.revision, [
    ...merged,
    ...row.models.filter((m) => !merged.some((x) => x.id === m.id)),
  ])
}
export async function addModel(store: ConnectionStore, who: Principal, id: string, raw: unknown) {
  const input = modelProfileSchema.omit({ verified: true, checkedAt: true }).parse(raw)
  const row = await store.transaction(who, (tx) => store.read(tx, who.id, id))
  // Provider capability declarations never grant built-in tool access to a custom endpoint.
  const model: ModelProfile = {
    ...input,
    capabilities: {
      ...input.capabilities,
      research:
        input.capabilities.research && row.provider === 'openai' && row.protocol === 'responses',
    },
    verified: [],
  }
  return store.saveModels(who, id, row.revision, [
    ...row.models.filter((m) => m.id !== input.id),
    model,
  ])
}
export const testInput = z.strictObject({
  modelId: z.string().min(1).max(200),
  capability: z.enum(['text', 'structured', 'research']),
  limits: limitsSchema,
  idempotencyKey: z.uuid(),
})
export async function testConnection(
  store: ConnectionStore,
  who: Principal,
  id: string,
  raw: unknown,
  signal: AbortSignal
) {
  const input = testInput.parse(raw),
    requestHash = digest({ id, ...input }),
    selection = { connectionId: id, modelId: input.modelId }
  const run = await store.transaction(who, async (tx) => {
    const prior = await tx.query<RunRow & { request_hash: string }>(
      'SELECT * FROM forge_model_runs WHERE owner_id=$1 AND request_key=$2',
      [who.id, input.idempotencyKey]
    )
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash)
        throw new ByokError('IDEMPOTENCY', 'This test key belongs to another request.', 409)
      return prior.rows[0]
    }
    const row = await store.read(tx, who.id, id)
    const model = row.models.find((m) => m.id === input.modelId)
    if (!model || !model.capabilities[input.capability])
      throw new ByokError('CAPABILITY', 'Save a model with this capability before testing.')
    const profile = singleModelRouting(selection)
    profile.limits = { ...input.limits, maxCalls: 1, maxRepairs: 0 }
    const snapshot: RunSnapshot = {
      version: 1,
      routing: profile,
      bindings: [{ ...selection, revision: row.revision, profile: model }],
    }
    const r = await tx.query<RunRow>(
      'INSERT INTO forge_model_runs(id,owner_id,session_id,snapshot,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [randomUUID(), who.id, who.sessionId ?? null, snapshot, input.idempotencyKey, requestHash]
    )
    return r.rows[0]
  })
  if (run.status === 'complete') return { runId: run.id, verified: input.capability }
  const executor = new RunExecutor(store, who, run)
  try {
    const result = await executor.call(
      'capability-test',
      'test',
      selection,
      {
        system: 'You are testing a model connection. Follow the output instructions exactly.',
        prompt:
          input.capability === 'structured'
            ? 'Return JSON only: {"ok":true}'
            : input.capability === 'research'
              ? 'Search the web for the official TypeScript documentation. Return a brief answer with a source citation.'
              : 'Reply with exactly: Forge connection ready.',
        maxTokens: Math.min(1024, input.limits.maxOutputTokens),
        structured: input.capability === 'structured',
        research: input.capability === 'research',
      },
      signal
    )
    if (input.capability === 'structured' && JSON.parse(result.text).ok !== true)
      throw new ByokError('INVALID_OUTPUT', 'The model did not follow the test schema.')
    await store.transaction(who, async (tx) => {
      const row = await store.read(tx, who.id, id, true)
      if (row.revision !== run.snapshot.bindings[0].revision)
        throw new ByokError('STALE', 'The connection changed during testing.', 409)
      const models = row.models.map((m) =>
        m.id === input.modelId
          ? {
              ...m,
              verified: [...new Set([...m.verified, input.capability])],
              checkedAt: new Date().toISOString(),
            }
          : m
      )
      await tx.query('UPDATE forge_connections SET models=$3 WHERE owner_id=$1 AND id=$2', [
        who.id,
        id,
        JSON.stringify(models),
      ])
      await tx.query("UPDATE forge_model_runs SET status='complete' WHERE owner_id=$1 AND id=$2", [
        who.id,
        run.id,
      ])
    })
    return {
      runId: run.id,
      verified: input.capability,
      usage: result.usage,
      sources: result.sources,
    }
  } catch (error) {
    await store
      .transaction({ id: who.id, local: true }, (tx) =>
        tx.query("UPDATE forge_model_runs SET status='paused' WHERE owner_id=$1 AND id=$2", [
          who.id,
          run.id,
        ])
      )
      .catch(() => {})
    throw error
  }
}
export interface QueueInput {
  prompt?: string
  kind?: string
  mode?: string
  design?: unknown
  idempotencyKey: string
  baseRevision?: string | null
  routing?: RoutingProfile
}
export async function queueByok(
  store: ConnectionStore,
  who: Principal,
  input: QueueInput,
  projectId?: string
) {
  return store.transaction(who, async (tx) => {
    const requestHash = digest({ input, projectId: projectId ?? null })
    const prior = await tx.query<RunRow & { request_hash: string }>(
      'SELECT * FROM forge_model_runs WHERE owner_id=$1 AND request_key=$2',
      [who.id, input.idempotencyKey]
    )
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash)
        throw new ByokError('IDEMPOTENCY', 'Submission key was used for different input.', 409)
      const j = await tx.query('SELECT project_id FROM forge_jobs WHERE id=$1 AND owner_id=$2', [
        prior.rows[0].job_id,
        who.id,
      ])
      if (!j.rows[0]) throw new ByokError('JOB', 'Saved job is unavailable.', 409)
      return { id: j.rows[0].project_id, jobId: prior.rows[0].job_id, runId: prior.rows[0].id }
    }
    if (!who.local)
      throw new ByokError(
        'HOSTED_RUNTIME',
        'Connections are available. Hosted app building remains disabled until the isolated worker is verified.',
        503
      )
    const active = await tx.query(
      "SELECT count(*)::int AS count FROM forge_jobs WHERE owner_id=$1 AND status IN ('queued','running')",
      [who.id]
    )
    if (active.rows[0].count)
      throw new ByokError('BUSY', 'Finish or stop your active job first.', 409)
    const daily = await tx.query(
      "SELECT count(*)::int AS count FROM forge_jobs WHERE owner_id=$1 AND kind<>'restore' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
      [who.id]
    )
    if (daily.rows[0].count >= 10) throw new ByokError('DAILY', 'Daily request limit reached.', 429)
    let baseRevision: string | null = null
    if (projectId) {
      const p = await tx.query(
        'SELECT active_revision,archived FROM forge_projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [projectId, who.id]
      )
      if (!p.rows[0]) throw new ByokError('PROJECT', 'Project not found.', 404)
      if (p.rows[0].archived || p.rows[0].active_revision !== input.baseRevision)
        throw new ByokError('STALE', 'Review the latest active revision before building.', 409)
      baseRevision = p.rows[0].active_revision
    }
    const profiles = await tx.query(
      'SELECT profile FROM forge_routing_profiles WHERE owner_id=$1 AND scope=ANY($2::text[]) ORDER BY (scope=$3) DESC LIMIT 1',
      [who.id, [projectId ?? 'account', 'account'], projectId ?? 'account']
    )
    if (!input.routing && !profiles.rows[0])
      throw new ByokError('ROUTING', 'Save task assignments in Connections before building.')
    const snapshot = await store.snapshot(
      tx,
      who,
      routingSchema.parse(input.routing ?? profiles.rows[0].profile)
    )
    snapshot.sourceRevision = baseRevision
    if (!projectId) {
      const count = await tx.query(
        'SELECT count(*)::int AS count FROM forge_projects WHERE owner_id=$1 AND NOT archived',
        [who.id]
      )
      if (count.rows[0].count >= 5)
        throw new ByokError('PROJECT_LIMIT', 'Archive a project before creating another.', 429)
      projectId = randomUUID()
      await tx.query(
        'INSERT INTO forge_projects(id,owner_id,name,brief,design) VALUES($1,$2,$3,$4,$5)',
        [
          projectId,
          who.id,
          (input.prompt ?? 'Untitled').slice(0, 80),
          input.prompt ?? '',
          input.design ?? { style: '', preserve: '' },
        ]
      )
    }
    const jobId = randomUUID(),
      runId = randomUUID(),
      kind = input.kind ?? (input.mode === 'build' || !input.mode ? 'generate' : input.mode)
    await tx.query(
      "INSERT INTO forge_jobs(id,project_id,kind,prompt,provider,model,payload,owner_id,idempotency_key,base_revision) VALUES($1,$2,$3,$4,'byok','task-routing',$5,$6,$7,$8)",
      [
        jobId,
        projectId,
        kind,
        input.prompt ?? '',
        { runId },
        who.id,
        input.idempotencyKey,
        baseRevision,
      ]
    )
    await tx.query(
      'INSERT INTO forge_model_runs(id,owner_id,job_id,session_id,snapshot,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [runId, who.id, jobId, who.sessionId ?? null, snapshot, input.idempotencyKey, requestHash]
    )
    await tx.query(
      "INSERT INTO forge_messages(id,project_id,role,mode,content,job_id) VALUES($1,$2,'user',$3,$4,$5)",
      [randomUUID(), projectId, kind === 'generate' ? 'build' : kind, input.prompt ?? '', jobId]
    )
    return { id: projectId, jobId, runId }
  })
}
export async function runDetail(store: ConnectionStore, who: Principal, id: string) {
  const run = await readRun(store, who, id)
  return store.transaction(who, async (tx) => {
    const attempts = await tx.query(
      "SELECT id,model_id,connection_id,task,status,usage,reserved_micros,charged_micros,error_code,dispatched_at,result->'sources' AS sources FROM forge_model_attempts WHERE owner_id=$1 AND run_id=$2 ORDER BY dispatched_at",
      [who.id, id]
    )
    return {
      id: run.id,
      status: run.status,
      snapshot: run.snapshot,
      resolved: run.resolved,
      calls: run.calls,
      attempts: attempts.rows,
    }
  })
}
