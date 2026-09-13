import { describe, expect, it } from 'vitest'
import { catalogSchema, designBrief, installation, mcpConfig } from './catalog.ts'

describe('design references and connector configuration', () => {
  it('preserves the reference in the generation brief and generates installation guides', () => {
    const item = { slug: 'formwork-neon', name: 'Neon', pitch: 'Synthwave', stack: 'static', liveUrl: 'https://shellcat-com.github.io/formwork-neon/' }
    expect(designBrief(item, 'templates')).toContain(item.liveUrl)
    expect(designBrief(item, 'templates')).toContain('Synthwave')
    expect(installation(item, 'templates')).toBe('npx degit shellcat-com/formwork-neon my-site')
    expect(() => installation({ ...item, slug: 'x; curl bad' }, 'templates')).toThrow()
  })
  it('does not accept executable URLs or credentials in exported MCP configuration', () => {
    for (const url of ['http://localhost/mcp', 'https://user:secret@host/mcp', 'https://host/mcp?token=private', 'javascript:alert(1)']) expect(() => mcpConfig('test', url)).toThrow()
    expect(mcpConfig('parable', 'https://parable-three.vercel.app/api/mcp')).toEqual({ mcpServers: { parable: { url: 'https://parable-three.vercel.app/api/mcp' } } })
  })
  it('rejects an untrusted catalog source and unsafe previews', () => {
    expect(() => catalogSchema.parse({ kind: 'templates', source: 'https://bad.example', fetchedAt: new Date().toISOString(), items: [] })).toThrow()
  })
})
