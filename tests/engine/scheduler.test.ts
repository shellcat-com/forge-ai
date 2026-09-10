import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authenticate,
  assertLifetime,
  exactOrigin,
  MAX_STEPS,
  parseCommand,
  parseDispatch,
  parseResult,
  readJson,
  signedRequest,
  STEP_PATH,
  TRIGGER_PATH,
} from '../../engine/scheduling/protocol.ts'
import type { Dispatch, StepCommand, StepResult } from '../../engine/scheduling/protocol.ts'
import { createWorkerStepHandler } from '../../engine/scheduling/handler.ts'
import { createTriggerHandler } from '../../engine/scheduling/trigger.ts'
import { runDispatch } from '../../engine/scheduling/workflow.ts'
import type { DurableSteps } from '../../engine/scheduling/workflow.ts'

// Repeated test-only bytes, not deployment credentials.
const secret = '11'.repeat(32)
const origin = 'https://forge.example.com'
const schedulerOrigin = 'https://scheduler.example.com'
const now = Date.parse('2026-09-10T12:00:00.000Z')
const dispatch: Dispatch = {
  schemaVersion: 1,
  dispatchId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  jobId: '10000000-0000-4000-8000-000000000003',
  expiresAt: new Date(now + 600_000).toISOString(),
}
const command: StepCommand = { ...dispatch, sequence: 0 }
const complete: StepResult = { schemaVersion: 1, state: 'complete', retryAfterSeconds: 0 }
const more: StepResult = { schemaVersion: 1, state: 'continue', retryAfterSeconds: 5 }
const sign = () => signedRequest(origin + STEP_PATH, 'forge-worker-step-v1', command, secret, now)
const trigger = () =>
  signedRequest(schedulerOrigin + TRIGGER_PATH, 'forge-scheduler-trigger-v1', dispatch, secret, now)
const check = (r: Request, at = now) => authenticate(r, origin, 'forge-worker-step-v1', secret, at)
afterEach(() => vi.useRealTimers())

describe('metadata-only scheduling authentication', () => {
  it('accepts a signed command with exact scope and no secrets in the body', async () => {
    const r = await sign()
    expect(await check(r)).toEqual(command)
    expect(JSON.stringify(command)).not.toContain(secret)
  })
  it('canonicalizes metadata property order without changing authority', async () => {
    const r = await sign()
    const reordered = Object.fromEntries(Object.entries(command).reverse())
    expect(
      await check(
        new Request(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(reordered) })
      )
    ).toEqual(command)
  })
  it.each([
    'https://attacker.example.com' + STEP_PATH,
    origin + STEP_PATH + '?x=1',
    origin + '/wrong',
    'http://forge.example.com' + STEP_PATH,
  ])('rejects altered URL %s', async (url) => {
    const r = await sign()
    await expect(
      check(new Request(url, { method: 'POST', headers: r.headers, body: await r.text() }))
    ).rejects.toThrow()
  })
  it.each(['origin', 'cookie', 'host'])('rejects browser/foreign %s headers', async (header) => {
    const r = await sign()
    r.headers.set(header, 'attacker.example.com')
    await expect(check(r)).rejects.toThrow('UNAUTHORIZED')
  })
  it('rejects stale/future auth, tampering and direction/key confusion', async () => {
    await expect(check(await sign(), now + 30_001)).rejects.toThrow()
    await expect(check(await sign(), now - 30_001)).rejects.toThrow()
    const r = await sign()
    const changed = new Request(r.url, {
      method: 'POST',
      headers: r.headers,
      body: JSON.stringify({ ...command, sequence: 1 }),
    })
    await expect(check(changed)).rejects.toThrow('UNAUTHORIZED')
    await expect(
      authenticate(await sign(), origin, 'forge-worker-step-v1', '22'.repeat(32), now)
    ).rejects.toThrow()
    await expect(check(await trigger())).rejects.toThrow()
  })
  it.each([
    'http://forge.example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://x.local',
    'https://x.invalid',
    'https://a.example.com:444',
    'https://a.example.com/path',
    'https://user@a.example.com',
  ])('rejects unsafe operator origin %s', (value) => {
    expect(() => exactOrigin(value)).toThrow()
  })
  it('rejects payload expansion, invalid IDs/sequences, deadlines and result leakage', () => {
    expect(() => parseDispatch({ ...dispatch, apiKey: 'secret' })).toThrow()
    expect(() => parseDispatch({ ...dispatch, jobId: 'other' })).toThrow()
    expect(() => parseCommand({ ...command, sequence: MAX_STEPS })).toThrow()
    expect(() => parseCommand({ ...command, sequence: -1 })).toThrow()
    expect(() => assertLifetime(dispatch, now - 900_000)).toThrow()
    expect(() => assertLifetime(dispatch, Date.parse(dispatch.expiresAt))).toThrow()
    expect(() => parseResult({ ...complete, logs: 'private' })).toThrow()
    expect(() => parseResult({ ...more, retryAfterSeconds: 0 })).toThrow()
    expect(() => parseResult({ ...complete, retryAfterSeconds: 1 })).toThrow()
  })
  it('bounds chunked/invalid UTF-8/compressed bodies', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1024))
        c.enqueue(new Uint8Array(1025))
        c.close()
      },
    })
    await expect(
      readJson(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    ).rejects.toThrow()
    await expect(
      readJson(
        new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } })
      )
    ).rejects.toThrow()
    await expect(
      readJson(
        new Response('{}', {
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        })
      )
    ).rejects.toThrow()
  })
  it('bounds a stalled body', async () => {
    vi.useFakeTimers()
    const pending = readJson(
      new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } })
    )
    const assertion = expect(pending).rejects.toThrow('INVALID_REQUEST')
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
  })
  it('bounds a stream of empty chunks without relying on timer fairness', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array())
      },
    })
    await expect(
      readJson(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    ).rejects.toThrow('INVALID_REQUEST')
  })
  it.each(['{', '{} trailing', ''])('rejects malformed or missing JSON %s', async (body) => {
    await expect(
      readJson(new Response(body, { headers: { 'content-type': 'application/json' } }))
    ).rejects.toThrow('INVALID_REQUEST')
  })
})

