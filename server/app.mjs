import { createServer } from 'node:http'
import { generate, models, ProviderError } from './provider.mjs'

export function createApp({ key = '', fetchImpl = fetch, timeoutMs = 120000, dailyLimit = 100, now = Date.now } = {}) {
  let active = false
  let calls = 0
  let day = ''
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const reply = (status, data) => {
      if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    }
    // This prototype is deliberately loopback-only; deny cross-site/browser proxy use.
    if (!['127.0.0.1:3001', 'localhost:3001'].includes(req.headers.host)) return reply(403, { error: 'Invalid host.' })
    if (req.headers.origin && !['http://127.0.0.1:5173', 'http://localhost:5173'].includes(req.headers.origin)) return reply(403, { error: 'Invalid origin.' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Cross-site request denied.' })
    if (req.url === '/api/provider' && req.method === 'GET') {
      return reply(200, { provider: 'NVIDIA', configured: Boolean(key), models, dailyLimit, scope: 'Free endpoint prototype; account quotas apply.' })
    }
    if (req.url !== '/api/generate' || req.method !== 'POST') return reply(404, { error: 'Not found.' })
    if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'JSON required.' })
    if (!key) return reply(503, { error: 'Set NVIDIA_API_KEY in the server environment and restart the API server.' })
    if (active) return reply(429, { error: 'A generation is already running. Try again after it finishes.' })
    const today = new Date(now()).toISOString().slice(0, 10)
    if (today !== day) { day = today; calls = 0 }
    if (calls >= dailyLimit) return reply(429, { error: 'Local daily request budget reached. It resets at midnight UTC.' })
    active = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk.toString()
        if (Buffer.byteLength(body) > 24000) throw new ProviderError(413, 'Brief is too large.')
      }
      let input
      try { input = JSON.parse(body) } catch { throw new ProviderError(400, 'Invalid JSON.') }
      if (!input || typeof input.prompt !== 'string' || input.prompt.trim().length < 20 || input.prompt.length > 16000 || typeof input.name !== 'string' || input.name.length > 100 || !['Next.js + Postgres', 'React + Express', 'Vue + FastAPI'].includes(input.template)) throw new ProviderError(400, 'Provide a project name, valid stack, and a brief of 20–16,000 characters.')
      if (!models.some(item => item.id === input.model)) throw new ProviderError(400, 'Choose an enabled NVIDIA model.')
      calls++
      reply(200, await generate({ ...input, key, signal: controller.signal, fetchImpl }))
    } catch (error) {
      reply(controller.signal.aborted ? 504 : error instanceof ProviderError ? error.status : 502,
        { error: controller.signal.aborted ? 'Generation timed out or was cancelled. Try a shorter brief.' : error instanceof ProviderError ? error.message : 'The provider connection failed. Check connectivity and try again.' })
    } finally { clearTimeout(timer); active = false }
  })
}
