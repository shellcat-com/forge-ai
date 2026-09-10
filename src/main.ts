import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/press-start-2p/latin-400.css'
import './styles.css'
import { applyTheme, readTheme, validTheme } from './theme.ts'
import {
  loadWorkspace,
  saveWorkspace,
  newProject,
  emptyWorkspace,
  storageKey,
  type ProjectRecord,
} from './storage.ts'
import { createProjectDraft, type Template } from './project.ts'
import { getPreset, isPresetId } from './design/presets.ts'
import { escapeHTML, preview, topbar, footer, recovery } from './components/ui.ts'
import { landing } from './pages/landing.ts'
import {
  login,
  onboarding,
  projectList,
  projectForm,
  builder,
  settings,
  type BuilderState,
} from './pages/workspace.ts'
import { designs, docs, components } from './pages/designs.ts'
import { downloadFile, exportPreset } from './export.ts'
import type { EngineWorkspace } from './engine/workspace.ts'
let engineWorkspace: EngineWorkspace | undefined
let engineLoading = false
let engineLoadFailed = false
const engineUiEnabled = import.meta.env.VITE_FORGE_ENGINE_UI === 'true'
const app = document.querySelector<HTMLDivElement>('#app')!
const initial = (() => {
  try {
    return loadWorkspace(localStorage)
  } catch {
    return {
      data: emptyWorkspace(),
      error: 'Browser storage is unavailable. Changes will remain in this tab.',
    }
  }
})()
let data = initial.data
let storageError = initial.error
let readBlocked = !!initial.error
let undoProject: ProjectRecord | undefined
let previewTheme = 'light'
let currentRoute = ''
let toastTimer: ReturnType<typeof setTimeout> | undefined
const state: BuilderState = {
  tab: 'Plan',
  step: 0,
  started: false,
  previewTheme: 'light',
  file: 'app/page.tsx',
  provider: { configured: false, models: [] },
  generating: false,
  generated: '',
  error: '',
  selectedModel: '',
  providerVerified: false,
}
const plans = new Map<string, string>()
let generatingFor: string | null = null
let apiController: AbortController | undefined
applyTheme()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (readTheme() === 'system') applyTheme()
})
function route(): string[] {
  return (location.hash.slice(1) || '/').split('/').filter(Boolean)
}
function toast(message: string, undo = false): void {
  const host = document.querySelector<HTMLDivElement>('#toast')!
  host.innerHTML = `<span>${escapeHTML(message)}</span>${undo ? '<button data-action="undo">Undo</button>' : ''}<button data-action="dismiss-toast" aria-label="Dismiss notification">×</button>`
  host.hidden = false
  clearTimeout(toastTimer)
  if (!undo)
    toastTimer = setTimeout(() => {
      host.hidden = true
    }, 6000)
}
function persist(): void {
  if (readBlocked) {
    showStorageError()
    return
  }
  try {
    storageError = saveWorkspace(localStorage, data)
  } catch {
    storageError = 'Browser storage is unavailable. Changes stay in this tab.'
  }
  showStorageError()
}
function showStorageError(): void {
  const banner = document.querySelector<HTMLDivElement>('#storage-banner')
  if (banner) {
    banner.hidden = !storageError
    banner.innerHTML = storageError
      ? `${escapeHTML(storageError)} <a href="#/settings">Storage settings →</a>`
      : ''
  }
}
function render(): void {
  const [page, id] = route()
  const key = location.hash
  if (key !== currentRoute) {
    if (page !== 'engine') engineWorkspace?.leave()
    state.tab = 'Plan'
    state.error = ''
    state.generated = id ? plans.get(id) || '' : ''
    currentRoute = key
    window.scrollTo(0, 0)
  }
  state.previewTheme = previewTheme
  state.generating = !!id && generatingFor === id
  let html = ''
  let title = 'Forge AI'
  if (!page) {
    html = landing()
    title = 'Forge AI — Give your idea shape'
  } else if (page === 'login') {
    html = login()
    title = 'Explore Forge'
  } else if (page === 'onboarding') {
    html = onboarding()
    title = 'Welcome to Forge'
  } else if (page === 'projects') {
    html = projectList(data)
    title = 'Your projects — Forge'
  } else if (page === 'new') {
    html = projectForm(data.projects, isPresetId(id) ? id : 'technical-mono')
    title = 'New project — Forge'
  } else if (page === 'edit') {
    const p = data.projects.find((p) => p.id === id)
    html = p
      ? projectForm(data.projects, p.presetId, p)
      : recovery('That brief isn’t here.', 'Return to projects to find another idea.')
    title = 'Edit brief — Forge'
  } else if (page === 'project') {
    html = builder(
      data,
      state,
      data.projects.find((p) => p.id === id)
    )
    title = 'Project — Forge'
  } else if (page === 'sample') {
    html = builder(data, state, undefined, true)
    title = 'Sample walkthrough — Forge'
  } else if (page === 'engine') {
    title = 'Engine integration — Forge'
    if (!engineUiEnabled) html = `<div class="marketing">${topbar()}${recovery('The engine is not enabled.', 'Private-alpha setup is still pending. Your local briefs and sample walkthrough remain available.')}${footer()}</div>`
    else if (engineWorkspace) {
      html = engineWorkspace.render()
      queueMicrotask(() => { if (route()[0] === 'engine') engineWorkspace?.enter(route().slice(1)) })
    } else {
      html = `<div class="marketing">${topbar()}${recovery(engineLoadFailed ? 'The engine workspace could not load.' : 'Opening the engine workspace…', 'Your local briefs remain available.')}${footer()}</div>`
      if (!engineLoading && !engineLoadFailed) {
        engineLoading = true
        void Promise.all([import('./engine/workspace.ts'), import('./engine/client.ts'), import('./engine/source-client.ts')]).then(([{ EngineWorkspace }, { EngineClient }, { EngineSourceReader }]) => {
          const client = new EngineClient()
          engineWorkspace = new EngineWorkspace(() => { if (route()[0] === 'engine') render() }, path => { location.hash = path }, new EngineSourceReader(client), client)
          if (route()[0] === 'engine') render()
        }).catch(() => { engineLoadFailed = true; if (route()[0] === 'engine') render() }).finally(() => { engineLoading = false })
      }
    }
  } else if (page === 'settings') {
    html = settings(data)
    title = 'Settings — Forge'
  } else if (page === 'presets') {
    html = designs(id, previewTheme)
    title = 'Design systems — Forge'
  } else if (page === 'docs') {
    html = docs()
    title = 'Field guide — Forge'
  } else if (page === 'components') {
    html = components()
    title = 'Components — Forge'
  } else {
    html = `<div class="marketing">${topbar()}${recovery('A page yet to be written.', 'This address does not lead to a Forge page. Your projects are still where you left them.')}${footer()}</div>`
    title = 'Page not found — Forge'
  }
  app.innerHTML = html
  document.title = title
  showStorageError()
}
window.addEventListener('storage', (event) => {
  if (event.key === storageKey && !storageError) {
    const result = loadWorkspace(localStorage)
    if (result.error) {
      storageError = result.error
      readBlocked = true
      showStorageError()
    } else {
      data = result.data
      if (route()[0] === 'projects') render()
    }
  }
})
window.addEventListener('hashchange', () => {
  render()
  const h = app.querySelector<HTMLElement>('h1')
  h?.setAttribute('tabindex', '-1')
  h?.focus({ preventScroll: true })
})
document.addEventListener('click', async (event) => {
  const engineAction = (event.target as HTMLElement).closest<HTMLElement>('[data-engine-action]')
  if (route()[0] === 'engine' && engineAction && engineWorkspace) {
    event.preventDefault()
    try { await engineWorkspace.action(engineAction.dataset.engineAction!, engineAction.dataset.id) }
    catch { toast('This engine action is unavailable. Refresh the current review.') }
    return
  }
  if (
    (event.target as HTMLElement).closest('a[href]') &&
    document.querySelector('.app-sidebar.open')
  )
    setDrawer(false)
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action],[data-theme-choice]'
  )
  if (!target) return
  if (target.dataset.themeChoice && validTheme(target.dataset.themeChoice)) {
    const choice = target.dataset.themeChoice
    const saved = applyTheme(choice)
    document
      .querySelectorAll<HTMLElement>('[data-theme-choice]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)))
    if (!saved) toast('Theme changed for this visit. Browser storage is unavailable.')
    return
  }
  const action = target.dataset.action
  const [page, id] = route()
  if (action === 'skip-content') {
    event.preventDefault()
    app.focus()
    return
  }
  if (action === 'cancel-plan') {
    apiController?.abort()
    return
  }
  if (action === 'menu') {
    const nav = document.querySelector<HTMLElement>('#mobile-nav')!
    nav.hidden = !nav.hidden
    target.setAttribute('aria-expanded', String(!nav.hidden))
  }
  if (action === 'drawer')
    setDrawer(!document.querySelector('.app-sidebar')?.classList.contains('open'))
  if (action === 'onboard-new' || action === 'onboard-sample') {
    data.onboarded = true
    persist()
    location.hash = action === 'onboard-new' ? '#/new' : '#/sample'
  }
  if (action === 'delete') {
    const p = data.projects.find((p) => p.id === target.dataset.id)
    if (p) {
      undoProject = p
      data.projects = data.projects.filter((x) => x.id !== p.id)
      persist()
      render()
      toast('Project removed from this workspace.', true)
    }
  }
  if (action === 'undo' && undoProject) {
    data.projects.unshift(undoProject)
    undoProject = undefined
    persist()
    render()
    toast('Project restored.')
  }
  if (action === 'dismiss-toast') document.querySelector<HTMLElement>('#toast')!.hidden = true
  if (action === 'duplicate') {
    const p = data.projects.find((p) => p.id === target.dataset.id)
    if (p) {
      data.projects.unshift(newProject({ ...p, name: `${p.name.slice(0, 90)} copy` }, p.presetId))
      persist()
      render()
      toast('Created a copy.')
    }
  }
  if (action === 'rename') {
    const p = data.projects.find((p) => p.id === target.dataset.id)
    if (p)
      openDialog(
        'Rename project',
        `<form id="rename-form" data-id="${p.id}"><label>Project name<input name="name" maxlength="100" required value="${escapeHTML(p.name)}"></label><button class="primary">Save name</button></form>`
      )
  }
  if (action === 'preview-theme') {
    previewTheme = previewTheme === 'light' ? 'dark' : 'light'
    if (page === 'new' || page === 'edit') {
      const checked = document.querySelector<HTMLInputElement>('input[name="preset"]:checked')
      document.querySelector('#live-preview')!.innerHTML = preview(
        checked?.value || 'technical-mono',
        previewTheme
      )
    } else render()
  }
  if (action === 'tab') {
    state.tab = target.dataset.tab!
    render()
    document.querySelector<HTMLElement>(`#tab-${state.tab}`)?.focus()
  }
  if (action === 'file') {
    state.file = target.dataset.file!
    render()
  }
  if (action === 'panel') {
    const panel = target.dataset.panel!
    document.querySelector<HTMLElement>('.builder-grid')!.dataset.panel = panel
    document
      .querySelectorAll<HTMLElement>('[data-panel][data-action]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.panel === panel)))
  }
  if (action === 'demo-next') {
    state.started = true
    state.step = target.textContent?.includes('Start') ? 0 : (state.step + 1) % 4
    render()
  }
  if (action === 'download-preset') {
    target.setAttribute('disabled', '')
    toast('Preparing your design package…')
    try {
      await exportPreset(target.dataset.preset!)
      toast('Design package downloaded.')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Download failed. Please retry.')
    } finally {
      target.removeAttribute('disabled')
    }
  }
  if (action === 'export-projects')
    downloadFile('forge-project-briefs.json', JSON.stringify(data, null, 2))
  if (action === 'raw-backup') {
    try {
      downloadFile(
        'forge-raw-backup.txt',
        localStorage.getItem(storageKey) || 'No saved data',
        'text/plain'
      )
    } catch {
      toast('This browser does not allow access to local storage.')
    }
  }
  if (action === 'retry-storage') {
    try {
      const result = loadWorkspace(localStorage)
      storageError = result.error
      if (!result.error) {
        data = result.data
        readBlocked = false
        render()
        toast('Saved workspace reloaded.')
      } else showStorageError()
    } catch {
      toast('Storage is still unavailable.')
    }
  }
  if (action === 'reset')
    openDialog(
      'Reset this workspace?',
      `<p>This removes project briefs saved in this browser. Download your briefs first if you need a backup.</p><button class="danger" data-action="confirm-reset">Reset local data</button>`
    )
  if (action === 'confirm-reset') {
    data = emptyWorkspace()
    undoProject = undefined
    readBlocked = false
    persist()
    closeDialog()
    render()
    toast(
      storageError
        ? 'Workspace cleared in this tab; saved data could not be changed.'
        : 'Local workspace reset.'
    )
  }
  if (action === 'close-dialog') closeDialog()
  if (action === 'specimen-feedback') toast('Action completed. This is a component example.')
  if (action === 'generate-plan' && id) {
    const p = data.projects.find((p) => p.id === id)
    const model = document.querySelector<HTMLSelectElement>('#provider-model')?.value
    if (!p || !model || generatingFor) return
    generatingFor = id
    state.selectedModel = model
    state.error = ''
    apiController = new AbortController()
    const timeout = setTimeout(() => apiController?.abort(), 125000)
    render()
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.name, prompt: p.prompt, template: p.template, model }),
        signal: apiController.signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The plan could not be prepared.')
      state.providerVerified = true
      plans.set(id, result.text)
      if (route()[1] === id) {
        state.generated = result.text
        state.error = result.truncated ? 'The provider returned a partial plan.' : ''
      }
      toast('Text plan prepared. No files were created.')
    } catch (error) {
      if (route()[1] === id)
        state.error =
          error instanceof Error && error.name === 'AbortError'
            ? 'Planning was cancelled or timed out. Your brief is safe.'
            : error instanceof Error
              ? error.message
              : 'Planning failed.'
    } finally {
      clearTimeout(timeout)
      generatingFor = null
      render()
    }
  }
})
document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement
  if (input.id === 'provider-model') state.selectedModel = input.value
  if (input.name === 'preset') {
    document.querySelector('#live-preview')!.innerHTML = preview(input.value, previewTheme)
    document.querySelector('#preset-description')!.textContent = getPreset(input.value).guidance
  }
})
document.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement
  if (input.id === 'project-search') {
    let visible = 0
    document.querySelectorAll<HTMLElement>('.project-row').forEach((row) => {
      row.hidden = !row.dataset.projectName!.includes(input.value.toLowerCase())
      if (!row.hidden) visible++
    })
    document.querySelector<HTMLElement>('#search-empty')!.hidden =
      visible > 0 || data.projects.length === 0
  }
})
document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement
  if (route()[0] === 'engine' && form.dataset.engineForm && engineWorkspace) {
    event.preventDefault()
    void engineWorkspace.submit(form.dataset.engineForm, new FormData(form)).catch(() => toast('The engine action could not finish. Your local briefs are unchanged.'))
    return
  }
  if (form.id !== 'project-form' && form.id !== 'rename-form') return
  event.preventDefault()
  const values = new FormData(form)
  const name = String(values.get('name') || '').trim()
  if (!name) {
    form.querySelector<HTMLInputElement>('[name=name]')?.setCustomValidity('Enter a project name.')
    form.reportValidity()
    return
  }
  if (form.id === 'rename-form') {
    const p = data.projects.find((p) => p.id === form.dataset.id)
    if (p) {
      p.name = name
      p.updatedAt = new Date().toISOString()
      persist()
      closeDialog()
      render()
      toast('Project renamed.')
    }
    return
  }
  const prompt = String(values.get('prompt') || '').trim()
  if (prompt.length < 20) {
    document.querySelector('#form-error')!.textContent =
      'Write at least 20 characters to give the brief a useful starting point.'
    return
  }
  const preset = String(values.get('preset'))
  if (!isPresetId(preset)) return
  const draft = createProjectDraft({ name, prompt, template: values.get('template') as Template })
  let p = data.projects.find((p) => p.id === form.dataset.id)
  if (p) {
    Object.assign(p, draft, { presetId: preset, updatedAt: new Date().toISOString() })
  } else {
    p = newProject(draft, preset)
    data.projects.unshift(p)
  }
  data.onboarded = true
  persist()
  location.hash = `#/project/${p.id}`
  toast(
    storageError
      ? 'Project ready in this tab; browser save needs attention.'
      : 'Project brief saved in this browser.'
  )
})
document.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement
  if (input.name === 'name') input.setCustomValidity('')
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.querySelector('.app-sidebar.open')) setDrawer(false)
    const nav = document.querySelector<HTMLElement>('#mobile-nav')
    if (nav) nav.hidden = true
    document.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false')
  }
  const target = event.target as HTMLElement
  if (
    target.getAttribute('role') === 'tab' &&
    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  ) {
    event.preventDefault()
    const tabs = ['Plan', 'Preview', 'Files', 'Checks']
    let i = tabs.indexOf(state.tab)
    i =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 3
          : (i + (event.key === 'ArrowRight' ? 1 : 3)) % 4
    state.tab = tabs[i]
    render()
    document.querySelector<HTMLElement>(`#tab-${state.tab}`)?.focus()
  }
})
function setDrawer(open: boolean): void {
  const sidebar = document.querySelector<HTMLElement>('.app-sidebar')
  const main = document.querySelector<HTMLElement>('.app-main')
  if (!sidebar || !main) return
  sidebar.classList.toggle('open', open)
  main.inert = open
  if (open) {
    sidebar.setAttribute('role', 'dialog')
    sidebar.setAttribute('aria-modal', 'true')
    sidebar.setAttribute('aria-label', 'Workspace navigation')
  } else {
    sidebar.removeAttribute('role')
    sidebar.removeAttribute('aria-modal')
    sidebar.removeAttribute('aria-label')
  }
  document.querySelector('.drawer-toggle')?.setAttribute('aria-expanded', String(open))
  document.querySelector<HTMLElement>(open ? '.drawer-close' : '.drawer-toggle')?.focus()
}
document.addEventListener('keydown', (event) => {
  const sidebar = document.querySelector<HTMLElement>('.app-sidebar.open')
  if (event.key !== 'Tab' || !sidebar) return
  const controls = Array.from(
    sidebar.querySelectorAll<HTMLElement>('a,button,input,[tabindex="0"]')
  ).filter((el) => el.getClientRects().length > 0)
  const first = controls[0],
    last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
})
matchMedia('(min-width: 1001px)').addEventListener('change', (event) => {
  if (event.matches && document.querySelector('.app-sidebar.open')) setDrawer(false)
})
let dialogReturn: HTMLElement | null = null
function openDialog(title: string, body: string): void {
  dialogReturn = document.activeElement as HTMLElement
  const dialog = document.querySelector<HTMLDialogElement>('#dialog')!
  dialog.innerHTML = `<div class="dialog-heading"><h2>${title}</h2><button data-action="close-dialog" aria-label="Close dialog">×</button></div>${body}`
  dialog.showModal()
  dialog.querySelector<HTMLInputElement>('input')?.select()
}
function closeDialog(): void {
  document.querySelector<HTMLDialogElement>('#dialog')!.close()
  dialogReturn?.focus()
}
render()
fetch('/api/provider', { signal: AbortSignal.timeout(5000) })
  .then((r) => (r.ok ? r.json() : null))
  .then((value) => {
    if (value && typeof value.configured === 'boolean' && Array.isArray(value.models)) {
      state.provider = value
      state.selectedModel = value.models[0]?.id || ''
      if (route()[0] === 'project') render()
    }
  })
  .catch(() => {
    /* Static deployments intentionally have no API. */
  })
