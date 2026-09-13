import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import '../../src/styles.css'
import { topbar, footer, escapeHTML } from '../../src/components/ui.ts'
import { IntegrationsWorkspace } from '../../src/integrations/workspace.ts'
import { applyTheme, validTheme } from '../../src/theme.ts'

const root = document.querySelector<HTMLDivElement>('#app')!
const workspace = new IntegrationsWorkspace(async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const response = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result as T
}, render, async (item, brief) => {
  location.hash = '#/created'
  root.innerHTML = `<main class="docs-page"><h1>${escapeHTML(item.name)} design brief</h1><p>Verification harness: this brief has not been persisted.</p><pre>${escapeHTML(brief)}</pre><a href="#/design-library">Return to library</a></main>`
})
function render() {
  if (location.hash === '#/created') return
  root.innerHTML = `<div class="marketing">${topbar()}<main>${workspace.render(location.hash !== '#/integrations')}</main>${footer()}</div>`
}
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-integration],[data-theme-choice],[data-action]')
  if (!target) return
  if (target.dataset.themeChoice && validTheme(target.dataset.themeChoice)) { applyTheme(target.dataset.themeChoice); render() }
  if (target.dataset.action === 'menu') { const nav = document.querySelector<HTMLElement>('#mobile-nav')!; nav.hidden = !nav.hidden; target.setAttribute('aria-expanded', String(!nav.hidden)) }
  if (target.dataset.integration) void workspace.action(target.dataset.integration, target.dataset.id)
})
document.addEventListener('submit', event => {
  const form = event.target as HTMLFormElement
  if (form.dataset.integrationForm) { event.preventDefault(); workspace.submit(form.dataset.integrationForm, new FormData(form)) }
})
window.addEventListener('hashchange', render)
applyTheme(); render(); void workspace.enter()
