import { describe, expect, it } from 'vitest'
import { builder } from './pages/workspace.ts'
import { isolatedWebsite } from './website.ts'
import { emptyWorkspace, newProject } from './storage.ts'

describe('generated frontend isolation', () => {
  it('puts its blocking network policy before any generated content', () => {
    const html = isolatedWebsite('<!doctype html><html><script>fetch("https://example.org")</script></html>')
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'))
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("form-action 'none'")
  })
  it('escapes source into an opaque iframe, never into Forge markup', () => {
    const data = emptyWorkspace()
    const p = newProject({ name: 'Test', prompt: 'A functional gaming marketplace', template: 'React + Express' }, 'technical-mono')
    const rendered = builder(data, { tab: 'Preview', step: 0, started: false, previewTheme: 'dark', file: '', provider: {configured: true, models: []}, generating: false, generated: '', website: '<!doctype html><html><script>alert(1)</script></html>', error: '', selectedModel: '', providerVerified: false }, p)
    expect(rendered).toContain('sandbox="allow-scripts"')
    expect(rendered).not.toContain('allow-same-origin')
    expect(rendered).not.toContain('<script>alert(1)</script>')
    expect(rendered).toContain('&lt;script&gt;')
  })
})
