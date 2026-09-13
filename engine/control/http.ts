import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalHash } from '../contracts/canonical.ts'
import { parseJson, uuid } from '../contracts/primitives.ts'
import {
  ControlError,
  safeError,
  tokenSchema,
  keySchema,
  cancelInputSchema,
  restoreInputSchema,
  deleteInputSchema,
} from './contracts.ts'
import { ControlService } from './service.ts'
import { one } from './database.ts'
const sessionCookie = '__Host-forge-control'
const bootstrapCookie = '__Host-forge-bootstrap'
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
function cookies(req: IncomingMessage) {
  const map = new Map<string, string>()
  for (const item of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = item.trim().split('=')
    if (!name) continue
    if (map.has(name)) throw new ControlError(400, 'DUPLICATE_COOKIE')
    map.set(name, rest.join('='))
  }
  return map
}
async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new ControlError(415, 'JSON_REQUIRED')
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
    throw new ControlError(415, 'ENCODING_UNSUPPORTED')
  if (Number(req.headers['content-length'] ?? 0) > 65536)
    throw new ControlError(413, 'PAYLOAD_TOO_LARGE')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 65536) throw new ControlError(413, 'PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  try {
    return parseJson(z.json(), Buffer.concat(chunks).toString('utf8'), 65536)
  } catch {
    throw new ControlError(422, 'VALIDATION_ERROR')
  }
}
function header(req: IncomingMessage, name: string) {
  const v = req.headers[name]
  if (typeof v !== 'string') return ''
  return v
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}
function attachment(res: ServerResponse, status: number, bytes: Uint8Array, filename: string,
  contentType: 'application/zip' | 'application/octet-stream' | 'text/plain; charset=utf-8', extra: Record<string, string>) {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': bytes.byteLength,
    'Content-Disposition': `attachment; filename="${filename}"`, ...extra })
  res.end(Buffer.from(bytes))
}
export interface HttpOptions {
  enabled: boolean
  origin: string
  pollMs?: number
  keepaliveMs?: number
  maxStreamsPerSession?: number
}
/** Single control transport. Source reads use the injected immutable artifact bridge. */
export function createControlServer(service: ControlService, options: HttpOptions) {
  const streams = new Map<string, number>()
  const server = createServer(async (req, res) => {
    const requestId = randomUUID()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    try {
      if (!options.enabled) throw new ControlError(503, 'CONTROL_DISABLED')
      if (
        req.headers.host !== new URL(options.origin).host ||
        req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== options.origin)
      )
        throw new ControlError(403, 'ORIGIN_REJECTED')
      const url = new URL(req.url ?? '/', options.origin),
        path = url.pathname,
        method = req.method ?? 'GET'
      if (!path.startsWith('/api/v1/')) throw new ControlError(404, 'NOT_FOUND')
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method))
        throw new ControlError(405, 'METHOD_NOT_ALLOWED')
      if (method !== 'GET' && req.headers.origin !== options.origin)
        throw new ControlError(403, 'ORIGIN_REJECTED')
      const jar = cookies(req),
        token = jar.get(sessionCookie) ?? '',
        csrf = header(req, 'x-csrf-token'),
        key = header(req, 'idempotency-key')
      // Bounded persisted abuse counter. Values are hashed, never logged.
      await service.db.tx(async (c) => {
        const rate = await one<{ attempts: number }>(
          c,
          `INSERT INTO request_rates(key_hash,window_start,attempts) VALUES($1,clock_timestamp(),1) ON CONFLICT(key_hash) DO UPDATE SET
          attempts=CASE WHEN request_rates.window_start<clock_timestamp()-interval '1 minute' THEN 1 ELSE request_rates.attempts+1 END,
          window_start=CASE WHEN request_rates.window_start<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE request_rates.window_start END RETURNING attempts`,
          [canonicalHash({ peer: req.socket.remoteAddress ?? 'unknown', authenticated: !!token })]
        )
        if (rate.attempts > 600) throw new ControlError(429, 'RATE_LIMITED', true)
      })
      if (method === 'GET' && path === '/api/v1/auth/bootstrap') {
        const b = service.sessions.bootstrap()
        res.setHeader('Set-Cookie', cookie(bootstrapCookie, b.cookie, 600))
        json(res, 200, { schemaVersion: 1, origin: 'fixture', bootstrapNonce: b.nonce })
        return
      }
      if (method === 'POST' && path === '/api/v1/auth/login') {
        json(
          res,
          200,
          await service.sessions.login(jar.get(bootstrapCookie) ?? '', key, await body(req))
        )
        return
      }
      if (method === 'GET' && path === '/api/v1/auth/callback') {
        const result = await service.sessions.callback(
          jar.get(bootstrapCookie) ?? '',
          url.searchParams.get('state') ?? '',
          url.searchParams.get('code') ?? ''
        )
        res.setHeader('Set-Cookie', [
          cookie(sessionCookie, result.token, 43200),
          cookie(bootstrapCookie, '', 0),
        ])
        res.writeHead(303, { Location: result.returnPath })
        res.end()
        return
      }
      if (!tokenSchema.safeParse(token).success) throw new ControlError(401, 'UNAUTHENTICATED')
      if (method === 'GET' && path === '/api/v1/session') {
        json(res, 200, await service.sessions.info(token))
        return
      }
      if (method === 'POST' && path === '/api/v1/auth/logout') {
        cancelInputSchema.parse(await body(req))
        keySchema.parse(key)
        await service.sessions.logout(token, csrf)
        res.setHeader('Set-Cookie', cookie(sessionCookie, '', 0))
        res.writeHead(204)
        res.end()
        return
      }
      if (method === 'GET' && path === '/api/v1/capabilities') {
        await service.sessions.info(token)
        json(res, 200, {
          schemaVersion: 1,
          origin: 'fixture',
          control: true,
          generation: false,
          execution: false,
          preview: false,
          fixtureWorkflows: true,
          modelPolicies: ['fixture-v1'],
          templates: ['next-postgres-v1'],
          externalGates: ['D1', 'D3', 'D4', 'D5', 'D7'],
        })
        return
      }
      let match = path.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects$/)
      if (match) {
        const w = uuid.parse(match[1])
        if (method === 'GET') {
          json(res, 200, await service.listProjects(token, w, Object.fromEntries(url.searchParams)))
          return
        }
        if (method === 'POST') {
          const r = await service.createProject(token, w, csrf, key, await body(req))
          json(res, r.status, r.body)
          return
        }
      }
      match = path.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(jobs|snapshots|restorations))?$/)
      if (match) {
        const id = uuid.parse(match[1])
        if (!match[2] && method === 'GET') {
          const result = await service.getProject(token, id)
          res.setHeader('ETag', `"${result.project.revision}"`)
          json(res, 200, result)
          return
        }
        if (!match[2] && method === 'PATCH') {
          const etag = header(req, 'if-match')
          if (!/^"[1-9][0-9]*"$/.test(etag)) throw new ControlError(412, 'REVISION_REQUIRED')
          const r = await service.patchProject(
            token,
            id,
            csrf,
            key,
            Number(etag.slice(1, -1)),
            await body(req)
          )
          json(res, r.status, r.body)
          return
        }
        if (!match[2] && method === 'DELETE') {
          const input = deleteInputSchema.parse(await body(req))
          const r = await service.deleteProject(token, id, csrf, key, input.expectedProjectRevision)
          json(res, r.status, r.body)
          return
        }
        if (match[2] === 'restorations' && method === 'POST') {
          const input = z
            .strictObject({
              schemaVersion: z.literal(1),
              snapshotId: uuid,
              expectedProjectRevision: z.number().int().positive(),
              resetPreviewDataAcknowledged: z.literal(true),
              maxCostMicros: z.number().int().nonnegative(),
            })
            .parse(await body(req))
          await service.db.resource(token, input.snapshotId, 'snapshot', 'editor', async (c) => {
            await one(c, 'SELECT id FROM snapshots WHERE id=$1 AND project_id=$2', [
              input.snapshotId,
              id,
            ])
          })
          const { snapshotId, ...restoreBody } = input
          const r = await service.restore(token, snapshotId, csrf, key, restoreBody)
          json(res, r.status, r.body)
          return
        }
        if (match[2] === 'jobs' && method === 'POST') {
          const r = await service.admit(token, id, csrf, key, await body(req))
          json(res, r.status, r.body)
          return
        }
        if (match[2] === 'snapshots' && method === 'GET') {
          json(res, 200, await service.snapshots(token, id, Object.fromEntries(url.searchParams)))
          return
        }
      }
      match = path.match(/^\/api\/v1\/artifacts\/([^/]+)$/)
      if (match && method === 'GET') {
        const artifact = await service.artifactAttachmentById(token, uuid.parse(match[1]))
        attachment(res, 200, artifact.bytes, `artifact-${artifact.artifactId}.bin`, 'application/octet-stream', {
          'X-Artifact-Sha256': artifact.sha256,
          ...(artifact.manifestDigest ? { 'X-Manifest-Digest': artifact.manifestDigest } : {}),
        })
        return
      }
      match = path.match(/^\/api\/v1\/snapshots\/([^/]+)\/(files|file|exports)$/)
      if (match) {
        const snapshotId = uuid.parse(match[1])
        if (match[2] === 'files' && method === 'GET') {
          json(res, 200, await service.files(token, snapshotId))
          return
        }
        if (match[2] === 'file' && method === 'GET') {
          if (url.searchParams.size !== 1 || !url.searchParams.has('path'))
            throw new ControlError(422, 'VALIDATION_ERROR')
          const file = await service.file(token, snapshotId, url.searchParams.get('path')!)
          attachment(res, 200, file.bytes, 'source.txt', 'text/plain; charset=utf-8', {
            'X-Source-Sha256': file.sha256, 'X-Manifest-Digest': file.manifestDigest,
          })
          return
        }
        if (match[2] === 'exports' && method === 'POST') {
          cancelInputSchema.parse(await body(req))
          keySchema.parse(key)
          const archive = await service.sourceExport(token, snapshotId, csrf, key)
          attachment(res, 201, archive.bytes, `fixture-source-${snapshotId}.zip`, 'application/zip', {
            'X-Artifact-Sha256': archive.sha256, 'X-Manifest-Digest': archive.manifestDigest,
          })
          return
        }
      }
      match = path.match(/^\/api\/v1\/snapshots\/([^/]+)\/restore$/)
      if (match && method === 'POST') {
        const r = await service.restore(
          token,
          uuid.parse(match[1]),
          csrf,
          key,
          restoreInputSchema.parse(await body(req))
        )
        json(res, r.status, r.body)
        return
      }
      match = path.match(
        /^\/api\/v1\/jobs\/([^/]+)(?:\/(approvals|promote|cancel|events|artifacts|plan|changes)(?:\/([^/]+))?)?$/
      )
      if (match) {
        const id = uuid.parse(match[1])
        if (!match[2] && method === 'GET') {
          json(res, 200, await service.getJob(token, id))
          return
        }
        if (match[2] === 'plan' && !match[3] && method === 'GET') {
          json(res, 200, await service.plan(token, id))
          return
        }
        if (match[2] === 'changes' && !match[3] && method === 'GET') {
          json(res, 200, await service.changes(token, id))
          return
        }
        if (match[2] === 'promote' && method === 'POST') {
          const r = await service.promote(token, id, csrf, key, await body(req))
          json(res, r.status, r.body)
          return
        }
        if (match[2] === 'approvals' && method === 'POST') {
          const r = await service.approve(token, id, csrf, key, await body(req))
          json(res, r.status, r.body)
          return
        }
        if (match[2] === 'cancel' && method === 'POST') {
          cancelInputSchema.parse(await body(req))
          const r = await service.cancel(token, id, csrf, key)
          json(res, r.status, r.body)
          return
        }
        if (match[2] === 'artifacts' && match[3] && method === 'GET') {
          json(res, 200, await service.artifact(token, id, uuid.parse(match[3])))
          return
        }
        if (match[2] === 'events' && method === 'GET') {
          let cursor = header(req, 'last-event-id') || url.searchParams.get('after') || undefined
          const initial = await service.events(token, id, cursor)
          const streamKey = canonicalHash(token),
            count = streams.get(streamKey) ?? 0
          if (count >= (options.maxStreamsPerSession ?? 3))
            throw new ControlError(429, 'STREAM_LIMIT')
          streams.set(streamKey, count + 1)
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.write(': fixture-control; no generated-code execution\n\n')
          let pending = false,
            closed = false,
            lastKeepalive = Date.now()
          const send = (result: Awaited<ReturnType<ControlService['events']>>) => {
            for (const event of result.events) {
              if (res.writableLength + Buffer.byteLength(JSON.stringify(event)) > 256 * 1024) {
                res.destroy()
                return
              }
              res.write(
                `id: ${id}:${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
              )
              cursor = `${id}:${event.seq}`
            }
            if (result.terminal && Number(cursor?.split(':')[1] ?? 0) >= result.latestSeq) res.end()
          }
          const timer = setInterval(
            () => {
              if (pending || closed) return
              pending = true
              void service
                .events(token, id, cursor)
                .then((result) => {
                  if (closed) return
                  send(result)
                  if (res.writableEnded || res.destroyed) return
                  if (Date.now() - lastKeepalive >= (options.keepaliveMs ?? 15000)) {
                    res.write(': keepalive\n\n')
                    lastKeepalive = Date.now()
                  }
                })
                .catch(() => res.end())
                .finally(() => {
                  pending = false
                })
            },
            Math.min(options.pollMs ?? 1000, 30000)
          )
          res.on('close', () => {
            closed = true
            clearInterval(timer)
            const n = (streams.get(streamKey) ?? 1) - 1
            if (n) streams.set(streamKey, n)
            else streams.delete(streamKey)
          })
          send(initial)
          return
        }
      }
      throw new ControlError(404, 'NOT_FOUND')
    } catch (error) {
      const e = safeError(error)
      if (res.headersSent) {
        res.end()
        return
      }
      if (e.retryable || e.status === 429) res.setHeader('Retry-After', '1')
      json(res, e.status, {
        schemaVersion: 1,
        error: {
          code: e.code,
          message: e.code,
          retryable: e.retryable,
          requestId,
          ...(e.details ? { details: e.details } : {}),
        },
      })
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.maxHeadersCount = 64
  return server
}
