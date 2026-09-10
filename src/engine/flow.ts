import { z } from 'zod'
import { EngineApiError, EngineClient } from './client.ts'
import type { EventEnvelope } from './client.ts'

// Browser-only decoders for the currently implemented E1 HTTP projections. Do
// not import engine/control: it contains server credentials/database dependencies.
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/)
const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), positive = uint.min(1)
const origin = z.literal('fixture'), version = z.literal(1)
const preset = z.enum(['technical-mono', 'editorial-product', 'cinematic-monochrome', 'atmospheric-pixel', 'illustrated-landscape', 'fixture'])
const sessionSchema = z.strictObject({ schemaVersion: version, origin, userId: uuid,
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), memberships: z.array(z.strictObject({ workspace_id: uuid, role: z.enum(['owner', 'editor', 'viewer']) })) })
const capabilitiesSchema = z.strictObject({ schemaVersion: version, origin, control: z.boolean(), generation: z.literal(false), execution: z.literal(false),
  preview: z.literal(false), fixtureWorkflows: z.boolean(), modelPolicies: z.array(z.literal('fixture-v1')), templates: z.array(z.literal('next-postgres-v1')), externalGates: z.array(z.string()) })
const projectSchema = z.strictObject({ id: uuid, workspaceId: uuid, name: z.string(), brief: z.string(), presetId: preset, presetVersion: version,
  templateId: z.literal('next-postgres-v1'), revision: positive, headSnapshotId: uuid.nullable(), origin })
const states = z.enum(['QUEUED', 'PLANNING', 'AWAITING_PLAN_APPROVAL', 'GENERATING', 'VALIDATING', 'AWAITING_EXECUTION_APPROVAL',
  'PROVISIONING', 'VERIFYING', 'REPAIRING', 'PREPARING_PREVIEW', 'AWAITING_PROMOTION', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'])
const commonReview = z.object({ schemaVersion: version, workspaceId: uuid, projectId: uuid, jobId: uuid, baseRevision: positive,
  baseSnapshotId: uuid.nullable(), templateDigest: hash, policyDigest: hash, expiresAt: z.iso.datetime({ offset: true }) }).passthrough()
const planReview = commonReview.extend({ planDigest: hash })
const executionReview = commonReview.extend({ candidateDigest: hash, diffDigest: hash, imageDigest: z.string(), commandPolicy: z.unknown(), migrations: z.array(z.unknown()), migrationBundleDigest: hash, dataReset: z.literal('synthetic-data-only') })
const promotionReview = commonReview.extend({ candidateDigest: hash, verificationDigest: hash })
const jobSchema = z.strictObject({ schemaVersion: version, origin, id: uuid, workspaceId: uuid, projectId: uuid, state: states, stateVersion: positive,
  baseRevision: positive, baseSnapshotId: uuid.nullable(), reviewDigest: hash.nullable(), review: z.unknown(), candidateSnapshotId: uuid.nullable(),
  cleanupPending: z.boolean(), finishedAt: z.iso.datetime({ offset: true }).nullable() }).superRefine((job, ctx) => {
  if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.state) !== (job.finishedAt !== null)) ctx.addIssue({ code: 'custom', message: 'Terminal timestamp mismatch' })
  const schema = job.state === 'AWAITING_PLAN_APPROVAL' ? planReview : job.state === 'AWAITING_EXECUTION_APPROVAL' ? executionReview : job.state === 'AWAITING_PROMOTION' ? promotionReview : null
  if (!schema) { if (job.review !== null || job.reviewDigest !== null) ctx.addIssue({ code: 'custom', message: 'Unexpected review' }); return }
  const parsed = schema.safeParse(job.review)
  if (!job.reviewDigest || !parsed.success) { ctx.addIssue({ code: 'custom', message: 'Invalid job review' }); return }
  const r = parsed.data
  if (r.workspaceId !== job.workspaceId || r.projectId !== job.projectId || r.jobId !== job.id || r.baseRevision !== job.baseRevision || r.baseSnapshotId !== job.baseSnapshotId)
    ctx.addIssue({ code: 'custom', message: 'Review scope mismatch' })
})
const projectEnvelope = z.strictObject({ schemaVersion: version, origin, project: projectSchema })
const jobEnvelope = z.strictObject({ schemaVersion: version, origin, job: jobSchema, eventsUrl: z.string().optional() })
const projectPage = z.strictObject({ schemaVersion: version, origin, items: z.array(projectSchema), nextCursor: uuid.nullable() })
const snapshotSchema = z.strictObject({ id: uuid, parent_id: uuid.nullable(), manifest_digest: hash, status: z.enum(['candidate', 'verified', 'rejected']),
  origin, created_at: z.iso.datetime({ offset: true }) })