describe('bounded Node handler (explicit control fixture)', () => {
  it('is unavailable without real composition and never silently uses E1 fixtures', async () => {
    const execute = vi.fn(async () => complete)
    expect(
      (
        await createWorkerStepHandler({ enabled: false, origin, secret, control: { execute } })(
          await sign()
        )
      ).status
    ).toBe(503)
    expect(
      (await createWorkerStepHandler({ enabled: true, origin, secret })(await sign())).status
    ).toBe(503)
    expect(execute).not.toHaveBeenCalled()
  })
  it('hands exact metadata to authority only after authentication', async () => {
    const execute = vi.fn(async (metadata: StepCommand) => {
      expect(metadata).toEqual(command)
      return complete
    })
    const handler = createWorkerStepHandler({
      enabled: true,
      origin,
      secret,
      control: { execute },
      now: () => now,
    })
    expect((await handler(new Request(origin + STEP_PATH))).status).toBe(401)
    expect(execute).not.toHaveBeenCalled()
    const response = await handler(await sign())
    expect(await response.json()).toEqual(complete)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(execute.mock.calls[0][0]).toEqual(command)
    expect(Object.isFrozen(execute.mock.calls[0][0])).toBe(true)
  })
  it('requires durable authority to handle every replay, rather than trusting process memory', async () => {
    const executed = new Set<string>()
    let effects = 0
    const execute = vi.fn(async (c: StepCommand) => {
      const id = `${c.dispatchId}:${c.sequence}`
      if (!executed.has(id)) {
        executed.add(id)
        effects++
      }
      return complete
    })
    const handler = createWorkerStepHandler({
      enabled: true,
      origin,
      secret,
      control: { execute },
      now: () => now,
    })
    await Promise.all([sign().then(handler), sign().then(handler)])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(effects).toBe(1)
    // This Set is an explicit test fake, not implementation of PostgreSQL deduplication.
  })
  it('redacts adapter errors and rejects extra result fields', async () => {
    for (const execute of [
      async () => {
        throw new Error('private-token')
      },
      async () => ({ ...complete, private: 'secret' }),
    ]) {
      const r = await createWorkerStepHandler({
        enabled: true,
        origin,
        secret,
        control: { execute },
        now: () => now,
      })(await sign())
      expect(r.status).toBe(503)
      expect(await r.text()).not.toContain('private')
    }
  })
  it('aborts work and returns uncertainty on timeout', async () => {
    const r = await sign()
    vi.useFakeTimers()
    let received: AbortSignal | undefined
    const execute = (_: StepCommand, signal: AbortSignal) => {
      received = signal
      return new Promise<StepResult>(() => {})
    }
    const result = createWorkerStepHandler({
      enabled: true,
      origin,
      secret,
      control: { execute },
      now: () => now,
    })(r)
    // WebCrypto completes on the real event loop before the handler timer is installed.
    await vi.waitFor(() => expect(received).toBeDefined())
    await vi.advanceTimersByTimeAsync(50_001)
    expect((await result).status).toBe(503)
    expect(received?.aborted).toBe(true)
  })
  it('does not begin authority work for an already disconnected client', async () => {
    const aborter = new AbortController()
    aborter.abort()
    const r = new Request(await sign(), { signal: aborter.signal })
    const execute = vi.fn(async () => complete)
    const handler = createWorkerStepHandler({
      enabled: true,
      origin,
      secret,
      control: { execute },
      now: () => now,
    })
    expect((await handler(r)).status).toBe(409)
    expect(execute).not.toHaveBeenCalled()
  })
  it('aborts authority when its client disconnects without claiming job cancellation', async () => {
    const aborter = new AbortController()
    const r = new Request(await sign(), { signal: aborter.signal })
    let received: AbortSignal | undefined
    const execute = (_: StepCommand, signal: AbortSignal) => {
      received = signal
      aborter.abort()
      return new Promise<StepResult>(() => {})
    }
    const response = await createWorkerStepHandler({
      enabled: true,
      origin,
      secret,
      control: { execute },
      now: () => now,
    })(r)
    expect(response.status).toBe(503)
    expect(received?.aborted).toBe(true)
    expect(await response.json()).toEqual({ error: 'STEP_OUTCOME_UNAVAILABLE' })
  })
})

