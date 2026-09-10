/** Mocked Node TLS socket/DNS contract, not a live network containment claim. */
import { expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { pinnedProviderFetch } from '../../engine/providers/destination.ts'
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
const endpoint = 'https://api.openai.com/v1/chat/completions'
let response: EventEmitter & {
  statusCode: number
  headers: Record<string, string>
  destroy: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)
  response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    destroy: vi.fn(),
  })
  vi.mocked(request).mockImplementation(((
    _url: unknown,
    _options: unknown,
    callback: (r: unknown) => void
  ) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: () => {
        callback(response)
        queueMicrotask(() => {
          response.emit('data', Buffer.from('{}'))
          response.emit('end')
        })
      },
    })
    return req
  }) as unknown as typeof request)
})
it('pins validated DNS to a new TLS socket while retaining exact Host/SNI certificate verification', async () => {
  const result = await pinnedProviderFetch([endpoint])(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: new AbortController().signal,
    headers: { Authorization: 'Bearer synthetic-transport-key' },
    body: '{}',
  })
  expect(await result.json()).toEqual({})
  expect(lookup).toHaveBeenCalledTimes(1)
  const args = vi.mocked(request).mock.calls[0] as unknown as [
    URL,
    {
      servername: string
      rejectUnauthorized: boolean
      agent: boolean
      family: number
      lookup: (host: string, options: object, callback: (...values: unknown[]) => void) => void
    },
  ]
  expect(args[0].href).toBe(endpoint)
  expect(args[1]).toMatchObject({
    servername: 'api.openai.com',
    rejectUnauthorized: true,
    agent: false,
    family: 4,
  })
  const callback = vi.fn()
  args[1].lookup('api.openai.com', {}, callback)
  expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4)
  expect(lookup).toHaveBeenCalledTimes(1)
})
it('rejects a DNS rebind to private IP on the next request before exposing Authorization', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never)
  await expect(
    pinnedProviderFetch([endpoint])(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: new AbortController().signal,
      headers: { Authorization: 'Bearer synthetic-transport-key' },
      body: '{}',
    })
  ).rejects.toThrow('DESTINATION_DENIED')
  expect(request).not.toHaveBeenCalled()
})
it('does not follow redirects or propagate a location/body', async () => {
  response.statusCode = 307
  response.headers.location = 'https://evil.test/'
  const result = await pinnedProviderFetch([endpoint])(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: new AbortController().signal,
    headers: { Authorization: 'Bearer synthetic-transport-key' },
    body: '{}',
  })
  expect(result.status).toBe(502)
  expect(result.headers.get('location')).toBeNull()
  expect(await result.text()).toBe('')
  expect(request).toHaveBeenCalledTimes(1)
  expect(response.destroy).toHaveBeenCalled()
})
