import { readTheme } from '../theme.ts'
import { getPreset, presetCSS } from '../design/presets.ts'
export const escapeHTML = (text: unknown): string =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
export const brand = () =>
  '<a class="brand" href="#/" aria-label="Forge AI home"><svg width="25" height="26" viewBox="0 0 25 26" fill="none" aria-hidden="true"><path d="M2 2h21v6H8v4h12v6H8v6H2V2Z" fill="currentColor"/><path d="M17 20h6v4h-6z" fill="currentColor"/></svg><span>forge<span class="muted">.ai</span></span></a>'
export function themes(): string {
  const selected = readTheme()
  return `<div class="theme-switch" role="group" aria-label="Appearance">${(['system', 'light', 'dark'] as const).map((t, i) => `<button data-theme-choice="${t}" aria-label="${t[0].toUpperCase() + t.slice(1)} theme" aria-pressed="${selected === t}" title="${t}">${['▣', '☼', '☾'][i]}</button>`).join('')}</div>`
}
export function imageArt(asset: string, cls = '', eager = false): string {
  return `<img class="art ${cls}" src="/art/${asset}-1280.webp" srcset="/art/${asset}-640.webp 640w, /art/${asset}-1280.webp 1280w, /art/${asset}-2048.webp 2048w" sizes="(max-width: 760px) 100vw, 70vw" width="2048" height="1152" alt="" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''}>`
}
export function preview(id: string, mode = 'light', title?: string, compact = false): string {
  const p = getPreset(id)
  return `<style>${presetCSS(p)}</style><div class="project-preview ${compact ? 'compact' : ''}" data-preset="${p.id}" data-preview-theme="${mode}">${p.asset ? imageArt(p.asset) : '<div class="preview-grid" aria-hidden="true"></div>'}<div class="preview-content"><div class="preview-nav"><span>studio<span class="preview-dot">.</span></span><span>About &nbsp; Work <span class="preview-nav-extra">&nbsp; Contact ↗</span></span></div><div class="preview-copy"><span class="preview-eyebrow">A SPACE FOR WHAT’S NEXT</span><h2>${escapeHTML(title || p.headline).replace(/\n/g, '<br>')}</h2><p>From the first spark to something real.<br>Thoughtfully made. Ready for you.</p><span class="preview-button">Explore the possibilities ↗</span></div><div class="preview-foot"><span>Independent by design.</span><span>01 — 05</span></div></div></div>`
}
export function topbar(): string {
  return `<header class="public-nav">${brand()}<nav aria-label="Main navigation"><a href="#/presets">Design systems</a><a href="#/docs">Documentation</a><a href="#/projects">Workspace ↗</a></nav><div class="nav-actions">${themes()}<a class="button primary" href="#/login">Explore Forge <span>↗</span></a><button class="menu-toggle" data-action="menu" aria-expanded="false" aria-controls="mobile-nav" aria-label="Open navigation">☰</button></div></header><nav id="mobile-nav" class="mobile-nav" aria-label="Mobile navigation" hidden><a href="#/presets">Design systems</a><a href="#/docs">Documentation</a><a href="#/projects">Workspace</a></nav>`
}
export function footer(): string {
  return `<footer class="footer"><div>${brand()}<p>Shape the idea. Forge the system.</p></div><nav aria-label="Footer"><a href="#/docs">Documentation ↗</a><a href="#/presets">Design systems</a><a href="#/components">Components</a><a href="#/settings">Local data</a></nav><div class="footer-bottom"><span>© ${new Date().getFullYear()} Forge AI · Pre-alpha</span><span>Built with intention.</span>${themes()}</div></footer>`
}
export function recovery(title: string, text: string): string {
  return `<section class="recovery"><p class="eyebrow">[ ? ] A SMALL DETOUR</p><h1>${escapeHTML(title)}</h1><p>${escapeHTML(text)}</p><a class="button primary" href="#/projects">Back to projects →</a><a class="text-link" href="#/">Return home</a></section>`
}
