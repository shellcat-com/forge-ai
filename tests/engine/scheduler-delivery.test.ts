import { describe, expect, it, vi } from 'vitest'
import { deliverDispatch } from '../../engine/scheduling/delivery.ts'
import { authenticate } from '../../engine/scheduling/protocol.ts'
import type { Dispatch } from '../../engine/scheduling/protocol.ts'

// Synthetic transport evidence only. No account, workflow service or PostgreSQL outbox.
const secret = '33'.repeat(32)
const now = Date.parse('2026-09-10T12:00:00.000Z')
const origin = 'https://scheduler.example.com'
const dispatch: Dispatch = {
  schemaVersion: 1,
  dispatchId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  jobId: '10000000-0000-4000-8000-000000000003',
  expiresAt: new Date(now + 600_000).toISOString(),
}
const config = { enabled: true, schedulerOrigin: origin, triggerSecret: secret }
describe('E1 outbox transport, explicit HTTP fixtures', () => {
  it('signs metadata and accepts only the exact acknowledgement', async () => {
    const fetcher: typeof fetch = async (request, options) => {
      expect(options?.redirect).toBe('error')
      expect(
        await authenticate(request as Request, origin, 'forge-scheduler-trigger-v1', secret, now)
      ).toEqual(dispatch)
      return Response.json({ schemaVersion: 1, dispatchId: dispatch.dispatchId }, { status: 202 })
    }
    expect(await deliverDispatch(dispatch, config, { fetch: fetcher, now: () => now })).toBe(
      'acknowledged'
    )
  })
  it.each([
    {},
    { schemaVersion: 1, dispatchId: 'wrong' },
    { schemaVersion: 1, dispatchId: dispatch.dispatchId, logs: 'private' },
  ])('retains uncertainty for malformed acknowledgement %j', async (body) => {
    expect(
      await deliverDispatch(dispatch, config, {
        fetch: async () => Response.json(body, { status: 202 }),
        now: () => now,
      })
    ).toBe('unknown')
  })
  it.each([200, 302, 429, 500, 503])('does not retry uncertain HTTP %s', async (status) => {
    const fetcher = vi.fn(async () => new Response(null, { status }))
    expect(await deliverDispatch(dispatch, config, { fetch: fetcher, now: () => now })).toBe(
      'unknown'
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 409])('reports rejection without retrying %s', async (status) => {
    const fetcher = vi.fn(async () => new Response(null, { status }))
    expect(await deliverDispatch(dispatch, config, { fetch: fetcher, now: () => now })).toBe(
      'rejected'
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not contact a workflow service while disabled or using invalid configuration', async () => {
    const fetcher = vi.fn()
    expect(await deliverDispatch(dispatch, { ...config, enabled: false }, { fetch: fetcher })).toBe(
      'disabled'
    )
    await expect(
      deliverDispatch(
        dispatch,
        { ...config, schedulerOrigin: 'http://localhost' },
        { fetch: fetcher, now: () => now }
      )
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('redacts transport errors and never substitutes a fresh delivery', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('private diagnostic')
    })
    expect(await deliverDispatch(dispatch, config, { fetch: fetcher, now: () => now })).toBe(
      'unknown'
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
