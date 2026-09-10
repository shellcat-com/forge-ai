import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import '../styles.css'
import './styles.css'
import { brand, themes, escapeHTML as e, imageArt, preview } from '../components/ui.ts'
import { presets } from '../design/presets.ts'
import { applyTheme, validTheme, readTheme } from '../theme.ts'
import { loadWorkspace } from '../storage.ts'
import { downloadFile } from '../export.ts'
import { connect, ApiError } from './client.ts'
import type { Connection, Me, Project } from './client.ts'

const root = document.querySelector<HTMLDivElement>('#app')!
let connection: Connection
let me: Me | null = null
let status: 'loading' | 'authenticated' | 'anonymous' | 'unavailable' = 'loading'
let message = ''
let busy = false
let projects: Project[] = []
let project: Project | null = null
let epoch = 0
let nextOffset: number | null = null
let search = ''
let deleted = false
let accounts: { providerId: string; accountId: string }[] = []
let onboardingCopy = ''
let intendedRoute = '#/projects'
let routeUnavailable = false
let tourStep = 0
let planning: { configured: boolean; models: { id: string; name: string }[] } = {
  configured: false,
  models: [],
}
let planText = ''
const plannerForm = () =>
  `<section><h2>Optional text plan</h2><p>Send this saved brief to NVIDIA for a text plan. This does not generate application files, execute code, or deploy a project.</p>${planning.configured ? `<form data-form="plan"><label>Model<select name="model">${planning.models.map((m) => `<option value="${e(m.id)}">${e(m.name)}</option>`).join('')}</select></label><button>Send brief and prepare text plan</button></form>` : '<p>Hosted planning is not configured.</p>'}${planText ? `<h3>Provider response</h3><p>This response is not saved. Copy or download it before leaving.</p><button data-cloud="download-plan">Download text plan</button><pre class="cloud-pre">${e(planText)}</pre>` : ''}</section>`
function showTour() {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog')!
  const steps = [
    [
      'Your saved projects',
      'Projects lists your account’s briefs. Search by name, move a brief to deleted projects, or restore it later.',
    ],
    [
      'Your brief and design',
      'Open a project to edit its requirements, preview its design direction, or duplicate it. Saving checks the revision so another device cannot silently overwrite your changes.',
    ],
    [
      'Start your next idea',
      'New project opens the guided idea, direction, and review flow. Save and exit keeps your progress. Settings lets you export your data or import local briefs without removing the originals.',
    ],
  ]
  dialog.innerHTML = `<h2 id="tour-title">${steps[tourStep][0]}</h2><p>Introduction ${tourStep + 1} of 3</p><p>${steps[tourStep][1]}</p><div class="cloud-actions">${tourStep ? '<button data-cloud="tour-back">Back</button>' : ''}<button data-cloud="${tourStep === 2 ? 'close-dialog' : 'tour-next'}">${tourStep === 2 ? 'Done' : 'Next'}</button><button data-cloud="close-dialog">Close introduction</button></div>`
  dialog.setAttribute('aria-labelledby', 'tour-title')
  if (!dialog.open) dialog.showModal()
  dialog.querySelector<HTMLButtonElement>('button')?.focus()
}
const protectedPages = new Set(['projects', 'project', 'edit', 'new', 'settings', 'onboarding'])
const page = () => location.hash.slice(2).split(/[/?]/)[0] || 'projects'
const callback = () => location.origin + '/#/login'
const field = (name: string, label: string, value = '', type = 'text') =>
  `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${type === 'password' ? `autocomplete="${name === 'newPassword' || page() === 'signup' || page() === 'reset' ? 'new-password' : 'current-password'}" maxlength="128"` : 'maxlength="100"'} required></label>`
const directions = (selected: string) =>
  `<fieldset><legend>Design direction</legend>${presets.map((p) => `<label class="cloud-choice"><input type="radio" name="presetId" value="${p.id}" ${p.id === selected ? 'checked' : ''}><span>${p.name}</span></label>`).join('')}</fieldset>`
const feedback = () => `<p role="status" class="cloud-feedback">${e(message)}</p>`
const navigation = () =>
  `<nav aria-label="Workspace"><a href="#/projects">Projects</a><a href="#/new">New project</a><a href="#/settings">Settings</a><button data-cloud="logout">Sign out</button></nav>`
