import { z } from 'zod'

const parableURL = 'https://parable-three.vercel.app/api/mcp'
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
const serverSchema = z.object({
  id: slug.refine(id => id !== 'parable'), name: z.string().min(1).max(80),
  url: z.url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search }),
  tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),
}).strict()
const toolSchema = z.object({ name: z.string().min(1).max(200), description: z.string().max(8000).optional(), inputSchema: z.record(z.string(), z.unknown()) })
const templateSchema = z.object({ slug, name: z.string().max(200), pitch: z.string().max(4000), stack: z.enum(['static', 'astro', 'next', 'svelte', 'vite']), family: z.enum(['parable', 'formwork']), liveUrl: z.url().refine(value => value.startsWith('https://shellcat-com.github.io/')) })
const componentSchema = z.object({ slug, title: z.string().max(200), description: z.string().max(4000), category: z.string().max(100) }).transform(({ title, ...item }) => ({ ...item, name: title }))
export class IntegrationError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function boundedText(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new IntegrationError(502, 'The service returned an empty response.')
  const chunks = []; let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2 * 1024 * 1024) throw new IntegrationError(502, 'The service response is too large.')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks).toString('utf8')
}

async function rpcMessage(response, id) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(await boundedText(response))
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty stream')
  const decoder = new TextDecoder(); let text = ''; let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2 * 1024 * 1024) throw new Error('Stream too large')
      text += decoder.decode(value, { stream: true })
      text = text.replace(/\r\n/g, '\n')
      let end
      while ((end = text.indexOf('\n\n')) !== -1) {
        const block = text.slice(0, end); text = text.slice(end + 2)
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const message = JSON.parse(data)
        if (message.jsonrpc === '2.0' && message.id === id) return message
      }
    }
    throw new Error('No matching response')
  } finally { await reader.cancel().catch(() => {}) }
}

