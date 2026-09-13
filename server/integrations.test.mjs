import { describe, expect, it, vi } from 'vitest'
import { createIntegrations, integrationRoute } from './integrations.mjs'

function transport(handle = () => ({ tools: [] })) {
  return vi.fn(async (_url, options) => {
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    const request = JSON.parse(options.body)
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } } : handle(request)
    return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: { 'mcp-session-id': 'test-session' } })
  })
}
describe('integration service', () => {
  it('reads an SSE response without waiting for the server to close its stream', async () => {
    const cancelled = vi.fn()
    const fetchImpl = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body)
      if (!request.id) return new Response(null, { status: 202 })
      const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18' } : { tools: [] }
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(': heartbeat\r\n\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\r\n\r\n'))
      }, cancel: cancelled })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    })
    expect((await createIntegrations({ fetchImpl }).discover('parable')).tools).toEqual([])
    expect(cancelled).toHaveBeenCalledTimes(2)
  })
  it('negotiates MCP, paginates discovery, forwards only host secrets, and closes the session', async () => {
    const fetchImpl = transport(request => request.params.cursor ? { tools: [{ name: 'second', inputSchema: {} }] } : { tools: [{ name: 'first', inputSchema: {} }], nextCursor: 'next' })
    const service = createIntegrations({ env: { FORGE_MCP_SERVERS: JSON.stringify([{ id: 'custom', name: 'Custom', url: 'https://example.com/mcp', tokenEnv: 'CUSTOM_TOKEN' }]), CUSTOM_TOKEN: 'private-secret' }, fetchImpl })
    const result = await service.discover('custom')
    expect(result.tools.map(t => t.name)).toEqual(['first', 'second'])
    expect(JSON.stringify(service.configuration())).not.toContain('private-secret')
    expect(fetchImpl.mock.calls[2][1].headers).toMatchObject({ Authorization: 'Bearer private-secret', 'Mcp-Session-Id': 'test-session', 'MCP-Protocol-Version': '2025-06-18' })
    expect(fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE')
    expect(fetchImpl.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true)
  })
  it('rejects unknown servers, malformed config, duplicate IDs, and missing credentials', async () => {
    const fetchImpl = transport()
    const s = createIntegrations({ env: {}, fetchImpl })
    await expect(s.discover('https://localhost')).rejects.toMatchObject({ status: 404 })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(createIntegrations({ env: { FORGE_MCP_SERVERS: 'invalid' } }).configuration().configError).toBe(true)
    const config = { id: 'custom', name: 'Custom', url: 'https://example.com/mcp', tokenEnv: 'TOKEN' }
    expect(createIntegrations({ env: { FORGE_MCP_SERVERS: JSON.stringify([config, config]) } }).configuration().configError).toBe(true)
    const missing = createIntegrations({ env: { FORGE_MCP_SERVERS: JSON.stringify([config]) }, fetchImpl })
    await expect(missing.discover('custom')).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('fails closed on errors and repeated pagination without leaking upstream details', async () => {
    const service = createIntegrations({ fetchImpl: transport(() => ({ tools: [], nextCursor: 'repeat' })) })
    await expect(service.discover('parable')).rejects.toThrow('pagination')
    const failed = createIntegrations({ fetchImpl: async () => new Response('private upstream token', { status: 401 }) })
    await expect(failed.discover('parable')).rejects.toThrow('requires valid host credentials')
  })
  it('fetches catalog through the fixed tool, validates entries, and caches successful results', async () => {
    const item = { slug: 'quench', name: 'Quench', pitch: 'A forge', stack: 'static', family: 'parable', liveUrl: 'https://shellcat-com.github.io/quench/' }
    const fetchImpl = transport(request => { expect(request.params.name).toBe('list_templates'); return { content: [{ type: 'text', text: JSON.stringify([item]) }] } })
    const service = createIntegrations({ fetchImpl })
    expect((await service.catalog('templates')).items).toEqual([item])
    const calls = fetchImpl.mock.calls.length
    await service.catalog('templates')
    expect(fetchImpl.mock.calls).toHaveLength(calls)
    await expect(service.catalog('execute_sql')).rejects.toMatchObject({ status: 400 })
    item.liveUrl = 'javascript:alert(1)'
    await expect(createIntegrations({ fetchImpl }).catalog('templates')).rejects.toMatchObject({ status: 502 })
  })
  it('does not expose generic tools/call, URLs, or database mutation endpoints', async () => {
    const service = createIntegrations({ env: {} })
    expect(await integrationRoute(service, '/api/other', 'GET')).toBeNull()
    await expect(integrationRoute(service, '/api/integrations/mcp/parable/call', 'POST')).rejects.toMatchObject({ status: 404 })
  })
  it('checks only Supabase Auth with a publishable key and reports the verification boundary', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ external: { email: true } }))
    const service = createIntegrations({ env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' }, fetchImpl })
    expect(await service.checkSupabase()).toMatchObject({ authReachable: true, databaseVerified: false })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.supabase.co/auth/v1/settings')
    const unsafe = createIntegrations({ env: { SUPABASE_URL: 'http://127.0.0.1', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' }, fetchImpl })
    await expect(unsafe.checkSupabase()).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