function render() {
  const p = page()
  let content = ''
  if (status === 'loading')
    content = '<h1>Opening your workspace…</h1><p role="status">Checking your session.</p>'
  else if (status === 'unavailable')
    content = `<h1>We couldn’t connect.</h1>${feedback()}<button data-cloud="retry">Retry connection</button>`
  else if (status === 'anonymous' || ['login', 'signup', 'forgot', 'reset', 'verify'].includes(p)) {
    const titles: Record<string, string> = {
      signup: 'Give your idea a home.',
      forgot: 'Reset your password.',
      reset: 'Choose a new password.',
      verify: 'Check your inbox.',
    }
    content = `<h1>${titles[p] || 'Welcome to Forge.'}</h1><p>Save your ideas and continue on any device.</p>${feedback()}`
    if (!['forgot', 'reset', 'verify'].includes(p))
      content += `<div class="login-options"><button data-cloud="google">Continue with Google</button><button data-cloud="github">Continue with GitHub</button></div>`
    content += `<form data-form="auth">${p === 'signup' ? field('name', 'Your name') : ''}${p !== 'reset' ? field('email', 'Email address', '', 'email') : ''}${!['forgot', 'verify'].includes(p) ? field('password', p === 'reset' ? 'New password' : 'Password', '', 'password') : ''}<button class="primary">${p === 'signup' ? 'Create account' : p === 'forgot' ? 'Send reset link' : p === 'reset' ? 'Reset password' : p === 'verify' ? 'Resend verification' : 'Sign in'}</button></form><div class="cloud-links"><a href="#/login">Sign in</a><a href="#/signup">Create account</a><a href="#/forgot">Forgot password?</a><a href="#/verify">Verify email</a></div>`
    root.innerHTML = `<main class="login-page"><section class="login-side">${brand()}<div class="login-form">${content}</div><div class="login-footer">${themes()}</div></section><section class="login-art" aria-label="Landscape">${imageArt('login', '', true)}</section></main>`
    document.title = 'Your account — Forge'
    return
  } else if (routeUnavailable) {
    content = `<h1>This page couldn’t be loaded.</h1>${feedback()}<button data-cloud="retry">Retry connection</button><a href="#/projects">Back to projects</a>`
  } else if (p === 'onboarding' && me) {
    const o = me.onboarding,
      d = o.draft
    content = `<p>Step ${o.stage + 1} of 4</p><h1>${['Your idea.', 'Your direction.', 'Review your brief.', 'Your workspace is ready.'][o.stage]}</h1>${feedback()}`
    if (o.stage === 3)
      content += `<p>Your brief is saved. Open it to edit your requirements and explore the design. Application generation is not available yet.</p><a class="button primary" href="#/project/${o.projectId}">Open my project →</a>`
    else
      content += `<form data-form="onboarding">${o.stage === 0 ? `${field('name', 'Project name', d.name)}${field('audience', 'Who is it for?', d.audience)}<label>What should it achieve?<textarea name="outcome" required maxlength="4000">${e(d.outcome)}</textarea></label><label>Core features<textarea name="features" required maxlength="4000">${e(d.features)}</textarea></label>` : o.stage === 1 ? `${directions(d.presetId)}${preview(d.presetId)}` : `<h2>${e(d.name)}</h2><p>${e(d.audience)}</p><p class="cloud-pre">${e(d.outcome)}</p><p class="cloud-pre">${e(d.features)}</p><p>${e(presets.find((x) => x.id === d.presetId)?.name || '')}</p><p>This creates a saved brief. No application files are generated.</p>`}<div class="cloud-actions">${o.stage > 0 ? '<button type="button" data-cloud="back">Back</button>' : ''}<button class="primary">${o.stage === 2 ? 'Create my project' : 'Continue →'}</button><button type="button" data-cloud="save-exit">Save and exit</button></div></form>`
  } else if (p === 'settings') {
    content = `<h1>Your account.</h1><p>${e(me?.user.email || '')}</p>${feedback()}<div class="cloud-actions"><button data-cloud="export">Download account data</button><button data-cloud="import-preview">Import local briefs</button><a href="#/new">Create guided project</a><button data-cloud="tour">Replay introduction</button></div><h2>Connected accounts</h2>${accounts.map((a) => `<p>${e(a.providerId)} <button data-cloud="unlink" data-provider="${e(a.providerId)}" data-account="${e(a.accountId)}" ${accounts.length < 2 ? 'disabled' : ''}>Unlink</button></p>`).join('')}<div class="cloud-actions"><button data-cloud="link-google">Link Google</button><button data-cloud="link-github">Link GitHub</button><button data-cloud="revoke">Sign out other sessions</button></div><h2>Change password</h2><form data-form="password">${field('currentPassword', 'Current password', '', 'password')}${field('newPassword', 'New password', '', 'password')}<button>Change password and sign out other sessions</button></form><h2>Delete account</h2><p>Deleting your account removes its workspace and briefs. Download your data first.</p><form data-form="delete">${field('confirmation', 'Type DELETE to confirm')}${field('password', 'Password (email accounts)', '', 'password')}<button class="danger">Delete my account</button></form>`
  } else if (p === 'new' || p === 'edit') {
    const x = p === 'edit' ? project : null
    content = `<h1>${x ? 'Edit your brief.' : 'Start another idea.'}</h1>${feedback()}<form data-form="project">${field('name', 'Project name', x?.name)}<label>Brief<textarea name="prompt" required minlength="20" maxlength="12000">${e(x?.prompt || '')}</textarea></label><label>Starting stack<select name="template">${['Next.js + Postgres', 'React + Express', 'Vue + FastAPI'].map((t) => `<option ${t === x?.template ? 'selected' : ''}>${t}</option>`).join('')}</select></label><p>Records your intent; no stack is generated.</p>${directions(x?.presetId || 'technical-mono')}<button class="primary">Save project</button></form>`
  } else if (p === 'project' && project) {
    content = `<h1>${e(project.name)}</h1>${feedback()}<p class="cloud-pre">${e(project.prompt)}</p><p>Saved to your account · Revision ${project.revision}</p><div class="cloud-actions"><a class="button" href="#/edit/${project.id}">Edit brief</a><button data-cloud="duplicate" data-id="${project.id}" data-revision="${project.revision}">Duplicate</button></div>${preview(project.presetId)}<p>Design study. Application generation is not enabled.</p>${plannerForm()}`
  } else {
    content = `<h1>Your projects.</h1>${feedback()}${onboardingCopy ? '<p>Your progress is saved. Continue setting up your first project.</p><a class="button primary" href="#/onboarding">Continue onboarding →</a>' : ''}<form data-form="search"><label>Search projects<input name="search" value="${e(search)}" maxlength="100"></label><button>Search</button></form><button data-cloud="trash">${deleted ? 'Show active projects' : 'Show deleted projects'}</button><div class="cloud-projects">${projects.map((x) => `<article><h2><a href="#/project/${x.id}">${e(x.name)}</a></h2><p>Revision ${x.revision}</p><button data-cloud="${deleted ? 'restore' : 'delete-project'}" data-id="${x.id}" data-revision="${x.revision}">${deleted ? 'Restore' : 'Delete'}</button></article>`).join('') || '<p>No projects here yet.</p>'}</div>${nextOffset !== null ? '<button data-cloud="more">Load more</button>' : ''}`
  }
  root.innerHTML = `<header class="cloud-header">${brand()}${status === 'authenticated' ? navigation() : ''}${themes()}</header><main class="cloud-main" aria-busy="${busy}">${content}</main>`
  document.title = 'Workspace — Forge'
}
function result<T>(r: { data?: T | null; error?: unknown }): T | undefined {
  if (r.error)
    throw new Error('The account request could not be completed. Check your details or retry.')
  return r.data ?? undefined
}
async function refresh() {
  const current = ++epoch
  status = 'loading'
  render()
  try {
    connection ||= await connect()
    const session = result(
      await connection.auth.getSession({ query: { disableCookieCache: true } })
    )
    if (current !== epoch) return
    if (!session?.user) {
      if (protectedPages.has(page())) {
        intendedRoute = location.hash || '#/projects'
        try {
          sessionStorage.setItem('forge.returnTo', intendedRoute)
        } catch {
          /* optional navigation hint */
        }
      }
      me = null
      projects = []
      project = null
      accounts = []
      status = 'anonymous'
      render()
      return
    }
    if (!session.user.emailVerified) {
      status = 'anonymous'
      location.hash = '#/verify'
      message = 'Verify your email to open your workspace.'
      render()
      return
    }
    const next = await connection.api<Me>('/me')
    if (current !== epoch) return
    if (me?.user.id !== next.user.id) {
      projects = []
      project = null
      accounts = []
      search = ''
      deleted = false
      nextOffset = null
      onboardingCopy = ''
      planText = ''
      planning = { configured: false, models: [] }
      const dialog = document.querySelector<HTMLDialogElement>('#dialog')
      if (dialog?.open) dialog.close()
    }
    me = next
    status = 'authenticated'
    try {
      const saved = sessionStorage.getItem('forge.returnTo')
      if (saved && /^#\/(projects|project|edit|new|settings)(\/[a-zA-Z0-9-]+)?$/.test(saved))
        intendedRoute = saved
      sessionStorage.removeItem('forge.returnTo')
    } catch {
      /* optional navigation hint */
    }
    if (['login', 'signup', 'verify', ''].includes(page()))
      location.hash = next.onboarding.completedAt ? intendedRoute : '#/onboarding'
    else if (
      !next.onboarding.completedAt &&
      !['onboarding', 'settings', 'projects'].includes(page())
    )
      location.hash = '#/onboarding'
    await load()
  } catch (error) {
    if (current !== epoch) return
    me = null
    projects = []
    project = null
    accounts = []
    status = error instanceof ApiError && error.status === 401 ? 'anonymous' : 'unavailable'
    message = error instanceof Error ? error.message : 'Connection failed.'
    render()
  }
}
async function load() {
  if (status !== 'authenticated') {
    render()
    return
  }
  if (
    me &&
    !me.onboarding.completedAt &&
    !['onboarding', 'projects', 'settings'].includes(page())
  ) {
    location.hash = '#/onboarding'
    return
  }
  const current = ++epoch,
    p = page(),
    id = location.hash.split('/')[2]
  routeUnavailable = false
  try {
    if (p === 'new' && me) {
      const next = await connection.api<Me['onboarding']>('/onboarding/start', 'POST', {
        revision: me.onboarding.revision,
      })
      if (current !== epoch) return
      me.onboarding = next
      location.hash = '#/onboarding'
      return
    }
    if (p === 'projects') {
      onboardingCopy = me?.onboarding.completedAt ? '' : 'saved'
      const list = await connection.api<{ projects: Project[]; nextOffset: number | null }>(
        `/projects?search=${encodeURIComponent(search)}&deleted=${deleted}`
      )
      if (current !== epoch) return
      projects = list.projects
      nextOffset = list.nextOffset
    }
    if (['project', 'edit'].includes(p)) {
      const item = await connection.api<Project>('/projects/' + encodeURIComponent(id || ''))
      if (current !== epoch) return
      project = item
      planText = ''
      if (p === 'project') {
        const configuration = await connection.api<typeof planning>('/provider')
        if (current !== epoch) return
        planning = configuration
      }
    }
    if (p === 'settings') {
      const list = result(await connection.auth.listAccounts())
      if (current !== epoch) return
      accounts = list || []
    }
    if (p === 'onboarding' && me) {
      const o = await connection.api<Me['onboarding']>('/onboarding')
      if (current !== epoch) return
      me.onboarding = o
      if (o.completedAt && o.stage !== 3) location.hash = '#/projects'
    }
    render()
  } catch (error) {
    if (current !== epoch) return
    routeUnavailable = true
    project = null
    failure(error)
  }
}
function failure(error: unknown) {
  message = error instanceof Error ? error.message : 'Request failed. Retry.'
  if (error instanceof ApiError && error.status === 401) {
    ++epoch
    me = null
    projects = []
    project = null
    accounts = []
    status = 'anonymous'
  }
  render()
}
async function saveStage(stage: number) {
  if (!me) return
  const form = root.querySelector<HTMLFormElement>('[data-form="onboarding"]')
  const d = { ...me.onboarding.draft }
  if (form) {
    const values = new FormData(form)
    for (const key of ['name', 'audience', 'outcome', 'features', 'presetId'] as const)
      if (values.has(key)) d[key] = String(values.get(key))
  }
  me.onboarding = await connection.api('/onboarding', 'PATCH', {
    version: 1,
    stage,
    draft: d,
    revision: me.onboarding.revision,
  })
}
document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement
  if (!form.dataset.form) return
  event.preventDefault()
  if (busy) return
  const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
  const task = async () => {
    const kind = form.dataset.form,
      p = page()
    if (kind === 'auth') {
      if (p === 'signup') {
        result(
          await connection.auth.signUp.email({
            email: values.email,
            password: values.password,
            name: values.name,
            callbackURL: callback(),
          })
        )
        message = 'Check your email to verify your account.'
        location.hash = '#/verify'
      } else if (p === 'forgot') {
        result(
          await connection.auth.requestPasswordReset({
            email: values.email,
            redirectTo: location.origin + '/#/reset',
          })
        )
        message = 'If this address has an account, a reset email has been requested.'
      } else if (p === 'verify') {
        result(
          await connection.auth.sendVerificationEmail({
            email: values.email,
            callbackURL: callback(),
          })
        )
        message = 'If verification is available, an email has been requested.'
      } else if (p === 'reset') {
        const token =
          new URLSearchParams(location.search).get('token') ||
          new URLSearchParams(location.hash.split('?')[1]).get('token') ||
          ''
        result(await connection.auth.resetPassword({ newPassword: values.password, token }))
        history.replaceState(null, '', location.pathname + '#/login')
        message = 'Password reset. Sign in to continue.'
      } else {
        result(
          await connection.auth.signIn.email({ email: values.email, password: values.password })
        )
        await refresh()
      }
    }
    if (kind === 'onboarding' && me) {
      if (me.onboarding.stage === 2) {
        await saveStage(2)
        await connection.api('/onboarding/complete', 'POST', { revision: me.onboarding.revision })
        await load()
      } else {
        await saveStage(me.onboarding.stage + 1)
      }
    }
    if (kind === 'project') {
      const brief = {
        name: values.name,
        prompt: values.prompt,
        template: values.template,
        presetId: values.presetId,
      }
      const saved = await connection.api<Project>(
        p === 'edit' && project ? '/projects/' + project.id : '/projects',
        p === 'edit' ? 'PATCH' : 'POST',
        p === 'edit' && project ? { brief, revision: project.revision } : brief
      )
      location.hash = '#/project/' + saved.id
    }
    if (kind === 'search') {
      search = values.search
      await load()
    }
    if (kind === 'password') {
      result(
        await connection.auth.changePassword({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          revokeOtherSessions: true,
        })
      )
      message = 'Password changed.'
    }
    if (kind === 'plan' && project) {
      const current = epoch
      const response = await connection.api<{ text: string; truncated: boolean }>(
        '/generate',
        'POST',
        {
          projectId: project.id,
          revision: project.revision,
          model: values.model,
        }
      )
      if (current !== epoch) return
      planText = response.text
      message = response.truncated
        ? 'The provider reached its output limit. This plan is incomplete.'
        : 'Text plan received. No application files were created.'
    }
    if (kind === 'delete') {
      if (values.confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.')
      result(
        await connection.auth.deleteUser({ password: values.password, callbackURL: callback() })
      )
      await refresh()
    }
  }
  busy = true
  form.querySelectorAll('button').forEach((b) => (b.disabled = true))
  task()
    .then(() => {
      busy = false
      render()
    })
    .catch((error) => {
      busy = false
      if (error instanceof ApiError && error.status === 401) {
        failure(error)
        return
      }
      message = error instanceof Error ? error.message : 'Request failed. Please retry.'
      const notice = root.querySelector('[role="status"]')
      if (notice) notice.textContent = message
      form.querySelectorAll('button').forEach((b) => (b.disabled = false))
    })
})
document.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-cloud],[data-theme-choice]')
  if (!el) return
  if (el.dataset.themeChoice && validTheme(el.dataset.themeChoice)) {
    applyTheme(el.dataset.themeChoice)
    root.querySelectorAll<HTMLElement>('[data-theme-choice]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.themeChoice === el.dataset.themeChoice)
      )
    })
    return
  }
  if (busy) return
  const task = async () => {
    const action = el.dataset.cloud
    if (action === 'retry') {
      await refresh()
      return
    }
    if (action === 'google' || action === 'github')
      result(
        await connection.auth.signIn.social({
          provider: action,
          callbackURL: callback(),
          errorCallbackURL: location.origin + '/#/login',
        })
      )
    if (action === 'logout') {
      result(await connection.auth.signOut())
      await refresh()
      location.hash = '#/login'
    }
    if (action === 'back' && me) await saveStage(Math.max(0, me.onboarding.stage - 1))
    if (action === 'save-exit' && me) {
      await saveStage(me.onboarding.stage)
      onboardingCopy = 'saved'
      location.hash = '#/projects'
    }
    if (action === 'export')
      downloadFile(
        'forge-account.json',
        JSON.stringify(await connection.api('/account/export'), null, 2)
      )
    if (action === 'download-plan' && planText) downloadFile('forge-text-plan.md', planText)
    if (action === 'import-preview') {
      const local = loadWorkspace(localStorage)
      if (local.error) throw new Error(local.error)
      const dialog = document.querySelector<HTMLDialogElement>('#dialog')!
      dialog.innerHTML = `<h2>Import local briefs?</h2><p>${local.data.projects.length} briefs will be copied into ${e(me?.user.email || '')}. Local originals stay in this browser.</p><button data-cloud="import-confirm">Import briefs</button><button data-cloud="close-dialog">Cancel</button>`
      dialog.showModal()
    }
    if (action === 'close-dialog') document.querySelector<HTMLDialogElement>('#dialog')!.close()
    if (action === 'import-confirm') {
      const local = loadWorkspace(localStorage)
      if (local.error) throw new Error(local.error)
      const response = await connection.api<{ imported: number; skipped: number }>(
        '/projects/import',
        'POST',
        { projects: local.data.projects }
      )
      message = `Imported ${response.imported}; already imported ${response.skipped}.`
      document.querySelector<HTMLDialogElement>('#dialog')!.close()
    }
    if (action === 'tour' || action === 'tour-next' || action === 'tour-back') {
      tourStep =
        action === 'tour'
          ? 0
          : Math.max(0, Math.min(2, tourStep + (action === 'tour-next' ? 1 : -1)))
      showTour()
    }
    if (action === 'link-google' || action === 'link-github')
      result(
        await connection.auth.linkSocial({
          provider: action.slice(5),
          callbackURL: location.origin + '/#/settings',
        })
      )
    if (action === 'unlink') {
      if (accounts.length < 2) throw new Error('Keep at least one sign-in method.')
      result(
        await connection.auth.unlinkAccount({
          providerId: el.dataset.provider!,
          accountId: el.dataset.account!,
        })
      )
      await load()
    }
    if (action === 'revoke') {
      result(await connection.auth.revokeOtherSessions())
      message = 'Other sessions signed out.'
    }
    if (['duplicate', 'restore', 'delete-project'].includes(action || '')) {
      const path = '/projects/' + el.dataset.id + (action === 'delete-project' ? '' : '/' + action)
      const updated = await connection.api<Project>(
        path,
        action === 'delete-project' ? 'DELETE' : 'POST',
        { revision: Number(el.dataset.revision) }
      )
      if (action === 'duplicate') location.hash = '#/project/' + updated.id
      else await load()
    }
    if (action === 'trash') {
      deleted = !deleted
      await load()
    }
    if (action === 'more' && nextOffset !== null) {
      const list = await connection.api<{ projects: Project[]; nextOffset: number | null }>(
        `/projects?offset=${nextOffset}&search=${encodeURIComponent(search)}&deleted=${deleted}`
      )
      projects.push(...list.projects)
      nextOffset = list.nextOffset
    }
  }
  busy = true
  task()
    .then(() => render())
    .catch(failure)
    .finally(() => {
      busy = false
      render()
    })
})
window.addEventListener('hashchange', () => {
  void load()
  root.focus()
})
// Do not replace an unsaved form when the user switches tabs.
window.addEventListener('focus', () => {
  if (!busy && !root.querySelector('form')) void refresh()
})
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (readTheme() === 'system') applyTheme()
})
applyTheme()
void refresh()
