import { createServer } from 'node:http'
import { z } from 'zod'
import { HttpError, parse, projectInput, onboardingInput, revision } from './contracts.mjs'

export function createCloudApp({ store, verify, origin, authUrl, planner, now = Date.now }) {
  const buckets = new Map()
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      if (req.headers.origin && req.headers.origin !== origin)
        throw new HttpError(403, 'Origin not allowed.')
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new HttpError(403, 'Cross-site request denied.')
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/api/config' && req.method === 'GET')
        return reply(200, { mode: 'cloud', authUrl })
      const user = await verify(req.headers.authorization, req.headers['x-forge-session'])
      const minute = Math.floor(now() / 60000)
      if (buckets.size > 10000) {
        for (const [key, value] of buckets) if (value.minute !== minute) buckets.delete(key)
        if (buckets.size > 10000 && !buckets.has(user.id))
          throw new HttpError(503, 'Service is busy. Please retry.')
      }
      const bucket = buckets.get(user.id)
      const count = bucket?.minute === minute ? bucket.count + 1 : 1
      buckets.set(user.id, { minute, count })
      if (count > 120) {
        res.setHeader('Retry-After', '60')
        throw new HttpError(429, 'Too many requests. Retry in one minute.')
      }
      let body = {}
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.headers.origin !== origin) throw new HttpError(403, 'Origin required.')
        if (req.headers['content-type']?.split(';')[0] !== 'application/json')
          throw new HttpError(415, 'JSON required.')
        let raw = ''
        for await (const chunk of req) {
          raw += chunk.toString()
          if (Buffer.byteLength(raw) > 1024 * 1024)
            throw new HttpError(413, 'Request is too large.')
        }
        try {
          body = JSON.parse(raw)
        } catch {
          throw new HttpError(400, 'Invalid JSON.')
        }
      }
      const path = url.pathname,
        method = req.method
      if (path === '/api/me' && method === 'GET')
        return reply(200, { user, onboarding: await store.onboarding(user.id) })
      if (path === '/api/onboarding' && method === 'GET')
        return reply(200, await store.onboarding(user.id))
      if (path === '/api/onboarding' && method === 'PATCH')
        return reply(200, await store.onboarding(user.id, parse(onboardingInput, body)))
      if (path === '/api/onboarding/complete' && method === 'POST')
        return reply(
          200,
          await store.complete(user.id, parse(z.object({ revision }).strict(), body).revision)
        )
      if (path === '/api/onboarding/start' && method === 'POST')
        return reply(
          200,
          await store.startGuided(user.id, parse(z.object({ revision }).strict(), body).revision)
        )
      if (path === '/api/account/export' && method === 'GET')
        return reply(200, await store.export(user.id))
      if (path === '/api/projects/import' && method === 'POST') {
        const input = parse(
          z
            .object({
              projects: z
                .array(projectInput.extend({ id: z.string().min(1).max(100) }).passthrough())
                .max(100),
            })
            .strict(),
          body
        )
        return reply(200, await store.import(user.id, input.projects))
      }
      if (path === '/api/projects' && method === 'GET') {
        const offset = parse(
          z.coerce.number().int().min(0).max(100000),
          url.searchParams.get('offset') || 0
        )
        const search = parse(z.string().max(100), url.searchParams.get('search') || '')
        return reply(
          200,
          await store.list(user.id, {
            offset,
            search,
            deleted: url.searchParams.get('deleted') === 'true',
          })
        )
      }
      if (path === '/api/projects' && method === 'POST')
        return reply(201, await store.create(user.id, parse(projectInput, body)))
      const match = path.match(/^\/api\/projects\/([0-9a-f-]{36})(?:\/(duplicate|restore))?$/i)
      if (match) {
        parse(z.uuid(), match[1])
        const op =
          method === 'GET' && !match[2]
            ? 'get'
            : method === 'PATCH' && !match[2]
              ? 'edit'
              : method === 'DELETE' && !match[2]
                ? 'delete'
                : method === 'POST'
                  ? match[2]
                  : null
        if (!op) throw new HttpError(405, 'Method not allowed.')
        const input =
          op === 'get'
            ? {}
            : parse(
                op === 'edit'
                  ? z.object({ revision, brief: projectInput }).strict()
                  : z.object({ revision }).strict(),
                body
              )
        return reply(200, await store.mutate(user.id, match[1], op, input))
      }
      if (path === '/api/provider' && method === 'GET')
        return reply(200, planner?.configuration() || { configured: false, models: [] })
      if (path === '/api/generate' && method === 'POST') {
        const input = parse(
          z.object({ projectId: z.uuid(), revision, model: z.string().min(1).max(100) }).strict(),
          body
        )
        // Fetch only the session owner's saved brief, never accept a client-supplied owner or prompt.
        const saved = await store.mutate(user.id, input.projectId, 'get', {})
        if (saved.deletedAt) throw new HttpError(409, 'Restore this project before planning.')
        if (saved.revision !== input.revision)
          throw new HttpError(409, 'Reload the latest brief before planning.')
        if (!planner) throw new HttpError(503, 'Hosted planning is not enabled.')
        const controller = new AbortController()
        res.on('close', () => {
          if (!res.writableEnded) controller.abort()
        })
        return reply(200, await planner.run(saved, input.model, controller.signal))
      }
      throw new HttpError(404, 'Not found.')
    } catch (error) {
      reply(error instanceof HttpError ? error.status : 503, {
        error:
          error instanceof HttpError
            ? error.message
            : 'The service is temporarily unavailable. Your saved work is unchanged.',
      })
    }
  })
}
