'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { landing, miniBuilder } from '../public-renderers/landing'
import { designs, components } from '../public-renderers/designs'
import { applyTheme, readTheme, validTheme } from '../theme'
import { exportPreset } from '../export'
import { topbar, footer } from './ui'
import { documentation, demoPrompt } from '../public-renderers/documentation'
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
  return html.replace(/href="(#\/[^"]*)"/g, (_, hash) => `href="${legacyRoute(hash) ?? '/app'}"`)
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
            ? documentation()
            : landing()
  html = links(html)
  return (
    <div
      className={`public-site${kind === 'docs' ? ' guide-site' : ''}`}
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
        if (target.dataset.action === 'copy-guide-prompt') {
          const status = document.getElementById('guide-copy-status')
          void navigator.clipboard
            ?.writeText(demoPrompt)
            .then(() => {
              if (status)
                status.textContent =
                  'Demo prompt copied. Paste it into Home and review it before submitting.'
            })
            .catch(() => {
              const text = document.getElementById('guide-demo-text') as HTMLTextAreaElement | null
              text?.focus()
              text?.select()
              if (status)
                status.textContent =
                  'Copy is unavailable in this browser. The prompt is selected; use your keyboard or browser menu to copy it.'
            })
          if (!navigator.clipboard) {
            const text = document.getElementById('guide-demo-text') as HTMLTextAreaElement | null
            text?.focus()
            text?.select()
            if (status)
              status.textContent =
                'The prompt is selected. Use your keyboard or browser menu to copy it.'
          }
        }
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
