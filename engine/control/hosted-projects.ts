import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import type { TemplateCatalog } from '../generation/catalog.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import { enqueueDispatch } from '../scheduling/outbox.ts'
import type { HostedIdentityBridge } from './hosted-identity.ts'
import { ControlError, keySchema } from './contracts.ts'
import { idempotent } from './service.ts'
import { appendEvent, enqueue, flushEventSequence } from './state.ts'
import type { JobRow } from './state.ts'
import { number, one } from './database.ts'
import type { ControlDatabase } from './database.ts'

const draftSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(20).max(12000),
})
const admissionSchema = z.strictObject({
  instruction: z.string().trim().min(20).max(12000),
  baseRevision: z.number().int().positive(),
  baseSnapshotId: z.uuid().nullable(),
})
const publicProject = (r: Record<string, unknown>) => ({
  id: r.id,
  name: r.name,
  brief: r.brief,
  revision: number(r.revision as string),
  headSnapshotId: r.head_snapshot_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  origin: 'hosted' as const,
})

/** Canonical projects/jobs/quotas and authenticated E1 sessions. Saving a draft
 * does not require a model key; admission is a separate durable transaction.
 * No source execution, provider call, scheduler HTTP or implicit approval here. */
export class HostedProjects {
  constructor(
    private readonly db: ControlDatabase,
    private readonly bridge: HostedIdentityBridge,
    private readonly catalog: TemplateCatalog,
    private readonly registry: ProviderRegistry,
    private readonly preset: { id: string; version: number; value: unknown }
  ) {
    if (
      db.role !== 'forge_control_api' ||
      db.environment !== 'hosted' ||
      catalog.evidence !== 'release'
    )
      throw new Error('HOSTED_PROJECT_CONFIGURATION')
    this.preset = structuredClone(preset)
  }
  async create(token: string, workspace: string, csrf: string, key: string, input: unknown) {
    const draft = draftSchema.parse(input)
    keySchema.parse(key)
    return this.db.session(token, workspace, 'owner', async (c, actor) => {
      this.bridge.checkCsrf(actor.csrf_hash, csrf)
      return idempotent(c, actor, workspace, key, 'POST /hosted/projects', draft, async () => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `hosted-projects:${workspace}`,
        ])
        const limits = await one<{ max_projects_per_workspace: number }>(
          c,
          'SELECT max_projects_per_workspace FROM hosted_generation_limits WHERE singleton'
        )
        const count = await one<{ n: number }>(
          c,
          'SELECT count(*)::int AS n FROM projects WHERE workspace_id=$1 AND deleting_at IS NULL',
          [workspace]
        )
        if (count.n >= limits.max_projects_per_workspace)
          throw new ControlError(429, 'PROJECT_CAPACITY_UNAVAILABLE')
        const row = await one<Record<string, unknown>>(
          c,
          `INSERT INTO projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest,origin)
          VALUES($1,$2,$3,$4,$5,$6,'next-postgres-v1',$7,'hosted') RETURNING *`,
          [
            randomUUID(),
            workspace,
            draft.name,
            draft.prompt,
            this.preset.id,
            this.preset.version,
            this.catalog.manifest.template.digest,
          ]
        )
        return { status: 201, body: { schemaVersion: 1, project: publicProject(row) } }
      })
    })
  }
  async list(token: string, workspace: string) {
    return this.db.session(token, workspace, 'owner', async (c) =>
      (
        await c.query(
          "SELECT * FROM projects WHERE workspace_id=$1 AND origin='hosted' AND deleting_at IS NULL ORDER BY created_at DESC LIMIT 5",
          [workspace]
        )
      ).rows.map(publicProject)
    )
  }
  async admit(
    token: string,
    workspace: string,
    csrf: string,
    projectId: string,
    key: string,
    input: unknown
  ) {
    z.uuid().parse(projectId)
    const body = admissionSchema.parse(input)
    return this.db.session(token, workspace, 'owner', async (c, actor) => {
      this.bridge.checkCsrf(actor.csrf_hash, csrf)
      return idempotent(
        c,
        actor,
        workspace,
        key,
        `POST /hosted/projects/${projectId}/jobs`,
        body,
        async () => {
          const settings = await one<{
            environment: string
            max_job_micros: string
            worker_enabled: boolean
          }>(c, 'SELECT * FROM lock_admission()')
          if (
            settings.environment !== 'hosted' ||
            !settings.worker_enabled ||
            number(settings.max_job_micros) !== 0
          )
            throw new ControlError(503, 'HOSTED_GENERATION_UNAVAILABLE')
          const limits = await one<{ max_daily_jobs: number }>(
            c,
            'SELECT max_daily_jobs FROM hosted_generation_limits WHERE singleton'
          )
          const today = (
            await one<{ day: string }>(
              c,
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day"
            )
          ).day
          await c.query(
            'INSERT INTO hosted_generation_days(day) VALUES($1) ON CONFLICT DO NOTHING',
            [today]
          )
          const daily = await one<{ jobs: number }>(
            c,
            'SELECT jobs FROM hosted_generation_days WHERE day=$1 FOR UPDATE',
            [today]
          )
          if (daily.jobs >= limits.max_daily_jobs)
            throw new ControlError(429, 'FREE_CAPACITY_UNAVAILABLE')
          const project = await one<Record<string, unknown>>(
            c,
            "SELECT * FROM projects WHERE workspace_id=$1 AND id=$2 AND origin='hosted' AND deleting_at IS NULL FOR UPDATE",
            [workspace, projectId]
          )
          if (
            number(project.revision as string) !== body.baseRevision ||
            project.head_snapshot_id !== body.baseSnapshotId
          )
            throw new ControlError(412, 'REVISION_MISMATCH')
          if (
            project.template_digest !== this.catalog.manifest.template.digest ||
            project.preset_id !== this.preset.id ||
            project.preset_version !== this.preset.version
          )
            throw new ControlError(409, 'TEMPLATE_REVALIDATION_REQUIRED')
          if (
            (
              await c.query('SELECT 1 FROM jobs WHERE workspace_id=$1 AND finished_at IS NULL', [
                workspace,
              ])
            ).rowCount
          )
            throw new ControlError(429, 'ACTIVE_JOB_EXISTS')
          const selected = (
            await c.query(
              `SELECT k.id,k.revision,k.provider,k.destination,v.model
          FROM provider_choices s JOIN provider_credentials k ON k.workspace_id=s.workspace_id AND k.id=s.credential_id
          JOIN provider_validations v ON v.workspace_id=k.workspace_id AND v.credential_id=k.id AND v.revision=k.revision
          WHERE s.workspace_id=$1 AND NOT k.deleted AND v.free_tier_confirmed AND v.checked_at>clock_timestamp()-interval '1 day' FOR SHARE OF k`,
              [workspace]
            )
          ).rows[0]
          if (!selected) throw new ControlError(422, 'MODEL_CONNECTION_REQUIRED')
          const policy = this.registry.policy(selected.provider as string, 'plan')
          if (
            !policy.price.freeOnly ||
            policy.price.inputMicrosPerMillion !== 0 ||
            policy.price.outputMicrosPerMillion !== 0 ||
            policy.model !== selected.model ||
            policy.endpoint !== selected.destination
          )
            throw new ControlError(422, 'FREE_MODEL_VERIFICATION_REQUIRED')
          const policyDigest = canonicalHash(policy),
            template = this.catalog.manifest
          if (
            (
              await c.query('SELECT 1 FROM revoked_policies WHERE digest IN($1,$2,$3)', [
                policyDigest,
                template.template.digest,
                template.commandPolicyDigest,
              ])
            ).rowCount
          )
            throw new ControlError(409, 'POLICY_REVOKED')
          const { period } = await one<{ period: Date }>(
            c,
            "SELECT (date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS period"
          )
          await c.query(
            `INSERT INTO workspace_quotas(workspace_id,period_start,limit_micros,reserved_micros,max_active_jobs,max_previews)
          VALUES($1,$2,0,0,1,1) ON CONFLICT DO NOTHING`,
            [workspace, period]
          )
          const quota = await one<{
            limit_micros: string
            reserved_micros: string
            spent_micros: string
            max_active_jobs: number
          }>(
            c,
            'SELECT * FROM workspace_quotas WHERE workspace_id=$1 AND period_start=$2 FOR UPDATE',
            [workspace, period]
          )
          if (
            number(quota.limit_micros) !== 0 ||
            number(quota.reserved_micros) !== 0 ||
            number(quota.spent_micros) !== 0 ||
            quota.max_active_jobs !== 1
          )
            throw new ControlError(429, 'FREE_CAPACITY_UNAVAILABLE')
          const job = await one<JobRow>(
            c,
            `INSERT INTO jobs(id,workspace_id,project_id,created_by,kind,base_snapshot_id,base_revision,request_json,policy_digest,template_digest,prompt_version,model_policy_json,cost_limit_micros,active_remaining_ms,origin)
          VALUES($1,$2,$3,$4,'generate',$5,$6,$7,$8,$9,'hosted-next-source-v1',$10,0,1200000,'hosted') RETURNING *`,
            [
              randomUUID(),
              workspace,
              projectId,
              actor.user_id,
              body.baseSnapshotId,
              body.baseRevision,
              { schemaVersion: 1, ...body },
              template.commandPolicyDigest,
              template.template.digest,
              {
                schemaVersion: 1,
                origin: 'hosted',
                providerPolicyDigest: policyDigest,
                provider: policy.id,
                model: policy.model,
              },
            ]
          )
          await c.query(
            `INSERT INTO hosted_job_bindings(workspace_id,project_id,job_id,parent_session_hash,credential_id,credential_revision,provider,model,provider_policy_json,provider_policy_digest,preset_json,instruction_digest)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              workspace,
              projectId,
              job.id,
              sha256(token),
              selected.id,
              selected.revision,
              policy.id,
              policy.model,
              policy,
              policyDigest,
              this.preset.value,
              sha256(body.instruction),
            ]
          )
          await c.query(
            `INSERT INTO usage_reservations(id,workspace_id,project_id,job_id,reserved_micros,status,expires_at,period_start)
          VALUES($1,$2,$3,$4,0,'open',clock_timestamp()+interval '7 days',$5)`,
            [randomUUID(), workspace, projectId, job.id, period]
          )
          await c.query('UPDATE hosted_generation_days SET jobs=jobs+1 WHERE day=$1', [today])
          await enqueue(c, job)
          await enqueueDispatch(c, actor, job.id, {
            schemaVersion: 1,
            dispatchId: randomUUID(),
            workspaceId: workspace,
            jobId: job.id,
            expiresAt: new Date(Date.now() + 14 * 60000).toISOString(),
          })
          await appendEvent(c, job, 'job.state', { from: 'QUEUED', to: 'QUEUED' })
          await flushEventSequence(c, job)
          return {
            status: 202,
            body: {
              schemaVersion: 1,
              origin: 'hosted',
              projectId,
              jobId: job.id,
              state: job.state,
            },
          }
        }
      )
    })
  }
}
