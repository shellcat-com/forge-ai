'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { landing, miniBuilder } from '../public-renderers/landing'
import { designs, components } from '../public-renderers/designs'
import { applyTheme, readTheme, validTheme } from '../theme'
import { exportPreset } from '../export'
import { topbar, footer } from './ui'
export function legacyRoute(hash: string): string | undefined {
  const path = hash.replace(/^#/, '')
  const match = path.match(/^\/project\/([a-f0-9-]{36})$/)
  if (match) return `/app/projects/${match[1]}`
  if (path.startsWith('/designs')) return path.replace('/designs', '/examples')
  if (path.startsWith('/presets')) return path.replace('/presets', '/examples')
  if (path.startsWith('/new/')) return `/app?example=${encodeURIComponent(path.slice(5))}`
  return (
    {
      '/': '/',
      '/new': '/app',
      '/projects': '/app/projects',
      '/login': '/login',
      '/docs': '/docs',
      '/settings': '/app/settings',
      '/sample': '/sample',
      '/components': '/components',
    } as Record<string, string>
  )[path]
}
function links(html: string) {
  return html.replace(/href="(#[^"]*)"/g, (_, hash) => `href="${legacyRoute(hash) ?? '/app'}"`)
}
export function PublicPage({ kind = 'landing', id }: { kind?: string; id?: string }) {
  const router = useRouter()
  const [previewTheme, setPreviewTheme] = useState('light')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const move = () => {
      const next = legacyRoute(location.hash)
      if (next) router.replace(next)
    }
    move()
    window.addEventListener('hashchange', move)
    applyTheme()
    const media = matchMedia('(prefers-color-scheme: dark)')
    const theme = () => applyTheme(readTheme())
    media.addEventListener('change', theme)
    return () => {
      window.removeEventListener('hashchange', move)
      media.removeEventListener('change', theme)
    }
  }, [router])
  let html =
    kind === 'examples'
      ? designs(id, previewTheme)
      : kind === 'components'
        ? components()
        : kind === 'sample'
          ? `<div class="marketing">${topbar()}<main class="docs-page"><p class="eyebrow">ILLUSTRATIVE WALKTHROUGH</p><h1>A little room for possibility.</h1><p>This fixed example introduces the workbench. It is not a provider result.</p>${miniBuilder()}<a class="button primary" href="/app">Create your own project →</a></main>${footer()}</div>`
          : kind === 'docs'
            ? `<div class="marketing">${topbar()}<main class="docs-page"><p class="eyebrow">FORGE / FIELD GUIDE</p><h1>From an idea to an application.</h1><section><h2>Start with your words</h2><p>Describe your product. Build creates an application; Idea, Brainstorm, and Plan help develop the brief. Your project retains its conversation.</p></section><section><h2>Your own visual direction</h2><p>Describe a style or use an optional example. The five examples never limit the kind of product you can create.</p></section><section><h2>A working local engine</h2><p>Configured models generate files. A separate worker builds them inside a restricted Docker environment. Preview, code, and history show the results. Availability is reported in Connections.</p></section><section><h2>Existing browser briefs</h2><p>Export your briefs from the original browser workspace, then import the JSON in Settings. Keep your original backup until import succeeds.</p></section><section><h2>Hosted beta</h2><p>Hosted accounts, shared previews and publishing depend on configured services and release verification. Unavailable capabilities remain labeled.</p></section><a class="button primary" href="/app">Open workspace →</a></main>${footer()}</div>`
            : landing()
  html = links(html)
  return (
    <div
      className="public-site"
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('button')
        if (!target) return
        const theme = target.dataset.themeChoice
        if (theme && validTheme(theme)) {
          applyTheme(theme)
          target.parentElement
            ?.querySelectorAll('button')
            .forEach((b) => b.setAttribute('aria-pressed', String(b === target)))
        }
        if (target.dataset.action === 'menu') {
          const nav = document.getElementById('mobile-nav')
          if (nav) {
            nav.hidden = !nav.hidden
            target.setAttribute('aria-expanded', String(!nav.hidden))
          }
        }
        if (target.dataset.action === 'preview-theme')
          setPreviewTheme((t) => (t === 'light' ? 'dark' : 'light'))
        if (target.dataset.action === 'download-preset' && target.dataset.preset)
          void exportPreset(target.dataset.preset).catch(() =>
            setNotice('The download failed. Please retry.')
          )
        if (target.dataset.action === 'specimen-feedback') setNotice('Action received.')
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {notice && (
        <p role="status" className="public-notice">
          {notice}
        </p>
      )}
    </div>
  )
}
