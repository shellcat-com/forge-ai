import 'server-only'
import { z } from 'zod'
import { actor, apiError } from '../../../../server/auth/access'
import { smallJson } from '../../../../server/http/local'
import { ConnectionStore } from '../../../../server/byok/store'
import { discover, addModel, testConnection, runDetail } from '../../../../server/byok/service'
import { ByokError } from '../../../../server/byok/transport'
import { routingSchema } from '../../../../shared/byok'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const who = await actor(request, request.method !== 'GET'),
      store = new ConnectionStore()
    const { path } = await context.params,
      url = new URL(request.url)
    const respond = (value: unknown, status = 200) =>
      Response.json(value, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    if (path[0] === 'connections' && path.length === 1) {
      if (request.method === 'GET')
        return respond(
          await store.list(
            who,
            url.searchParams.get('q') ?? '',
            z
              .uuid()
              .optional()
              .parse(url.searchParams.get('cursor') ?? undefined)
          )
        )
      if (request.method === 'POST')
        return respond(await store.connect(who, await smallJson(request)), 201)
    }
    if (path[0] === 'connections' && path.length >= 2) {
      const id = z.uuid().parse(path[1])
      if (path.length === 2) {
        if (request.method === 'GET')
          return respond(
            await store.transaction(who, async (tx) =>
              store.public(await store.read(tx, who.id, id))
            )
          )
        if (request.method === 'PATCH' || request.method === 'DELETE') {
          const body = z
            .strictObject({
              revision: z.number().int().positive(),
              key: z
                .string()
                .min(8)
                .max(8192)
                .regex(/^[!-~]+$/)
                .optional(),
            })
            .parse(await smallJson(request))
          if (request.method === 'PATCH' && !body.key)
            throw new ByokError('KEY', 'Enter the replacement API key.')
          return respond(
            await store.change(
              who,
              id,
              body.revision,
              request.method === 'PATCH' ? body.key : undefined
            )
          )
        }
      }
      if (path.length === 3 && request.method === 'POST') {
        if (path[2] === 'discover') return respond(await discover(store, who, id, request.signal))
        if (path[2] === 'models')
          return respond(await addModel(store, who, id, await smallJson(request)))
        if (path[2] === 'test')
          return respond(
            await testConnection(store, who, id, await smallJson(request), request.signal)
          )
      }
    }
    if (path[0] === 'routing' && path.length === 1) {
      const scope = url.searchParams.get('scope') ?? 'account'
      if (scope !== 'account') z.uuid().parse(scope)
      if (request.method === 'GET') return respond(await store.profile(who, scope))
      if (request.method === 'PUT') {
        const body = z
          .strictObject({ revision: z.number().int().nonnegative(), profile: routingSchema })
          .parse(await smallJson(request, 64_000))
        return respond(await store.saveProfile(who, scope, body.profile, body.revision))
      }
    }
    if (path[0] === 'runs' && path.length === 2 && request.method === 'GET')
      return respond(await runDetail(store, who, z.uuid().parse(path[1])))
    return respond({ error: 'Not found.' }, 404)
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: 'Invalid settings. Check required fields and limits.' },
        { status: 400 }
      )
    if (error instanceof ByokError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } }
      )
    return apiError(error)
  }
}
export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
