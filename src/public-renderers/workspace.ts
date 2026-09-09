import { brand, themes, escapeHTML as e, imageArt, preview, recovery } from '../components/ui.ts'
import { presets, getPreset } from '../design/presets.ts'
import { templates } from '../project.ts'
import type { ProjectRecord, WorkspaceData } from '../storage.ts'
import { demoSteps, sampleBrief, sampleFiles } from '../demo.ts'
export function appShell(
  content: string,
  active = 'projects',
  projects: ProjectRecord[] = []
): string {
  return `<div class="workspace-shell"><aside class="app-sidebar" id="app-navigation">${brand()}<button class="drawer-close" data-action="drawer" aria-label="Close navigation">×</button><nav aria-label="Workspace"><a class="${active === 'projects' ? 'active' : ''}" href="#/projects">▦ <span>Projects</span><small>${projects.length}</small></a><a class="${active === 'new' ? 'active' : ''}" href="#/new">＋ <span>New project</span></a><a href="#/presets">◇ <span>Design systems</span></a><a class="${active === 'sample' ? 'active' : ''}" href="#/sample">▷ <span>Walkthrough</span></a></nav><div class="sidebar-recents"><span class="eyebrow">RECENT PROJECTS</span>${
    projects
      .slice(0, 4)
      .map((p) => `<a href="#/project/${p.id}">${e(p.name)}</a>`)
      .join('') || '<p>Your next idea goes here.</p>'
  }</div><div class="sidebar-bottom"><p><span class="status-dot"></span> Local demo workspace</p><small>Briefs stay in this browser.</small><a class="${active === 'settings' ? 'active' : ''}" href="#/settings">Settings ↗</a>${themes()}</div></aside><div class="app-main"><header class="app-topbar"><button class="drawer-toggle" data-action="drawer" aria-label="Open workspace navigation" aria-controls="app-navigation" aria-expanded="false">☰</button><span>Workspace <span class="muted">/ ${active === 'new' ? 'New project' : active === 'sample' ? 'Sample walkthrough' : active === 'settings' ? 'Settings' : 'Projects'}</span></span><a href="#/">Back to Forge ↗</a></header>${content}</div></div>`
}
export function login(): string {
  return `<main class="login-page"><section class="login-side">${brand()}<div class="login-form"><p class="eyebrow">A NEW IDEA STARTS HERE</p><h1>Your next chapter<br>is waiting.</h1><p>One workspace to give your ideas shape.</p><div class="login-options"><button disabled>G &nbsp; Continue with Google <small>Unavailable</small></button><button disabled>◇ &nbsp; Continue with GitHub <small>Unavailable</small></button><div class="or"><span></span>or<span></span></div><label>Email address<input type="email" placeholder="you@example.com" disabled></label><button disabled>Continue with email <small>Unavailable</small></button></div><p class="notice">Authentication is a preview. No credentials are collected.</p><a class="button primary full" href="#/onboarding">Explore demo workspace →</a><a class="text-link login-back" href="#/">← Back to Forge</a></div><div class="login-footer"><span>Local demo · No account needed</span>${themes()}</div></section><section class="login-art" aria-label="Original atmospheric landscape">${imageArt('login', '', true)}<div class="login-art-copy"><span>SPACE TO THINK. ROOM TO BUILD.</span><h2>Every good thing<br>begins somewhere.</h2><p>Make something that feels like you.</p></div><span class="art-credit">FORGE STUDIES / 001</span></section></main>`
}
export function onboarding(): string {
  return `<main class="onboarding">${brand()}<section><p class="eyebrow">01 / WELCOME TO YOUR WORKSPACE</p><h1>A little space for<br>your next big idea.</h1><p>Forge is yours to explore. Start a brief, find its visual direction, and see how a considered workflow comes together.</p><div class="onboard-facts"><div><span>01</span><strong>Start with a brief</strong><p>Write down the outcome, users and constraints.</p></div><div><span>02</span><strong>Find your direction</strong><p>Choose one of five reusable design systems.</p></div><div><span>03</span><strong>Keep it close</strong><p>Briefs save only in this browser. Export a backup in Settings.</p></div></div><p class="notice">This is a local UI demo. Authentication and application generation are not available. The sample walkthrough uses fixed examples.</p><div class="hero-actions"><button class="primary" data-action="onboard-new">Create my first project →</button><button data-action="onboard-sample">Explore a sample</button></div></section>${themes()}</main>`
}
export function projectList(data: WorkspaceData): string {
  return appShell(
    `<main class="page-content"><div class="page-title"><div><p class="eyebrow">A PLACE FOR YOUR IDEAS</p><h1>Your projects<span class="muted">.</span></h1><p>Pick up where you left off, or start something new.</p></div><a class="button primary" href="#/new">＋ New project</a></div><div class="list-toolbar"><label class="search-label"><span class="sr-only">Search projects</span><input type="search" id="project-search" placeholder="Search your projects…"></label><span>${data.projects.length} local ${data.projects.length === 1 ? 'project' : 'projects'}</span></div><div class="project-list">${data.projects.map((p) => `<article class="project-row" data-project-name="${e(p.name.toLowerCase())}"><a class="project-thumb" href="#/project/${p.id}" tabindex="-1" aria-hidden="true">${preview(p.presetId, 'light', undefined, true)}</a><a class="project-info" href="#/project/${p.id}"><h2>${e(p.name)}</h2><p>${getPreset(p.presetId).name} <span>·</span> ${e(p.template)}</p><small>Updated ${new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Brief saved locally</small></a><div class="row-actions"><button data-action="rename" data-id="${p.id}" aria-label="Rename ${e(p.name)}">Rename</button><button data-action="duplicate" data-id="${p.id}" aria-label="Duplicate ${e(p.name)}">Duplicate</button><button data-action="delete" data-id="${p.id}" aria-label="Delete ${e(p.name)}">×</button></div></article>`).join('')}</div><div class="empty-state" id="project-empty" ${data.projects.length ? 'hidden' : ''}><span class="empty-symbol">[ + ]</span><h2>Your next idea belongs here.</h2><p>Start with a name and a few sentences.<br>You can figure out the rest as you go.</p><a class="button primary" href="#/new">Create a project →</a><a class="text-link" href="#/sample">Or explore the sample walkthrough</a></div><p class="empty-state" id="search-empty" hidden>No projects match that search. Try another name.</p></main>`,
    'projects',
    data.projects
  )
}
export function projectForm(
  projects: ProjectRecord[],
  selected = 'technical-mono',
  record?: ProjectRecord
): string {
  return appShell(
    `<main class="page-content"><div class="page-title"><div><p class="eyebrow">${record ? 'REFINE YOUR IDEA' : 'A GOOD PLACE TO BEGIN'}</p><h1>${record ? 'Edit your brief.' : 'What are you thinking?'}</h1><p>A few clear sentences can go a long way.</p></div></div><form id="project-form" data-id="${record?.id || ''}" class="project-form"><div class="form-fields"><label>Project name<input name="name" required maxlength="100" placeholder="e.g. A customer portal" value="${e(record?.name || '')}"></label><label>What would you like to build?<textarea name="prompt" required minlength="20" maxlength="12000" rows="7" placeholder="Describe the people it’s for, the problem it solves, and what matters most…">${e(record?.prompt || '')}</textarea><span class="field-help">At least 20 characters. Your brief stays in this browser.</span></label><label>Starting stack<select name="template">${templates.map((t) => `<option ${record?.template === t ? 'selected' : ''}>${e(t)}</option>`).join('')}</select><span class="field-help">Records your intent; no stack is generated.</span></label><fieldset class="preset-options"><legend>Choose a design direction</legend>${presets.map((p) => `<label><input type="radio" name="preset" value="${p.id}" ${(record?.presetId || selected) === p.id ? 'checked' : ''}><span><strong>${p.name}</strong><small>${p.description}</small></span><span class="radio-mark"></span></label>`).join('')}</fieldset><p id="form-error" class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">${record ? 'Save changes' : 'Create project'} →</button><a href="#/projects">Cancel</a></div></div><aside class="form-preview"><div class="preview-toolbar"><span>DESIGN PREVIEW</span><button type="button" data-action="preview-theme">Switch preview theme ◐</button></div><div id="live-preview">${preview(record?.presetId || selected)}</div><p class="microcopy">A design study, not generated application output.</p><p class="preview-description" id="preset-description">${getPreset(record?.presetId || selected).guidance}</p></aside></form></main>`,
    'new',
    projects
  )
}
export interface BuilderState {
  tab: string
  step: number
  started: boolean
  previewTheme: string
  file: string
  provider: { configured: boolean; models: { id: string; name: string }[] }
  generating: boolean
  generated: string
  error: string
  selectedModel: string
  providerVerified: boolean
}
export function builder(
  data: WorkspaceData,
  state: BuilderState,
  project?: ProjectRecord,
  sample = false
): string {
  if (!project && !sample)
    return appShell(
      recovery('That project isn’t here.', 'It may have been removed or saved in another browser.'),
      'projects',
      data.projects
    )
  const name = sample ? 'Customer portal' : project!.name
  const preset = sample ? 'editorial-product' : project!.presetId
  const plan = sample
    ? `<div class="sample-progress"><p class="eyebrow">SAMPLE WALKTHROUGH / ${state.started ? state.step + 1 : 0} OF 4</p><h2>${state.started ? demoSteps[state.step] : 'See how it comes together.'}</h2><p>Follow a fixed example from brief to review. No AI calls or code execution.</p><ol class="steps">${demoSteps.map((s, i) => `<li class="${state.started && i <= state.step ? 'done' : ''}"><span>${state.started && i <= state.step ? '✓' : i + 1}</span>${s}</li>`).join('')}</ol>${state.started ? `<div class="plan-details"><h3>${['Understand the people', 'Plan the experience', 'Assemble a sample', 'Review the direction'][state.step]}</h3><p>${['A shared inbox for a small support team. Prioritize clarity, ownership and searchable history.', 'Three views: inbox, conversation, and team settings. Use the Editorial Product system with paired themes.', 'The Preview and Files tabs show fixed sample fixtures. They were not generated from your brief.', 'Inspect the sample checklist. These are illustrative review items, not executed test results.'][state.step]}</p></div>` : ''}<button class="primary" data-action="demo-next">${!state.started ? 'Start sample walkthrough →' : state.step < 3 ? 'Next step →' : 'Restart walkthrough ↺'}</button></div>`
    : `<div class="sample-progress"><p class="eyebrow">PROJECT BRIEF</p><h2>A clear starting point.</h2><p>Your brief and design direction are saved locally. Explore the preview or use the sample to see the planned workflow.</p><div class="plan-details"><h3>Selected direction</h3><p>${getPreset(preset).name} · ${e(project!.template)}</p><p>${getPreset(preset).guidance}</p></div>${state.generated ? `<h3>AI-generated plan</h3><pre class="generated-plan">${e(state.generated)}</pre><p class="microcopy">Text only. No files created or checks executed.</p>` : ''}<div class="provider-panel"><h3>AI planning</h3><p>${state.provider.configured ? (state.providerVerified ? 'NVIDIA planning verified this session. Your brief is sent to the selected model.' : 'NVIDIA key loaded; not yet verified in this session. Generate plan sends your brief to the selected model.') : 'No planning provider connected. Start and configure the local API to enable text planning.'}</p><label>Model<select id="provider-model" ${!state.provider.configured || state.generating ? 'disabled' : ''}>${state.provider.models.map((m) => `<option value="${e(m.id)}" ${state.selectedModel === m.id ? 'selected' : ''}>${e(m.name)}</option>`).join('') || '<option>Not configured</option>'}</select></label><button class="primary" data-action="generate-plan" ${!state.provider.configured || state.generating ? 'disabled' : ''}>${state.generating ? 'Preparing your plan…' : 'Generate plan →'}</button>${state.generating ? '<button data-action="cancel-plan">Cancel request</button>' : ''}<p role="status">${e(state.error)}</p></div><a class="text-link" href="#/sample">Explore the sample walkthrough →</a></div>`
  const tabs = ['Plan', 'Preview', 'Files', 'Checks']
  let body = plan
  if (state.tab === 'Preview')
    body = `<div class="builder-preview-wrap"><div class="preview-toolbar"><span>${sample ? 'SAMPLE APPLICATION' : 'DESIGN STUDY'}</span><button data-action="preview-theme">Switch preview theme ◐</button></div>${preview(preset, state.previewTheme)}<p class="microcopy">${sample ? 'Fixed sample preview.' : 'Preset composition only; your brief has not been built.'}</p></div>`
  if (state.tab === 'Files')
    body = sample
      ? `<div class="files-panel"><nav aria-label="Sample files">${Object.keys(sampleFiles)
          .map(
            (f) =>
              `<button data-action="file" data-file="${f}" aria-pressed="${state.file === f}">▤ ${f}</button>`
          )
          .join(
            ''
          )}</nav><div><p class="eyebrow">FIXED SAMPLE FILE / ${e(state.file)}</p><pre><code>${e(sampleFiles[state.file as keyof typeof sampleFiles])}</code></pre></div></div>`
      : `<div class="empty-state"><span class="empty-symbol">[ ▤ ]</span><h2>No files yet.</h2><p>This project contains a brief and design direction.<br>File generation is not available.</p><a class="text-link" href="#/sample">Inspect sample files →</a></div>`
  if (state.tab === 'Checks')
    body = `<div class="sample-progress"><p class="eyebrow">${sample ? 'SAMPLE CHECKLIST' : 'VERIFICATION'}</p><h2>${sample ? 'A considered review.' : 'No checks have run.'}</h2><p>${sample ? 'These items demonstrate a future review flow. They are not real test results.' : 'Checks require a generated project and execution environment.'}</p>${sample ? ['Typography and spacing', 'Both appearance modes', 'Keyboard navigation', 'Responsive composition'].map((t) => `<div class="check-row"><span>○ ${t}</span><small>Illustrative only</small></div>`).join('') : ''}</div>`
  return appShell(
    `<main class="builder"><div class="builder-heading"><div><p class="eyebrow">${sample ? 'DETERMINISTIC SAMPLE' : 'LOCAL PROJECT'}</p><h1>${e(name)}</h1></div><div>${!sample ? `<a class="button" href="#/edit/${project!.id}">Edit brief</a>` : ''}<a class="button" href="#/presets/${preset}">Design system ↗</a></div></div><div class="builder-mobile-tabs" role="group" aria-label="Workspace panel"><button data-action="panel" data-panel="brief" aria-pressed="false">Brief</button><button data-action="panel" data-panel="review" aria-pressed="true">Review</button></div><div class="builder-grid" data-panel="review"><aside class="brief-panel"><p class="eyebrow">THE STARTING POINT</p><h2>Project brief</h2><p class="brief-text">${e(sample ? sampleBrief : project!.prompt)}</p><div class="brief-meta"><span>DESIGN SYSTEM</span><strong>${getPreset(preset).name}</strong><span>STARTING STACK</span><strong>${e(sample ? templates[0] : project!.template)}</strong></div><div class="brief-bottom"><span class="status-dot"></span> ${sample ? 'Sample fixture' : 'Saved in this browser'}<p>${sample ? 'Your projects are not modified.' : 'No application files generated.'}</p></div></aside><section class="review-panel"><div class="builder-tabs" role="tablist" aria-label="Project views">${tabs.map((t) => `<button role="tab" id="tab-${t}" aria-controls="builder-tabpanel" aria-selected="${state.tab === t}" tabindex="${state.tab === t ? 0 : -1}" data-action="tab" data-tab="${t}">${t}</button>`).join('')}</div><div role="tabpanel" id="builder-tabpanel" aria-labelledby="tab-${state.tab}" tabindex="0">${body}</div></section></div></main>`,
    sample ? 'sample' : 'projects',
    data.projects
  )
}
export function settings(data: WorkspaceData): string {
  return appShell(
    `<main class="page-content settings"><p class="eyebrow">MAKE YOURSELF AT HOME</p><h1>Settings.</h1><section><div><h2>Appearance</h2><p>Follow your system, or choose your own.</p></div>${themes()}</section><section><div><h2>Your local workspace</h2><p>${data.projects.length} project briefs saved in this browser. Nothing is synced to an account.</p></div><button data-action="export-projects">Download briefs ↓</button></section><section><div><h2>Storage recovery</h2><p>Retry reading saved data, or download the raw saved record before resetting it.</p></div><div class="settings-actions"><button data-action="retry-storage">Retry storage</button><button data-action="raw-backup">Download raw backup</button></div></section><section><div><h2>Reset local workspace</h2><p>Clear projects and onboarding on this device. Download a backup first.</p></div><button class="danger" data-action="reset">Reset local data</button></section><section><div><h2>About this preview</h2><p>Authentication, application builds and deployment are not implemented. An optional local provider may prepare text plans; sample walkthroughs remain fixed fixtures.</p></div><a href="#/docs">Read documentation ↗</a></section></main>`,
    'settings',
    data.projects
  )
}