describe('Cloudflare orchestration with explicit SDK/HTTP fixtures', () => {
  const config = { enabled: true, controlOrigin: origin, stepSecret: secret }
  function steps() {
    const names: string[] = []
    const sleeps: string[] = []
    const step: DurableSteps = {
      do: async (name, _, fn) => {
        names.push(name)
        return fn()
      },
      sleep: async (name) => {
        sleeps.push(name)
      },
    }
    return { step, names, sleeps }
  }
  it('signs real Request objects, durably sleeps, and stops on approval', async () => {
    const { step, names, sleeps } = steps()
    let calls = 0
    const fetcher = vi.fn(async (r: Request | URL | string, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      expect(await check(r as Request)).toEqual({ ...command, sequence: calls })
      return Response.json(calls++ === 0 ? more : { ...complete, state: 'awaiting-approval' })
    })
    expect(
      (await runDispatch(dispatch, step, config, { fetch: fetcher, now: () => now })).state
    ).toBe('awaiting-approval')
    expect(names).toEqual(['control-0', 'control-1'])
    expect(sleeps).toEqual(['delay-0'])
  })
  it.each(['complete', 'awaiting-approval', 'cancelled', 'blocked'] as const)(
    'stops after %s',
    async (state) => {
      const { step, names, sleeps } = steps()
      expect(
        (
          await runDispatch(dispatch, step, config, {
            fetch: async () => Response.json({ ...complete, state }),
            now: () => now,
          })
        ).state
      ).toBe(state)
      expect(names).toHaveLength(1)
      expect(sleeps).toHaveLength(0)
    }
  )
  it('caps the step count and never makes a fresh dispatch to escape the cap', async () => {
    const { step, names, sleeps } = steps()
    expect(
      (
        await runDispatch(dispatch, step, config, {
          fetch: async () => Response.json(more),
          now: () => now,
        })
      ).state
    ).toBe('blocked')
    expect(names).toHaveLength(MAX_STEPS)
    expect(sleeps).toHaveLength(MAX_STEPS - 1)
  })
  it('does not dispatch when disabled or expired', async () => {
    const { step, names } = steps()
    const fetcher = vi.fn()
    await runDispatch(dispatch, step, { ...config, enabled: false }, { fetch: fetcher })
    await runDispatch(dispatch, step, config, {
      fetch: fetcher,
      now: () => Date.parse(dispatch.expiresAt),
    })
    expect(names).toHaveLength(0)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('stops when durable sleep resumes after the immutable deadline', async () => {
    let clock = now
    const fetcher = vi.fn(async () => Response.json(more))
    const step: DurableSteps = {
      do: async (_, _options, fn) => fn(),
      sleep: async () => {
        clock = Date.parse(dispatch.expiresAt)
      },
    }
    expect(
      (await runDispatch(dispatch, step, config, { fetch: fetcher, now: () => clock })).state
    ).toBe('blocked')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects source, logs or credentials smuggled in a control response', async () => {
    await expect(
      runDispatch(dispatch, steps().step, config, {
        fetch: async () => Response.json({ ...complete, source: 'private' }),
        now: () => now,
      })
    ).rejects.toThrow('CONTROL_STEP_UNAVAILABLE')
  })
  it.each([401, 403, 409])('does not retry an authority rejection %s', async (status) => {
    const { step, names } = steps()
    expect(
      (
        await runDispatch(dispatch, step, config, {
          fetch: async () => new Response(null, { status }),
          now: () => now,
        })
      ).state
    ).toBe('blocked')
    expect(names).toHaveLength(1)
  })
  it.each([302, 429, 500, 503])('retains uncertainty for transport status %s', async (status) => {
    await expect(
      runDispatch(dispatch, steps().step, config, {
        fetch: async () => new Response('secret', { status }),
        now: () => now,
      })
    ).rejects.toThrow('CONTROL_STEP_UNAVAILABLE')
  })
  it('reuses the exact delivery identity across SDK retries', async () => {
    const seen: unknown[] = []
    const step: DurableSteps = {
      do: async (_, options, fn) => {
        expect(options.retries.limit).toBe(2)
        try {
          return await fn()
        } catch {
          return fn()
        }
      },
      sleep: async () => {},
    }
    const fetcher: typeof fetch = async (r) => {
      seen.push(await check(r as Request))
      if (seen.length === 1) throw new Error('secret upstream diagnostic')
      return Response.json(complete)
    }
    await runDispatch(dispatch, step, config, { fetch: fetcher, now: () => now })
    expect(seen).toEqual([command, command])
  })
})

describe('private workflow trigger', () => {
  it('does not create workflows when disabled or unauthenticated', async () => {
    const create = vi.fn(async () => ({}))
    const get = vi.fn()
    const config = {
      enabled: false,
      origin: schedulerOrigin,
      secret,
      workflow: { create, get },
      now: () => now,
    }
    expect((await createTriggerHandler(config)(await trigger())).status).toBe(503)
    expect(
      (
        await createTriggerHandler({ ...config, enabled: true })(
          new Request(schedulerOrigin + TRIGGER_PATH)
        )
      ).status
    ).toBe(401)
    expect(create).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
  it('creates exactly the signed immutable ID and metadata', async () => {
    const create = vi.fn(async () => ({}))
    const get = vi.fn()
    const handler = createTriggerHandler({
      enabled: true,
      origin: schedulerOrigin,
      secret,
      workflow: { create, get },
      now: () => now,
    })
    expect((await handler(await trigger())).status).toBe(202)
    expect(create).toHaveBeenCalledWith({ id: dispatch.dispatchId, params: dispatch })
    expect(get).not.toHaveBeenCalled()
  })
  it('resolves uncertain/duplicate creates without replacing the workflow ID', async () => {
    const create = vi.fn(async () => {
      throw new Error('private error')
    })
    const get = vi.fn(async () => ({ status: async () => ({ status: 'running' }) }))
    const handler = createTriggerHandler({
      enabled: true,
      origin: schedulerOrigin,
      secret,
      workflow: { create, get },
      now: () => now,
    })
    expect((await handler(await trigger())).status).toBe(202)
    expect(get).toHaveBeenCalledWith(dispatch.dispatchId)
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('does not claim delivery when creation and lookup are both uncertain', async () => {
    const workflow = {
      create: async () => {
        throw new Error('secret')
      },
      get: async () => {
        throw new Error('secret')
      },
    }
    const r = await createTriggerHandler({
      enabled: true,
      origin: schedulerOrigin,
      secret,
      workflow,
      now: () => now,
    })(await trigger())
    expect(r.status).toBe(503)
    expect(await r.text()).not.toContain('secret')
  })
  it('bounds a stalled creation and lookup, retaining an unknown outcome', async () => {
    const request = await trigger()
    vi.useFakeTimers()
    const create = vi.fn(() => new Promise<unknown>(() => {}))
    const get = vi.fn(() => new Promise<{ status(): Promise<{ status: string }> }>(() => {}))
    const response = createTriggerHandler({
      enabled: true,
      origin: schedulerOrigin,
      secret,
      workflow: { create, get },
      now: () => now,
    })(request)
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(15_001)
    expect((await response).status).toBe(503)
    expect(get).toHaveBeenCalledWith(dispatch.dispatchId)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
