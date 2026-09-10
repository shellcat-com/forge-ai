import './workspace.css'
import { EngineClient, EngineApiError } from './client.ts'
import { EngineFlow } from './flow.ts'
import type { FlowJob, ReviewToken } from './flow.ts'
import { engineView } from './view.ts'
import type { EngineView } from './view.ts'

/** Implemented by the scoped source API adapter once the E2 control bridge is
 * present. A digest alone never makes a review displayable or approvable. */
export interface SourceReader {
  review(job: FlowJob, signal?: AbortSignal): Promise<{ reviewDigest: string; stateVersion: number; text: string }>
  files(snapshotId: string, signal?: AbortSignal): Promise<EngineView['files']>
  file(snapshotId: string, path: string, signal?: AbortSignal): Promise<string>
  export(snapshotId: string, actionId: string): Promise<{ bytes: Uint8Array; filename: string }>
}
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'])
const message = (error: unknown) => error instanceof EngineApiError && error.status === 401
  ? 'Your control session is unavailable. Reconnect after signing in through the configured control service.'
  : error instanceof EngineApiError && [409, 412].includes(error.status)
    ? 'This project or review changed. Refresh it before trying a new action.'
    : 'The action could not finish. Your entered text is retained. Check the connection and try again.'

/** Main owns navigation and DOM events. This module owns only request state and
 * escaped page rendering; it creates no session or fallback local identity. */
