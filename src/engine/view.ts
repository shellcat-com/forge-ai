import { escapeHTML as e, topbar, footer } from '../components/ui.ts'
import type { FlowState } from './flow.ts'

export interface EngineView {
  flow: FlowState; busy: boolean; error: string; reviewText: string | null; reviewReady: boolean
  files: { path: string; sha256: string; bytes: number }[]; selectedFile: string | null; fileText: string | null
  exportAvailable: boolean
  drafts?: { name: string; brief: string; instruction: string }
}
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'])
const button = (action: string, label: string, disabled = false, id?: string) =>
  `<button data-engine-action="${e(action)}"${id ? ` data-id="${e(id)}"` : ''}${disabled ? ' disabled' : ''}>${e(label)}</button>`

/** Server/provider/file content is always text. This renderer never embeds an
 * app preview, trusts a local login, or turns fixture checks into live results. */
export function engineView(view: EngineView): string {
  const { flow, busy } = view, project = flow.project, job = flow.job
  const member = flow.session?.memberships.find(m => m.workspace_id === flow.workspaceId)
  const editable = !!member && member.role !== 'viewer'
  const active = !!job && !terminal.has(job.state)
  const review = !!job && ['AWAITING_PLAN_APPROVAL', 'AWAITING_EXECUTION_APPROVAL', 'AWAITING_PROMOTION'].includes(job.state)
  const ambiguous = flow.pendingActions.some(a => a.status === 'ambiguous')
  const pending = busy || ambiguous
  let content = ''
  if (!flow.session) {
    content = `<section class="engine-empty"><h2>${busy ? 'Connecting to the control service…' : 'A control session is required.'}</h2><p>The app-building engine is not enabled for private-alpha use yet. Your local briefs and samples are available in the workspace.</p>${button('connect', 'Check connection', busy)}<a class="button" href="#/projects">Open local workspace</a></section>`
  } else {
    content = `<aside class="engine-projects"><h2>Control workspace</h2><form data-engine-form="workspace"><label>Workspace<select name="workspaceId" ${busy ? 'disabled' : ''}>${flow.session.memberships.map(m => `<option value="${e(m.workspace_id)}" ${m.workspace_id === flow.workspaceId ? 'selected' : ''}>${e(m.workspace_id)} · ${e(m.role)}</option>`).join('')}</select></label><button ${busy ? 'disabled' : ''}>Open workspace</button></form><nav aria-label="Engine projects">${flow.projects.map(p => button('project', p.name, pending, p.id)).join('') || '<p>No projects in this control workspace.</p>'}</nav>${flow.nextProjectCursor ? button('next-projects', 'Next projects', busy, flow.nextProjectCursor) : ''}${button('new-project', 'New control project', pending || !editable)}</aside><section class="engine-detail">`
    if (!project) {
      content += `<h2>Start a source review</h2><p>This connection uses explicit fixtures. It makes no model calls and executes no app code.</p>${editable ? `<form data-engine-form="create"><label>Project name<input name="name" required maxlength="100" autocomplete="off" value="${e(view.drafts?.name ?? '')}" ${busy ? 'readonly' : ''}></label><label>Project brief<textarea name="brief" required minlength="20" maxlength="12000" rows="5" ${busy ? 'readonly' : ''}>${e(view.drafts?.brief ?? '')}</textarea></label><p>Next.js + PostgreSQL · Technical Mono candidate</p><button class="primary" ${pending ? 'disabled' : ''}>Save control project</button></form>` : '<p>Your role allows viewing projects.</p>'}`
    } else {
      content += `<header><p class="eyebrow">CONTROL PROJECT · REVISION ${project.revision}</p><h2>${e(project.name)}</h2><p>${e(project.brief)}</p>${button('refresh', 'Refresh project', busy)}</header>`
      if (!active && editable) content += `<form data-engine-form="generate"><label>Source change request<textarea name="instruction" required minlength="20" maxlength="12000" rows="4" ${busy ? 'readonly' : ''}>${e(view.drafts?.instruction ?? '')}</textarea></label><p>The fixture adapter prepares deterministic source. Model spending is zero.</p><button class="primary" ${pending || !flow.capabilities?.fixtureWorkflows ? 'disabled' : ''}>Prepare fixture source</button></form>`
      if (job) {
        content += `<section aria-labelledby="engine-job-heading"><h3 id="engine-job-heading">${e(job.state.replaceAll('_', ' ').toLowerCase())}</h3><p>Fixture workflow · state version ${job.stateVersion} · events ${e(flow.stream)}</p>${job.cleanupPending ? '<p role="status">Cleanup is pending. Resource reservations are retained.</p>' : ''}<div class="engine-actions">${button('refresh', 'Refresh job', busy)}${active && editable ? button('cancel', 'Cancel job', pending) : ''}${flow.stream === 'replay-required' ? '<p>Event history expired. Refresh the current state before reconnecting.</p>' : ''}</div>`
        if (review) {
          const label = job.state === 'AWAITING_PLAN_APPROVAL' ? 'Plan review' : job.state === 'AWAITING_EXECUTION_APPROVAL' ? 'Source and command review' : 'Source promotion review'
          content += `<h3>${label}</h3>${view.reviewText !== null ? `<pre class="engine-source" tabindex="0" aria-label="${label}">${e(view.reviewText)}</pre>` : '<p>The review content is unavailable. Approval stays disabled until it loads.</p>'}<details><summary>Review identity and limits</summary><pre class="engine-source">${e(JSON.stringify(job.review, null, 2))}</pre></details><div class="engine-actions">${button(job.state === 'AWAITING_PROMOTION' ? 'promote' : 'approve', job.state === 'AWAITING_PROMOTION' ? 'Promote fixture source' : 'Approve fixture review', pending || !editable || !view.reviewReady)}${job.state !== 'AWAITING_PROMOTION' ? button('reject', 'Reject review', pending || !editable || !view.reviewReady) : ''}</div>`
        }
        content += '</section>'
      }
      content += `<section><h3>Immutable source</h3><div class="engine-files"><nav aria-label="Source files">${view.files.map(f => button('file', `${f.path} · ${f.bytes} bytes`, busy, f.path)).join('') || '<p>No source files loaded.</p>'}</nav>${view.fileText !== null ? `<div><p>${e(view.selectedFile)}</p><pre class="engine-source" tabindex="0" aria-label="Source file content">${e(view.fileText)}</pre></div>` : ''}</div></section><section><h3>Source history</h3><p>Restoration creates a new reviewed source version. Temporary preview data resets.</p><form data-engine-form="restore"><label>Verified snapshot<select name="snapshotId">${flow.history.filter(s => s.status === 'verified').map(s => `<option value="${e(s.id)}">${e(s.id)} · ${e(s.created_at)}</option>`).join('')}</select></label><label class="engine-ack"><input type="checkbox" name="reset" required> I understand that preview data resets.</label><button ${pending || active || !editable || !flow.history.some(s => s.status === 'verified') ? 'disabled' : ''}>Prepare restoration</button></form><div class="engine-actions">${button('export', 'Download fixture source', pending || !editable || !view.exportAvailable)}<button disabled>Private preview unavailable</button></div><p>Private previews require the approved isolated runtime and preview service.</p></section>`
    }
    content += '</section>'
  }
  return `<div class="marketing">${topbar()}<main class="engine-workspace"><header class="engine-heading"><p class="eyebrow">ENGINE INTEGRATION</p><h1>Build from reviewed source.</h1><p class="notice">${flow.session ? 'Synthetic control workflow. No live generation, app execution or working preview.' : 'Private-alpha integrations are disabled while setup decisions remain open.'}</p></header>${view.error ? `<p class="form-error" role="alert">${e(view.error)}</p>` : ''}${ambiguous ? `<aside role="status"><p>The last action has an uncertain response. Retry that same action before starting another.</p>${button('retry', 'Retry the same action', busy)}</aside>` : ''}<div class="engine-layout" aria-busy="${busy}">${content}</div></main>${footer()}</div>`
}
