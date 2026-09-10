import { beforeEach, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
const mock = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mock.lookup }))
vi.mock('node:https', () => ({ request: mock.request }))
vi.mock('node:http', () => ({ request: mock.request }))
import { createTransport, checkResponse } from '../../src/server/byok/transport'
const connection = {
  provider: 'custom',
  protocol: 'chat-completions',
  baseUrl: 'https://public.example/v1/',
} as const
beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('FORGE_AUTH_MODE', 'hosted')
  mock.lookup.mockReset()
  mock.request.mockReset()
  mock.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  mock.request.mockImplementation(
    (_url: URL, _options: unknown, callback: (r: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void }
      req.setTimeout = () => {}
      req.end = () => {
        const r = Readable.from([Buffer.from('{}')]) as IncomingMessage
        r.statusCode = 200
        r.headers = {}
        callback(r)
      }
      return req
    }
  )
})
it('pins the validated DNS answer while retaining hostname TLS verification', async () => {
  const r = await createTransport(connection)(
    'models',
    undefined,
    { Authorization: 'Bearer fixture-key' },
    AbortSignal.timeout(1000)
  )
  await r.text()
  const options = mock.request.mock.calls[0][1]
  expect(options).toMatchObject({
    agent: false,
    servername: 'public.example',
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  })
  const callback = vi.fn()
  options.lookup('public.example', {}, callback)
  expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
  expect(mock.lookup).toHaveBeenCalledTimes(1)
})
for (const answers of [
  [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ],
  [{ address: '169.254.169.254', family: 4 }],
  [{ address: '::1', family: 6 }],
  [{ address: '::ffff:127.0.0.1', family: 6 }],
])
  it(
    'rejects restricted or mixed DNS answers before sending authentication: ' +
      answers.at(-1)!.address,
    async () => {
      mock.lookup.mockResolvedValue(answers)
      await expect(
        createTransport(connection)(
          'models',
          undefined,
          { Authorization: 'Bearer fixture-key' },
          AbortSignal.timeout(1000)
        )
      ).rejects.toMatchObject({ code: 'DESTINATION' })
      expect(mock.request).not.toHaveBeenCalled()
    }
  )
it('re-resolves subsequent calls and rejects a rebound destination', async () => {
  const transport = createTransport(connection)
  await (await transport('models', undefined, {}, AbortSignal.timeout(1000))).text()
  mock.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
  await expect(transport('models', undefined, {}, AbortSignal.timeout(1000))).rejects.toMatchObject(
    { code: 'DESTINATION' }
  )
  expect(mock.request).toHaveBeenCalledTimes(1)
})
it('does not follow redirects or forward credentials to the redirect destination', async () => {
  mock.request.mockImplementation(
    (_url: URL, _options: unknown, callback: (r: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void }
      req.setTimeout = () => {}
      req.end = () => {
        const r = Readable.from([]) as IncomingMessage
        r.statusCode = 302
        r.headers = { location: 'https://another.example/' }
        callback(r)
      }
      return req
    }
  )
  const response = await createTransport(connection)(
    'models',
    undefined,
    { Authorization: 'Bearer fixture-key' },
    AbortSignal.timeout(1000)
  )
  expect(() => checkResponse(response)).toThrow()
  expect(mock.request).toHaveBeenCalledTimes(1)
})
it('cancels during stalled DNS without opening a connection', async () => {
  mock.lookup.mockImplementation(() => new Promise(() => {}))
  const controller = new AbortController()
  const response = createTransport(connection)('models', undefined, {}, controller.signal)
  controller.abort()
  await expect(response).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(mock.request).not.toHaveBeenCalled()
})