const historyEnvelope = z.strictObject({ schemaVersion: version, origin, items: z.array(snapshotSchema).max(100) })
export type FlowProject = z.infer<typeof projectSchema>
export type FlowJob = z.infer<typeof jobSchema>
export type FlowSession = Omit<z.infer<typeof sessionSchema>, 'csrfToken'>
export type FlowCapabilities = z.infer<typeof capabilitiesSchema>
export type FlowSnapshot = z.infer<typeof snapshotSchema>
export interface ReviewToken { jobId: string; kind: 'plan' | 'execution' | 'promotion'; subjectDigest: string; stateVersion: number;
  baseRevision: number; baseSnapshotId: string | null; candidateSnapshotId: string | null; verificationDigest: string | null }
export interface FlowState {
  session: FlowSession | null; capabilities: FlowCapabilities | null; workspaceId: string | null;
  projects: FlowProject[]; nextProjectCursor: string | null; project: FlowProject | null; job: FlowJob | null; history: FlowSnapshot[];
  lastEventSeq: number; stream: 'idle' | 'connected' | 'disconnected' | 'terminal' | 'replay-required';
  pendingActions: { actionId: string; status: 'running' | 'ambiguous' | 'completed' | 'rejected' }[];
  unavailable: { preview: 'ENDPOINT_UNAVAILABLE'; sourceExport: 'ENDPOINT_UNAVAILABLE' }
}
interface Mutation { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body: unknown; revision?: number; result: 'project' | 'job' }
interface Action { identity: string; mutation: Mutation; projectScope?: { projectId: string; workspaceId: string }; key: string; status: 'running' | 'ambiguous' | 'completed' | 'rejected'; promise?: Promise<FlowProject | FlowJob>; result?: FlowProject | FlowJob; error?: EngineApiError }
const terminal = (job: FlowJob) => ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.state)
const initial = (): FlowState => ({ session: null, capabilities: null, workspaceId: null, projects: [], nextProjectCursor: null, project: null, job: null,
  history: [], lastEventSeq: 0, stream: 'idle', pendingActions: [], unavailable: { preview: 'ENDPOINT_UNAVAILABLE', sourceExport: 'ENDPOINT_UNAVAILABLE' } })
const identity = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const decode = <T>(schema: z.ZodType<T>) => (value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw new Error('INVALID_FLOW_RESPONSE'); return result.data }

/** Headless fixture-control client. No rendering, browser storage, authentication
 * inference, execution or live-preview claim. E1 is the sole authority. */