export class EngineWorkspace {
  readonly flow: EngineFlow
  private key: string | null = null
  private epoch = 0
  private busy = false
  private error = ''
  private reviewText: string | null = null
  private reviewReady = false
  private displayedReview: ReviewToken | null = null
  private files: EngineView['files'] = []
  private selectedFile: string | null = null
  private fileText: string | null = null
  private watchAbort: AbortController | null = null
  private readAbort: AbortController | null = null
  private retry: ((epoch: number) => Promise<void>) | null = null
  private retryRoute: string | null = null
  private runningAction = false
  private exportAmbiguous: string | null = null
  private drafts = { name: '', brief: '', instruction: '' }
  constructor(private readonly changed: () => void, private readonly navigate: (path: string) => void,
    private readonly sources?: SourceReader, client = new EngineClient()) { this.flow = new EngineFlow(client) }
  private hasAmbiguity() { return !!this.exportAmbiguous || this.flow.state.pendingActions.some(a => a.status === 'ambiguous') }
  render() { const flow = this.flow.state; if (this.exportAmbiguous) flow.pendingActions.push({ actionId: this.exportAmbiguous, status: 'ambiguous' }); return engineView({ flow, busy: this.busy, error: this.error, reviewText: this.reviewText,
    reviewReady: this.currentReviewDisplayed(), files: this.files, selectedFile: this.selectedFile, fileText: this.fileText,
    exportAvailable: !!this.sources && !!this.flow.state.project?.headSnapshotId, drafts: this.drafts }) }
  enter(parts: string[]) {
    const key = parts.join('/')
    if (key === this.key) return
    this.leave(); this.key = key
    void this.refresh(parts)
  }
  leave() { this.epoch++; this.key = null; this.watchAbort?.abort(); this.readAbort?.abort(); this.watchAbort = null; this.readAbort = null; this.reviewReady = false; this.displayedReview = null }
  private currentReviewDisplayed() {
    const job = this.flow.state.job, shown = this.displayedReview
    return !!(this.reviewReady && shown && job && shown.jobId === job.id && shown.subjectDigest === job.reviewDigest && shown.stateVersion === job.stateVersion)
  }
  private clearSource() { this.reviewReady = false; this.displayedReview = null; this.reviewText = null; this.files = []; this.selectedFile = null; this.fileText = null }
  private sourceFailure(error: unknown) {
    if (error instanceof EngineApiError && error.status === 401) {
      this.flow.invalidateSession(); this.clearSource(); this.retry = null; this.retryRoute = null; this.exportAmbiguous = null
    }
    return message(error)
  }
  private async refresh(parts = this.key?.split('/').filter(Boolean) ?? []) {
    const epoch = ++this.epoch; this.watchAbort?.abort(); this.readAbort?.abort(); this.readAbort = new AbortController()
    const signal = this.readAbort.signal
    this.busy = true; this.error = ''; this.clearSource(); this.changed()
    try {
      if (parts.length > 2) throw new Error('INVALID_ENGINE_ROUTE')
      await this.flow.loadSession(signal); await this.flow.loadCapabilities(signal)
      if (epoch !== this.epoch) return
      if (parts[0]) await this.flow.reload(parts[0], parts[1], signal)
      else {
        this.flow.clearSelection()
        const workspace = this.flow.state.workspaceId ?? this.flow.state.session?.memberships[0]?.workspace_id
        if (workspace) await this.flow.loadProjects(workspace, undefined, signal)
      }
      if (epoch !== this.epoch) return
      await this.loadSource(epoch); this.startWatch(epoch)
    } catch (error) { if (epoch === this.epoch) this.error = message(error) }
    finally { if (epoch === this.epoch) { this.busy = false; this.changed() } }
  }
  private async loadSource(epoch: number) {
    if (epoch !== this.epoch) return
    this.clearSource()
    const job = this.flow.state.job
    if (!job || !this.sources) return
    if (job.reviewDigest) {
      try {
        const review = await this.sources.review(job, this.readAbort?.signal)
        if (epoch !== this.epoch || this.flow.state.job?.stateVersion !== job.stateVersion) return
        if (review.reviewDigest !== job.reviewDigest || review.stateVersion !== job.stateVersion) throw new Error('STALE_SOURCE_REVIEW')
        this.displayedReview = this.flow.reviewToken(); this.reviewText = review.text; this.reviewReady = true
      } catch (error) { if (epoch === this.epoch && this.flow.state.job?.stateVersion === job.stateVersion) { this.reviewReady = false; this.displayedReview = null; this.error = error instanceof EngineApiError && error.status === 401 ? this.sourceFailure(error) : 'The review content could not be loaded. Approval remains disabled.' } }
    }
    if (!this.flow.state.session) return
    if (job.candidateSnapshotId) {
      try { const files = await this.sources.files(job.candidateSnapshotId, this.readAbort?.signal); if (epoch === this.epoch && this.flow.state.job?.candidateSnapshotId === job.candidateSnapshotId) this.files = files }
      catch (error) { if (epoch === this.epoch) this.error = error instanceof EngineApiError && error.status === 401 ? this.sourceFailure(error) : 'The immutable source files could not be loaded.' }
    }
  }
  private startWatch(epoch: number) {
    if (!this.flow.state.job || terminal.has(this.flow.state.job.state)) return
    this.watchAbort?.abort(); const abort = new AbortController(); this.watchAbort = abort
    let seen = this.flow.state.job.stateVersion, updating = false
    const timer = setInterval(() => {
      const current = this.flow.state.job
      if (epoch !== this.epoch || updating || !current || current.stateVersion === seen) return
      seen = current.stateVersion; updating = true
      void this.loadSource(epoch).finally(() => { updating = false; if (epoch === this.epoch) this.changed() })
    }, 250)
    void this.flow.watch(abort.signal).catch(() => undefined).finally(() => {
      clearInterval(timer)
      if (epoch === this.epoch && !abort.signal.aborted) void this.loadSource(epoch).finally(() => this.changed())
    })
  }
  private async run(action: (epoch: number) => Promise<void>, retainRetry = false, exportActionId?: string) {
    if (this.busy || this.runningAction) return
    const epoch = this.epoch, route = this.key; this.runningAction = true; this.busy = true; this.error = ''; this.changed()
    try { await action(epoch); if (epoch === this.epoch) { this.retry = null; this.retryRoute = null; this.exportAmbiguous = null } }
    catch (error) {
      const uncertain = !(error instanceof EngineApiError && error.status >= 400 && error.status < 500 && !error.retryable)
      // Leaving aborts UI reads, not the server mutation. Retain its immutable
      // action and original route even when a late response is lost.
      if (retainRetry && uncertain) {
        this.exportAmbiguous = exportActionId ?? null
        if (this.hasAmbiguity()) { this.retry = action; this.retryRoute = route }
      }
      if (epoch === this.epoch) {
        this.error = this.sourceFailure(error)
        this.exportAmbiguous = exportActionId && uncertain ? exportActionId : null
        this.retry = retainRetry && this.hasAmbiguity() ? action : null
        this.retryRoute = this.retry ? route : null
      }
    } finally { this.runningAction = false; if (epoch === this.epoch) this.busy = false; if (this.key !== null) this.changed() }
  }
  async action(action: string, id?: string) {
    if (action === 'connect' || action === 'refresh') { if (!this.busy) await this.refresh(); return }
    if (action === 'retry') {
      if (this.retry && this.retryRoute !== this.key) { this.navigate(`#/engine${this.retryRoute ? '/' + this.retryRoute : ''}`); return }
      if (this.retry) await this.run(this.retry, true, this.exportAmbiguous ?? undefined)
      return
    }
    if (this.hasAmbiguity()) return
    if (action === 'project' && id) { this.navigate(`#/engine/${id}`); return }
    if (action === 'new-project') { this.navigate('#/engine'); return }
    if (action === 'next-projects' && id && this.flow.state.workspaceId) { await this.run(async () => { await this.flow.loadProjects(this.flow.state.workspaceId!, id) }); return }
    const actionId = crypto.randomUUID()
    if (action === 'file' && id && this.sources && this.flow.state.job?.candidateSnapshotId) {
      const snapshotId = this.flow.state.job.candidateSnapshotId, epoch = this.epoch
      await this.run(async () => { const text = await this.sources!.file(snapshotId, id, this.readAbort?.signal); if (epoch === this.epoch && this.flow.state.job?.candidateSnapshotId === snapshotId) { this.fileText = text; this.selectedFile = id } }); return
    }
    if (action === 'export' && this.sources && this.flow.state.project?.headSnapshotId) {
      const snapshotId = this.flow.state.project.headSnapshotId
      await this.run(async epoch => {
        const result = await this.sources!.export(snapshotId, actionId)
        if (epoch !== this.epoch) return
        const url = URL.createObjectURL(new Blob([result.bytes.slice().buffer], { type: 'application/zip' }))
        const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, true, actionId); return
    }
    if (action === 'cancel') { const epoch = this.epoch; await this.run(async () => { await this.flow.cancel(actionId) }, true); if (epoch === this.epoch) await this.loadSource(epoch); return }
    if (!['approve', 'reject', 'promote'].includes(action) || !this.currentReviewDisplayed() || !this.displayedReview) return
    const token = structuredClone(this.displayedReview)
    await this.run(async epoch => {
      const job = action === 'promote' ? await this.flow.promote(actionId, token) : await this.flow.approve(actionId, token, action === 'approve' ? 'approve' : 'reject')
      if (epoch !== this.epoch) return
      await this.loadSource(epoch); this.startWatch(epoch)
      if (epoch === this.epoch) this.navigate(`#/engine/${job.projectId}/${job.id}`)
    }, true)
  }
  async submit(kind: string, data: FormData) {
    if (this.busy || this.hasAmbiguity()) return
    const value = (key: string) => String(data.get(key) ?? '')
    const actionId = crypto.randomUUID()
    if (kind === 'workspace') { await this.run(async epoch => { this.flow.clearSelection(); await this.flow.loadProjects(value('workspaceId')); if (epoch === this.epoch) { this.clearSource(); this.navigate('#/engine') } }); return }
    if (kind === 'create' && this.flow.state.workspaceId) {
      this.drafts.name = value('name'); this.drafts.brief = value('brief'); const workspaceId = this.flow.state.workspaceId
      const input = { name: this.drafts.name, brief: this.drafts.brief, presetId: 'technical-mono' as const }
      await this.run(async epoch => { const project = await this.flow.createProject(actionId, workspaceId, input); if (epoch === this.epoch) this.navigate(`#/engine/${project.id}`) }, true)
    } else if (kind === 'generate') {
      this.drafts.instruction = value('instruction'); const instruction = this.drafts.instruction
      await this.run(async epoch => { const job = await this.flow.generate(actionId, instruction, 0); if (epoch === this.epoch) this.navigate(`#/engine/${job.projectId}/${job.id}`) }, true)
    } else if (kind === 'restore') {
      if (data.get('reset') !== 'on') return
      const snapshotId = value('snapshotId')
      await this.run(async epoch => { const job = await this.flow.restore(actionId, snapshotId, true, 0); if (epoch === this.epoch) this.navigate(`#/engine/${job.projectId}/${job.id}`) }, true)
    }
  }
}
