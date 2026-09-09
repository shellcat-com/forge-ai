import { describe, expect, it } from 'vitest'
import { presets, presetCSS } from './design/presets.ts'
import { resolveTheme, validTheme } from './theme.ts'
import { escapeHTML, preview } from './components/ui.ts'
describe('theme preference', () => {
  it('follows the OS only for system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
  it('rejects unknown persisted themes', () => {
    expect(validTheme('sepia')).toBe(false)
    expect(validTheme(null)).toBe(false)
  })
})
describe('reusable presets', () => {
  it('has five unique, complete versioned systems', () => {
    expect(new Set(presets.map((p) => p.id)).size).toBe(5)
    for (const p of presets) {
      expect(p.version).toBe(1)
      expect(Object.keys(p.recipes).sort()).toEqual([
        'cta',
        'empty',
        'error',
        'feature',
        'footer',
        'hero',
        'navigation',
      ])
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(p.themes[mode]).length).toBe(6)
        expect(p.themes[mode].canvas).not.toBe(p.themes[mode].ink)
      }
    }
  })
  it('scopes every theme selector and variable to a preview', () => {
    for (const p of presets) {
      const css = presetCSS(p)
      expect(css).not.toContain(':root')
      expect(css).not.toContain('--canvas:')
      expect(css).toContain(`.project-preview[data-preset="${p.id}"][data-preview-theme="dark"]`)
      expect(css).toContain('--p-ink:')
    }
  })
  it('escapes project text before displaying markup', () => {
    const value = '<img src=x onerror="alert(1)">'
    expect(escapeHTML(value)).not.toContain('<img')
    expect(preview('technical-mono', 'light', value)).toContain('&lt;img')
    expect(preview('technical-mono', 'light', value)).not.toContain('<img src=x')
  })
})