export class EngineFlow {
  private value = initial()
  private readonly actions = new Map<string, Action>()
  private authEpoch = 0
  private selection = 0
  private jobRead = 0
  private projectsRead = 0
  private historyRead = 0
  private streamAbort: AbortController | null = null
  constructor(private readonly client = new EngineClient(), private readonly now: () => number = Date.now) {}
  get state(): FlowState {
    return structuredClone({ ...this.value, pendingActions: [...this.actions].map(([actionId, action]) => ({ actionId, status: action.status })) })
  }
  private resetSession() {
    this.authEpoch++; this.selection++; this.streamAbort?.abort(); this.streamAbort = null
    this.client.setCsrf(null); this.actions.clear(); this.value = initial()
  }
  private fail(error: unknown, epoch: number): never {
    if (epoch === this.authEpoch && error instanceof EngineApiError && error.status === 401) this.resetSession()
    throw error
  }
  private requireSession(workspaceId?: string, edit = false) {
    if (!this.value.session) throw new EngineApiError(401, 'SESSION_REQUIRED', false)
    if (workspaceId) {
      const member = this.value.session.memberships.find(m => m.workspace_id === workspaceId)
      if (!member || edit && member.role === 'viewer') throw new EngineApiError(403, 'FORBIDDEN', false)
    }
  }
  async loadSession(signal?: AbortSignal): Promise<FlowSession> {
    const epoch = ++this.authEpoch
    this.streamAbort?.abort(); this.value.stream = 'disconnected'
    try {
      const session = await this.client.read('/session', decode(sessionSchema), signal)
      if (epoch !== this.authEpoch) throw new Error('STALE_FLOW_READ')
      if (this.value.session && this.value.session.userId !== session.userId) {
        this.selection++; this.streamAbort?.abort(); this.actions.clear(); this.value = initial()
      }
      const { csrfToken, ...publicSession } = session
      this.client.setCsrf(csrfToken); this.value.session = publicSession
      if (this.value.workspaceId && !session.memberships.some(m => m.workspace_id === this.value.workspaceId)) {
        this.selection++; this.streamAbort?.abort(); this.value = { ...initial(), session: publicSession }
      }
      return structuredClone(publicSession)
    } catch (error) { return this.fail(error, epoch) }
  }
  async loadCapabilities(signal?: AbortSignal): Promise<FlowCapabilities> {
    this.requireSession(); const epoch = this.authEpoch
    try {
      const result = await this.client.read('/capabilities', decode(capabilitiesSchema), signal)
      if (epoch !== this.authEpoch) throw new Error('STALE_FLOW_READ')
      this.value.capabilities = result; return structuredClone(result)
    } catch (error) { return this.fail(error, epoch) }
  }
  async loadProjects(workspaceId: string, cursor?: string, signal?: AbortSignal) {
    uuid.parse(workspaceId); if (cursor) uuid.parse(cursor); this.requireSession(workspaceId)
    const epoch = this.authEpoch, selection = this.selection, read = ++this.projectsRead
    try {
      const result = await this.client.read(`/workspaces/${workspaceId}/projects${cursor ? '?cursor=' + cursor : ''}`, decode(projectPage), signal)
      if (epoch !== this.authEpoch || selection !== this.selection || read !== this.projectsRead) throw new Error('STALE_FLOW_READ')
      if (result.items.some(p => p.workspaceId !== workspaceId)) throw new Error('FOREIGN_FLOW_PROJECT')
      if (this.value.workspaceId !== workspaceId) { this.selection++; this.streamAbort?.abort(); this.value = { ...initial(), session: this.value.session, capabilities: this.value.capabilities } }
      this.value.workspaceId = workspaceId; this.value.projects = result.items; this.value.nextProjectCursor = result.nextCursor
      return structuredClone(result)
    } catch (error) { return this.fail(error, epoch) }
  }
  async loadProject(projectId: string, signal?: AbortSignal): Promise<FlowProject> {
    uuid.parse(projectId); this.requireSession(); const epoch = this.authEpoch, selection = ++this.selection
    this.streamAbort?.abort(); this.value.project = null; this.value.job = null; this.value.history = []; this.value.lastEventSeq = 0; this.value.stream = 'idle'
    try {
      const { project } = await this.client.read(`/projects/${projectId}`, decode(projectEnvelope), signal)
      if (epoch !== this.authEpoch || selection !== this.selection) throw new Error('STALE_FLOW_READ')
      if (project.id !== projectId) throw new Error('FOREIGN_FLOW_PROJECT')
      this.requireSession(project.workspaceId); this.value.workspaceId = project.workspaceId; this.value.project = project
      return structuredClone(project)
    } catch (error) { return this.fail(error, epoch) }
  }
  async loadJob(jobId: string, signal?: AbortSignal): Promise<FlowJob> {
    uuid.parse(jobId); const project = this.currentProject(), epoch = this.authEpoch, selection = this.selection, read = ++this.jobRead
    try {
      const { job } = await this.client.read(`/jobs/${jobId}`, decode(jobEnvelope), signal)
      if (epoch !== this.authEpoch || selection !== this.selection || read !== this.jobRead) throw new Error('STALE_FLOW_READ')
      if (job.id !== jobId || job.projectId !== project.id || job.workspaceId !== project.workspaceId) throw new Error('FOREIGN_FLOW_JOB')
      if (this.value.job?.id !== job.id) { this.streamAbort?.abort(); this.value.lastEventSeq = 0; this.value.stream = 'idle' }
      if (!this.value.job || this.value.job.id !== job.id || job.stateVersion >= this.value.job.stateVersion) this.value.job = job
      return structuredClone(this.value.job!)
    } catch (error) { return this.fail(error, epoch) }
  }
  async loadHistory(signal?: AbortSignal): Promise<FlowSnapshot[]> {
    const project = this.currentProject(), epoch = this.authEpoch, selection = this.selection, read = ++this.historyRead
    try {
      const result = await this.client.read(`/projects/${project.id}/snapshots`, decode(historyEnvelope), signal)
      if (epoch !== this.authEpoch || selection !== this.selection || read !== this.historyRead) throw new Error('STALE_FLOW_READ')
      this.value.history = result.items; return structuredClone(result.items)
    } catch (error) { return this.fail(error, epoch) }
  }
  async reload(projectId: string, jobId?: string, signal?: AbortSignal) {
    await this.loadProject(projectId, signal)
    await this.loadHistory(signal)
    if (jobId) await this.loadJob(jobId, signal)
    return this.state
  }
  private currentProject(edit = false): FlowProject {
    if (!this.value.project) throw new Error('PROJECT_REQUIRED')
    this.requireSession(this.value.project.workspaceId, edit); return this.value.project
  }
  reviewToken(): ReviewToken {
    const job = this.value.job
    if (!job || !job.reviewDigest) throw new Error('REVIEW_UNAVAILABLE')
    const kind = job.state === 'AWAITING_PLAN_APPROVAL' ? 'plan' : job.state === 'AWAITING_EXECUTION_APPROVAL' ? 'execution' : job.state === 'AWAITING_PROMOTION' ? 'promotion' : null
    if (!kind) throw new Error('REVIEW_UNAVAILABLE')
    const review = decode(commonReview)(job.review)
    if (Date.parse(review.expiresAt) <= this.now()) throw new Error('REVIEW_EXPIRED')
    return { jobId: job.id, kind, subjectDigest: job.reviewDigest, stateVersion: job.stateVersion, baseRevision: job.baseRevision,
      baseSnapshotId: job.baseSnapshotId, candidateSnapshotId: job.candidateSnapshotId,
      verificationDigest: kind === 'promotion' ? decode(promotionReview)(job.review).verificationDigest : null }
  }
  private exactReview(token: ReviewToken) {
    const project = this.currentProject(true)
    if (identity(token) !== identity(this.reviewToken()) || token.baseRevision !== project.revision || token.baseSnapshotId !== project.headSnapshotId) throw new Error('STALE_FLOW_REVIEW')
  }
  /** actionId is a caller-stable user action UUID. Keep it when retrying after an
   * ambiguous failure. Reuse with a changed intent rejects; no automatic retry. */
  private act(actionId: string, intent: unknown, prepare: () => Mutation & { result: 'project' }): Promise<FlowProject>
  private act(actionId: string, intent: unknown, prepare: () => Mutation & { result: 'job' }): Promise<FlowJob>
  private act(actionId: string, intent: unknown, prepare: () => Mutation): Promise<FlowProject | FlowJob> {
    uuid.parse(actionId); this.requireSession()
    const signature = identity(intent)
    let action = this.actions.get(actionId)
    if (action) {
      if (action.identity !== signature) return Promise.reject(new Error('ACTION_ID_REUSED'))
      if (action.promise) return action.promise
      if (action.result) return Promise.resolve(structuredClone(action.result))
      if (action.error) return Promise.reject(action.error)
    } else {
      if (this.actions.size >= 100) return Promise.reject(new Error('FLOW_ACTION_CAP'))
      const mutation = structuredClone(prepare())
      const projectScope = mutation.result === 'job' ? { projectId: this.currentProject().id, workspaceId: this.currentProject().workspaceId } : undefined
      action = { identity: signature, mutation, projectScope, key: actionId, status: 'running' }
      this.actions.set(actionId, action)
    }
    const current = action, epoch = this.authEpoch, selection = this.selection
    current.status = 'running'
    const request = current.mutation
    current.promise = this.client.mutate(request.path, request.method, request.body, current.key, input => request.result === 'project'
      ? decode(projectEnvelope)(input).project : decode(jobEnvelope)(input).job, { revision: request.revision }).then(async result => {
      if (epoch !== this.authEpoch) throw new Error('STALE_FLOW_SESSION')
      const jobRoute = /^\/jobs\/([^/]+)/.exec(request.path)
      const projectRoute = /^\/projects\/([^/]+)/.exec(request.path)
      const workspaceRoute = /^\/workspaces\/([^/]+)/.exec(request.path)
      if ('stateVersion' in result ? jobRoute && result.id !== jobRoute[1] || projectRoute && result.projectId !== projectRoute[1]
        : projectRoute && result.id !== projectRoute[1] || workspaceRoute && result.workspaceId !== workspaceRoute[1]) throw new Error('FOREIGN_FLOW_RESULT')
      if ('stateVersion' in result && current.projectScope && (result.projectId !== current.projectScope.projectId || result.workspaceId !== current.projectScope.workspaceId)) throw new Error('FOREIGN_FLOW_RESULT')
      current.result = structuredClone(result); current.status = 'completed'
      if (selection === this.selection) {
        if ('stateVersion' in result) {
          const project = this.currentProject()
          if (result.projectId !== project.id || result.workspaceId !== project.workspaceId) throw new Error('FOREIGN_FLOW_JOB')
          if (this.value.job?.id !== result.id) { this.streamAbort?.abort(); this.value.lastEventSeq = 0 }
          if (!this.value.job || this.value.job.id !== result.id || result.stateVersion >= this.value.job.stateVersion) this.value.job = result
          if (terminal(result)) await this.refreshTerminal(result)
        } else {
          this.requireSession(result.workspaceId)
          if (this.value.project?.id !== result.id) {
            this.selection++; this.streamAbort?.abort(); this.value.job = null; this.value.history = []; this.value.lastEventSeq = 0; this.value.stream = 'idle'
          }
          if (!this.value.project || this.value.project.id !== result.id || result.revision >= this.value.project.revision) this.value.project = result
          this.value.workspaceId = result.workspaceId
        }
      }
      return structuredClone(result)
    }).catch(error => {
      if (current.result) { current.status = 'completed'; return this.fail(error, epoch) } // committed mutation; refresh failed, never resend under a new key
      if (error instanceof EngineApiError && error.status >= 400 && error.status < 500 && !error.retryable) { current.status = 'rejected'; current.error = error }
      else current.status = 'ambiguous'
      return this.fail(error, epoch)
    }).finally(() => { current.promise = undefined })
    return current.promise
  }
  /** Only settled actions may be forgotten. Never reuse a forgotten action ID. */
  forgetCompletedAction(actionId: string) { if (!['completed', 'rejected'].includes(this.actions.get(actionId)?.status ?? '')) throw new Error('ACTION_NOT_COMPLETED'); this.actions.delete(actionId) }
  createProject(actionId: string, workspaceId: string, input: { name: string; brief: string; presetId: FlowProject['presetId'] }) {
    uuid.parse(workspaceId)
    return this.act(actionId, { kind: 'createProject', workspaceId, input }, () => {
      this.requireSession(workspaceId, true)
      return { path: `/workspaces/${workspaceId}/projects`, method: 'POST', result: 'project', body: { schemaVersion: 1, ...input, templateId: 'next-postgres-v1', presetVersion: 1 } }
    })
  }
  patchProject(actionId: string, input: { name?: string; brief?: string; presetId?: FlowProject['presetId']; presetVersion?: 1 }) {
    const project = this.currentProject(true)
    return this.act(actionId, { kind: 'patchProject', projectId: project.id, input }, () => ({ path: `/projects/${project.id}`, method: 'PATCH', revision: project.revision,
      result: 'project', body: { schemaVersion: 1, ...input } }))
  }
  generate(actionId: string, instruction: string, maxCostMicros = 0) {
    const project = this.currentProject(true); uint.parse(maxCostMicros)
    return this.act(actionId, { kind: 'generate', projectId: project.id, instruction, maxCostMicros }, () => {
      if (!this.value.capabilities?.fixtureWorkflows || !this.value.capabilities.modelPolicies.includes('fixture-v1')) throw new Error('FIXTURE_WORKFLOW_UNAVAILABLE')
      return { path: `/projects/${project.id}/jobs`, method: 'POST', result: 'job', body: { schemaVersion: 1, kind: 'generate', baseSnapshotId: project.headSnapshotId,
        baseRevision: project.revision, instruction, modelPolicyId: 'fixture-v1', maxCostMicros } }
    })
  }
  approve(actionId: string, token: ReviewToken, decision: 'approve' | 'reject') {
    if (token.kind === 'promotion') throw new Error('USE_EXPLICIT_PROMOTION')
    return this.act(actionId, { kind: 'approve', token, decision }, () => {
      this.exactReview(token)
      return { path: `/jobs/${token.jobId}/approvals`, method: 'POST', result: 'job', body: { schemaVersion: 1, kind: token.kind, subjectDigest: token.subjectDigest, stateVersion: token.stateVersion, decision } }
    })
  }
  cancel(actionId: string) {
    const project = this.currentProject(true), job = this.value.job
    if (!job || job.projectId !== project.id) throw new Error('JOB_REQUIRED')
    return this.act(actionId, { kind: 'cancel', jobId: job.id }, () => ({ path: `/jobs/${job.id}/cancel`, method: 'POST', result: 'job', body: { schemaVersion: 1 } }))
  }
  promote(actionId: string, token: ReviewToken) {
    return this.act(actionId, { kind: 'promote', token }, () => {
      this.exactReview(token)
      if (token.kind !== 'promotion' || !token.candidateSnapshotId || !token.verificationDigest) throw new Error('PROMOTION_UNAVAILABLE')
      return { path: `/jobs/${token.jobId}/promote`, method: 'POST', result: 'job', body: { schemaVersion: 1, snapshotId: token.candidateSnapshotId,
        verificationDigest: token.verificationDigest, stateVersion: token.stateVersion, expectedProjectRevision: token.baseRevision } }
    })
  }
  restore(actionId: string, snapshotId: string, resetPreviewDataAcknowledged: true, maxCostMicros = 0) {
    uuid.parse(snapshotId); z.literal(true).parse(resetPreviewDataAcknowledged); uint.parse(maxCostMicros)
    const project = this.currentProject(true)
    return this.act(actionId, { kind: 'restore', projectId: project.id, snapshotId, resetPreviewDataAcknowledged, maxCostMicros }, () => {
      if (!this.value.history.some(s => s.id === snapshotId && s.status === 'verified')) throw new Error('RESTORATION_SOURCE_UNAVAILABLE')
      return { path: `/projects/${project.id}/restorations`, method: 'POST', result: 'job', body: { schemaVersion: 1, snapshotId, expectedProjectRevision: project.revision, resetPreviewDataAcknowledged, maxCostMicros } }
    })
  }
  private async refreshTerminal(job: FlowJob, signal?: AbortSignal) {
    const epoch = this.authEpoch, selection = this.selection
    const { project } = await this.client.read(`/projects/${job.projectId}`, decode(projectEnvelope), signal)
    if (epoch !== this.authEpoch || selection !== this.selection) return
    if (project.id !== job.projectId || project.workspaceId !== job.workspaceId) throw new Error('FOREIGN_FLOW_PROJECT')
    if (!this.value.project || project.revision >= this.value.project.revision) this.value.project = project
    await this.loadHistory(signal); this.value.stream = 'terminal'
  }
  /** One bounded connection attempt. Caller controls reconnection/backoff; EOF
   * refreshes authoritative job state and retains the last delivered cursor. */
  async watch(signal: AbortSignal): Promise<void> {
    const project = this.currentProject(), job = this.value.job
    if (!job) throw new Error('JOB_REQUIRED')
    if (this.value.stream === 'replay-required') throw new Error('EVENT_REPLAY_REQUIRED')
    this.streamAbort?.abort(); const controller = new AbortController(); this.streamAbort = controller
    const combined = AbortSignal.any([signal, controller.signal]), epoch = this.authEpoch, selection = this.selection
    this.value.stream = 'connected'
    const scope = { workspaceId: project.workspaceId, projectId: project.id, jobId: job.id }
    let refreshRequested = false, refreshError: unknown
    let refreshWork: Promise<void> | null = null
    const refresh = () => {
      refreshRequested = true
      if (refreshWork) return
      refreshWork = (async () => {
        while (refreshRequested && !combined.aborted) {
          refreshRequested = false
          const current = await this.loadJob(job.id, combined)
          if (terminal(current)) await this.refreshTerminal(current, combined)
        }
      })().catch(error => { if (error instanceof EngineApiError && error.status === 401 || !combined.aborted) { refreshError = error; controller.abort() } }).finally(() => { refreshWork = null })
    }
    try {
      await this.client.events(scope, this.value.lastEventSeq, (event: EventEnvelope) => {
        if (epoch !== this.authEpoch || selection !== this.selection || this.streamAbort !== controller) return
        this.value.lastEventSeq = event.seq // E1 events invalidate cached state; they never authorize local transitions.
        refresh()
      }, combined)
      await refreshWork
      if (refreshError) throw refreshError
      if (combined.aborted || epoch !== this.authEpoch || selection !== this.selection) return
      const current = await this.loadJob(job.id, combined)
      if (terminal(current)) await this.refreshTerminal(current, combined)
      else this.value.stream = 'disconnected'
    } catch (error) {
      if (error instanceof EngineApiError && error.status === 401) return this.fail(error, epoch)
      if (epoch !== this.authEpoch || selection !== this.selection || this.streamAbort !== controller) return
      if (refreshError) return this.fail(refreshError, epoch)
      if (combined.aborted) { this.value.stream = 'disconnected'; return }
      if (error instanceof EngineApiError && error.status === 401) return this.fail(error, epoch)
      const replay = error instanceof EngineApiError && error.status === 410 || error instanceof Error && error.message === 'ENGINE_EVENT_GAP'
      this.value.stream = replay ? 'replay-required' : 'disconnected'
      // Reauthorize/refresh after EOF/revocation too; cursor recovery needs an
      // explicit server checkpoint, absent from the current job projection.
      try { await this.loadJob(job.id) } catch (refreshError) { return this.fail(refreshError, epoch) }
      throw error
    } finally { if (this.streamAbort === controller) this.streamAbort = null }
  }
}