// Only host-configured URLs can be reached. Browser requests cannot supply a URL,
// credential, HTTP header, or executable tool name. Redirects never forward secrets.
export function createIntegrations({ env = process.env, fetchImpl = fetch, timeoutMs = 10000, now = Date.now } = {}) {
  let custom = []; let configError = false
  try {
    custom = z.array(serverSchema).max(30).parse(JSON.parse(env.FORGE_MCP_SERVERS || '[]'))
    if (new Set(custom.map(s => s.id)).size !== custom.length) throw new Error('Duplicate IDs')
  } catch { configError = true; custom = [] }
  const servers = [{ id: 'parable', name: 'Parable', url: parableURL }, ...custom]
  const cache = new Map(); const pending = new Map()
  const configuration = () => ({
    servers: servers.map(s => ({ id: s.id, name: s.name, authentication: s.tokenEnv ? 'host-token' : 'none', configured: !s.tokenEnv || Boolean(env[s.tokenEnv]) })),
    configError,
    supabase: { configured: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) },
  })
  async function session(server, action) {
    if (server.tokenEnv && !env[server.tokenEnv]) throw new IntegrationError(503, 'The host has not configured this server’s credential.')
    const signal = AbortSignal.timeout(timeoutMs)
    let sessionId; let protocol = '2025-03-26'; let sequence = 0
    const rpc = async (method, params, notification = false) => {
      const id = notification ? undefined : ++sequence
      const response = await fetchImpl(server.url, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          ...(server.tokenEnv ? { Authorization: `Bearer ${env[server.tokenEnv]}` } : {}),
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
          ...(method !== 'initialize' ? { 'MCP-Protocol-Version': protocol } : {}),
        }, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }),
      })
      if (!response.ok) throw new IntegrationError(response.status === 401 || response.status === 403 ? 409 : 502, response.status === 401 || response.status === 403 ? 'This MCP server requires valid host credentials or an OAuth connection. OAuth is not available in Forge yet.' : 'The MCP server could not complete the request.')
      const nextSession = response.headers.get('mcp-session-id')
      if (nextSession) sessionId = nextSession
      if (notification || response.status === 202) { await response.body?.cancel(); return }
      const message = await rpcMessage(response, id)
      if (!message || message.jsonrpc !== '2.0' || message.id !== id || message.error || !message.result) throw new IntegrationError(502, 'The MCP server returned an invalid or unsuccessful response.')
      return message.result
    }
    try {
      const initialized = await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'forge', version: '0.1.0' } })
      if (!['2024-11-05', '2025-03-26', '2025-06-18'].includes(initialized.protocolVersion)) throw new IntegrationError(502, 'This MCP protocol version is not supported.')
      protocol = initialized.protocolVersion
      await rpc('notifications/initialized', undefined, true)
      return await action(rpc)
    } catch (error) {
      if (error instanceof IntegrationError) throw error
      throw new IntegrationError(502, 'Could not read this service. Check the host configuration and retry.')
    } finally {
      if (sessionId) await fetchImpl(server.url, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(2000), headers: { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': protocol, ...(server.tokenEnv ? { Authorization: `Bearer ${env[server.tokenEnv]}` } : {}) } }).then(r => r.body?.cancel()).catch(() => {})
    }
  }
  async function discover(id) {
    const server = servers.find(s => s.id === id)
    if (!server) throw new IntegrationError(404, 'This server is not configured on the host.')
    return session(server, async rpc => {
      const tools = []; const seen = new Set(); let cursor
      do {
        const result = await rpc('tools/list', cursor ? { cursor } : {})
        tools.push(...z.array(toolSchema).max(500).parse(result.tools))
        if (tools.length > 500) throw new IntegrationError(502, 'This server has too many tools to display.')
        cursor = result.nextCursor
        if (cursor !== undefined && (typeof cursor !== 'string' || seen.has(cursor) || seen.size >= 20)) throw new IntegrationError(502, 'The server returned invalid pagination.')
        seen.add(cursor)
      } while (cursor)
      return { id, checkedAt: new Date(now()).toISOString(), tools, scope: 'discovery-only' }
    })
  }
  async function catalog(kind) {
    if (!['templates', 'components'].includes(kind)) throw new IntegrationError(400, 'Choose templates or components.')
    const saved = cache.get(kind)
    if (saved && now() - saved.time < 300000) return saved.value
    if (pending.has(kind)) return pending.get(kind)
    const request = session(servers[0], async rpc => {
      const result = await rpc('tools/call', { name: `list_${kind}`, arguments: {} })
      if (result.isError) throw new IntegrationError(502, 'Parable could not return its catalog.')
      const text = result.content?.find(item => item.type === 'text')?.text
      const items = z.array(kind === 'templates' ? templateSchema : componentSchema).max(1000).parse(JSON.parse(text))
      const value = { kind, items, fetchedAt: new Date(now()).toISOString(), source: parableURL }
      cache.set(kind, { value, time: now() }); return value
    }).finally(() => pending.delete(kind))
    pending.set(kind, request); return request
  }
  async function checkSupabase() {
    const url = env.SUPABASE_URL || ''; const key = env.SUPABASE_PUBLISHABLE_KEY || ''
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new IntegrationError(503, 'Configure SUPABASE_URL and a publishable SUPABASE_PUBLISHABLE_KEY on the host. Secret and service-role keys are not accepted.')
    try {
      const response = await fetchImpl(url.replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error('Unavailable')
      const settings = JSON.parse(await boundedText(response))
      if (!settings || typeof settings !== 'object' || typeof settings.external !== 'object') throw new Error('Invalid settings')
      return { checkedAt: new Date(now()).toISOString(), authReachable: true, databaseVerified: false, message: 'Supabase Auth responded to the publishable key. Database schema, row policies, storage, and user sign-in still require verification.' }
    } catch { throw new IntegrationError(502, 'Supabase did not accept this connection check. Verify the project URL and publishable key on the host.') }
  }
  return { configuration, discover, catalog, checkSupabase }
}

export async function integrationRoute(service, path, method) {
  if (!path.startsWith('/api/integrations')) return null
  const url = new URL(path, 'http://localhost')
  if (url.pathname === '/api/integrations' && method === 'GET') return service.configuration()
  if (url.pathname === '/api/integrations/parable' && method === 'GET') return service.catalog(url.searchParams.get('kind') || 'templates')
  const match = url.pathname.match(/^\/api\/integrations\/mcp\/([a-z0-9-]+)\/discover$/)
  if (match && method === 'POST') return service.discover(match[1])
  if (url.pathname === '/api/integrations/supabase/check' && method === 'POST') return service.checkSupabase()
  throw new IntegrationError(404, 'Integration endpoint not found.')
}
