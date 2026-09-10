/** Synthetic keys, HTTP responses, DNS and repositories only. No network/spend. */
import { describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { ProviderRegistry, inputTokenUpperBound } from '../../engine/providers/registry.ts'
import {
  isPublicProviderAddress,
  providerDestination,
  resolveProviderDestination,
} from '../../engine/providers/destination.ts'
import {
  CredentialCipher,
  CredentialConnections,
  hostedCredentialResolver,
  serverCredentialResolver,
} from '../../engine/providers/credentials.ts'
import type {
  CredentialAuth,
  CredentialRecord,
  CredentialRepository,
} from '../../engine/providers/credentials.ts'
import {
  accountedProviderHooks,
  callTerms,
  priceTokens,
} from '../../engine/providers/accounting.ts'
import type {
  CallAccounting,
  CallReceipt,
  CallSettlement,
  CallTerms,
} from '../../engine/providers/accounting.ts'
import { collectProduct, generateFileBatches } from '../../engine/generation/pipeline.ts'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
import type { GenerationEvent } from '../../engine/contracts/provider.ts'
import { byokBinding, byokPolicy, byokRequest } from './byok-fixtures.ts'
import { plan, batch, manifest } from './fixtures.ts'

const registry = () => new ProviderRegistry([byokPolicy], [byokPolicy.endpoint])
const signal = () => new AbortController().signal
const secret = 'synthetic-provider-secret-only'
function repository(): CredentialRepository {
  const rows = new Map<string, CredentialRecord>()
  return {
    async read(w, id) {
      return structuredClone(rows.get(`${w}:${id}`) ?? null)
    },
    async compareAndSwap(row, expected) {
      const key = `${row.workspaceId}:${row.id}`,
        old = rows.get(key)
      if (expected === null ? !!old : old?.revision !== expected) return false
      rows.set(key, structuredClone(row))
      return true
    },
  }
}
function credentialSetup() {
  const key = randomBytes(32),
    repo = repository(),
    cipher = new CredentialCipher({
      currentKeyId: async () => 'test-key-v1',
      resolve: async () => key,
    })
  const auth: CredentialAuth = {
    sessionToken: 'synthetic-session',
    workspaceId: randomUUID(),
    csrfToken: 'synthetic-csrf',
    origin: 'https://forge.example.test',
    transport: 'authenticated-tls',
  }
  const authorizer = {
    authorize: vi.fn(async () => ({
      userId: randomUUID(),
      workspaceId: auth.workspaceId,
      role: 'owner',
    })),
  }
  const service = new CredentialConnections(authorizer, repo, cipher, registry(), auth.origin)
  return { repo, cipher, auth, authorizer, service, key }
}
function accounting(): CallAccounting & {
  rows: Map<
    string,
    { terms: CallTerms; receipt: CallReceipt; dispatched: boolean; settlement?: CallSettlement }
  >
} {
  const rows = new Map<
    string,
    { terms: CallTerms; receipt: CallReceipt; dispatched: boolean; settlement?: CallSettlement }
  >()
  return {
    rows,
    async reserve(terms) {
      const old = rows.get(terms.requestId)
      if (old) return { receipt: old.receipt, created: false }
      if (rows.size >= 12) throw new Error('CALL_CAP')
      const receipt = {
        workspaceId: terms.workspaceId,
        projectId: terms.projectId,
        jobId: terms.jobId,
        requestId: terms.requestId,
        termsDigest: canonicalHash(terms),
        callNumber: rows.size + 1,
      }
      rows.set(terms.requestId, { terms, receipt, dispatched: false })
      return { receipt, created: true }
    },
    async dispatch(r) {
      const row = rows.get(r.requestId)!
      if (row.dispatched) return false
      row.dispatched = true
      return true
    },
    async settle(r, s) {
      rows.get(r.requestId)!.settlement = s
    },
  }
}
const response = (payload: unknown = plan, extra = {}) =>
  new Response(
    JSON.stringify({
      model: byokPolicy.model,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 50, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } },
      ...extra,
    }),
    { headers: { 'content-type': 'application/json' } }
  )
const events = async (fetcher: typeof fetch, request = byokRequest(), abort = signal()) => {
  const result: GenerationEvent[] = []
  for await (const e of registry()
    .adapter('openai', async () => secret, fetcher)
    .generate(request, abort))
    result.push(e)
  return result
}
describe('BYOK destination and registry policy', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '172.31.1.1',
    '192.168.1.1',
    '198.19.1.1',
    '224.1.1.1',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    'fe80::1',
    'fc00::1',
    'ff02::1',
    '2001:db8::1',
    '2002:0808:0808::1',
    '64:ff9b::a00:1',
    '2001::1',
    '3fff::1',
    'fe80::1%en0',
  ])('denies non-global address %s', (address) =>
    expect(isPublicProviderAddress(address)).toBe(false)
  )
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'accepts global address %s',
    (address) => expect(isPublicProviderAddress(address)).toBe(true)
  )
  it.each([
    'http://api.openai.com/v1/chat/completions',
    'https://api.openai.com:444/v1/chat/completions',
    'https://api.openai.com/v1/chat/completions?q=1',
    'https://api.openai.com/v1/chat/completions#x',
    'https://u:p@api.openai.com/v1/chat/completions',
    'https://127.1/v1/chat/completions',
    'https://[::1]/v1/chat/completions',
    'https://api.openai.com./v1/chat/completions',
    'https://evil.test/v1/chat/completions',
    'https://api.openai.com/v1/responses',
  ])('rejects endpoint %s', (url) =>
    expect(() => providerDestination(url, [byokPolicy.endpoint])).toThrow()
  )
  it('rejects mixed public/private DNS and validates family; never approves empty DNS', async () => {
    for (const addresses of [
      [],
      [
        { address: '8.8.8.8', family: 4 },
        { address: '::1', family: 6 },
      ],
      [{ address: '8.8.8.8', family: 6 }],
    ])
      await expect(
        resolveProviderDestination(
          byokPolicy.endpoint,
          [byokPolicy.endpoint],
          async () => addresses
        )
      ).rejects.toThrow()
    expect(
      (
        await resolveProviderDestination(byokPolicy.endpoint, [byokPolicy.endpoint], async () => [
          { address: '8.8.8.8', family: 4 },
        ])
      ).address.address
    ).toBe('8.8.8.8')
  })
  it('supports only configured implemented capabilities and expires exact prices', () => {
    expect(() => registry().policy('anthropic', 'files')).toThrow('CAPABILITY')
    expect(() => registry().policy('openai', 'tools' as 'files')).toThrow('CAPABILITY')
    expect(() => registry().policy('openai', 'files', Date.parse('2099-01-01'))).toThrow(
      'PRICE_EXPIRED'
    )
    expect(registry().status()[0]).toMatchObject({
      acceptance: 'contract-tested',
      liveEnabled: false,
    })
    expect(
      () =>
        new ProviderRegistry(
          [{ ...byokPolicy, protocol: 'anthropic' as never }],
          [byokPolicy.endpoint]
        )
    ).toThrow()
  })
})
describe('protected credentials', () => {
  it('encrypts, redacts, rotates with CAS, invalidates stale workers and deletes ciphertext', async () => {
    const { repo, cipher, auth, service, key } = credentialSetup()
    const connected = await service.mutate(auth, 'connect', async () => ({
      provider: 'openai',
      key: secret,
    }))
    const row = (await repo.read(auth.workspaceId, connected.id))!
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(await service.status(auth, connected.id)).toMatchObject({
      configured: true,
      verified: false,
      status: 'unverified',
    })
    const binding = {
      workspaceId: row.workspaceId,
      id: row.id,
      revision: row.revision,
      provider: row.provider,
      destination: row.destination,
    }
    const resolver = hostedCredentialResolver(repo, cipher, binding, async () => undefined)
    expect(await resolver(signal())).toBe(secret)
    const rotations = await Promise.allSettled(
      [1, 2].map((n) =>
        service.mutate(auth, 'rotate', async () => ({
          id: row.id,
          expectedRevision: 1,
          key: `synthetic-rotation-${n}`,
        }))
      )
    )
    expect(rotations.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await expect(resolver(signal())).rejects.toThrow('UNAVAILABLE')
    await service.mutate(auth, 'delete', async () => ({ id: row.id, expectedRevision: 2 }))
    expect((await repo.read(auth.workspaceId, row.id))?.envelope).toBeNull()
    expect(await service.status(auth, row.id)).toMatchObject({
      configured: false,
      status: 'deleted',
    })
    expect(key.some((b) => b !== 0)).toBe(true)
    expect(JSON.stringify(connected)).not.toContain(secret)
  })
  it('authenticates before body reading and denies foreign tenant, viewer, non-TLS and origin', async () => {
    const { auth, service, authorizer } = credentialSetup(),
      body = vi.fn(async () => ({ provider: 'openai', key: secret }))
    for (const altered of [
      { ...auth, origin: 'https://evil.test' },
      { ...auth, transport: 'http' as never },
      { ...auth, workspaceId: randomUUID() },
    ])
      await expect(service.mutate(altered, 'connect', body)).rejects.toThrow('DENIED')
    authorizer.authorize.mockResolvedValue({
      userId: randomUUID(),
      workspaceId: auth.workspaceId,
      role: 'viewer',
    })
    await expect(service.mutate(auth, 'connect', body)).rejects.toThrow('DENIED')
    expect(body).not.toHaveBeenCalled()
  })
  it('AAD binds tenant, provider, destination, id and revision; tampering is redacted', async () => {
    const { auth, cipher } = credentialSetup(),
      binding = {
        workspaceId: auth.workspaceId,
        id: randomUUID(),
        revision: 1,
        provider: 'openai',
        destination: byokPolicy.endpoint,
      }
    const envelope = await cipher.encrypt(binding, secret)
    for (const change of [
      { workspaceId: randomUUID() },
      { id: randomUUID() },
      { revision: 2 },
      { provider: 'other' },
      { destination: 'https://evil.test/v1/chat/completions' },
    ])
      await expect(cipher.decrypt({ ...binding, ...change }, envelope)).rejects.toThrow(
        'CREDENTIAL_UNAVAILABLE'
      )
    await expect(cipher.decrypt(binding, { ...envelope, tag: '0'.repeat(32) })).rejects.toThrow(
      'CREDENTIAL_UNAVAILABLE'
    )
  })
  it('supports server references while denying public env names and destination rebinding', async () => {
    const expected = { provider: 'openai', destination: byokPolicy.endpoint },
      ref = {
        ...expected,
        id: 'server-openai',
        source: 'environment' as const,
        name: 'FORGE_PROVIDER_KEY',
      }
    expect(
      await serverCredentialResolver(ref, expected, async () => undefined, {
        FORGE_PROVIDER_KEY: secret,
      })(signal())
    ).toBe(secret)
    expect(
      await serverCredentialResolver(
        { ...ref, source: 'secret' },
        expected,
        async () => secret
      )(signal())
    ).toBe(secret)
    expect(() =>
      serverCredentialResolver(
        { ...ref, name: 'NEXT_PUBLIC_API_KEY' },
        expected,
        async () => secret
      )
    ).toThrow()
    expect(() =>
      serverCredentialResolver(
        ref,
        { ...expected, destination: 'https://evil.test' },
        async () => secret
      )
    ).toThrow()
  })
})
describe('provider fault/accounting pipeline', () => {
  it.each([401, 403, 429, 503])('redacts HTTP %s and never retries', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(secret, { status }))
    const result = await events(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.at(-1)).toMatchObject({
      type: 'error',
      code: status === 429 ? 'RATE_LIMIT' : status === 503 ? 'UNAVAILABLE' : 'AUTH',
    })
    expect(result[0]).toMatchObject({ type: 'usage', usage: { classification: 'uncertain' } })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
  it.each(['length', 'content_filter', 'tool_calls'])(
    'rejects finish %s without adopting partial source',
    async (finish) => {
      expect(
        (
          await events(async () =>
            response(plan, {
              choices: [{ finish_reason: finish, message: { content: JSON.stringify(plan) } }],
            })
          )
        ).at(-1)
      ).toMatchObject({ type: 'error' })
    }
  )
  it('rejects refusal, malformed JSON, credential echo, and unbounded usage', async () => {
    for (const result of [
      response(plan, {
        choices: [
          { finish_reason: 'stop', message: { refusal: 'no', content: JSON.stringify(plan) } },
        ],
      }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      response({ ...plan, assumptions: [secret] }),
      response(plan, { usage: { prompt_tokens: 9999999, completion_tokens: 4 } }),
    ]) {
      const output = await events(async () => result)
      expect(output.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_OUTPUT' })
      expect(JSON.stringify(output)).not.toContain(secret)
    }
  })
  it('records uncertain liability on timeout and cancellation, with no retry', async () => {
    const hung = vi.fn<typeof fetch>(() => new Promise(() => undefined)),
      controller = new AbortController()
    const pending = events(hung, byokRequest(), controller.signal)
    await vi.waitFor(() => expect(hung).toHaveBeenCalledTimes(1))
    controller.abort()
    expect((await pending).at(-1)).toMatchObject({ type: 'error', code: 'CANCELLED' })
    const r = { ...byokRequest(), deadlineAt: new Date(Date.now() + 20).toISOString() }
    expect((await events(hung, r)).at(-1)).toMatchObject({ type: 'error', code: 'TIMEOUT' })
  })
  it('reserves, dispatches and settles exact version once; duplicate call cannot redispatch', async () => {
    const store = accounting(),
      request = byokRequest(),
      persist = vi.fn(async () => undefined),
      transport = vi.fn<typeof fetch>(async () => response())
    const hooks = accountedProviderHooks({
      accounting: store,
      policy: byokPolicy,
      binding: byokBinding(),
      persistProduct: persist,
    })
    const adapter = registry().adapter('openai', async () => secret, transport)
    expect((await collectProduct(adapter, request, signal(), hooks)).origin).toBe('fixture')
    expect(store.rows.get(request.requestId)?.settlement).toMatchObject({
      classification: 'measured',
      amountMicros: 900,
    })
    expect(store.rows.get(request.requestId)?.terms.priceVersion).toBe(byokPolicy.price.version)
    await expect(collectProduct(adapter, request, signal(), hooks)).rejects.toThrow(
      'ALREADY_RESERVED'
    )
    expect(transport).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(1)
  })
  it('validates a structured file batch using accounted hooks and retains hashes', async () => {
    const store = accounting(),
      persisted: unknown[] = []
    const result = await generateFileBatches({
      adapter: registry().adapter(
        'openai',
        async () => secret,
        async () => response(batch)
      ),
      plan,
      base: manifest,
      protectedPaths: [],
      signal: signal(),
      hooks: accountedProviderHooks({
        accounting: store,
        policy: byokPolicy,
        binding: byokBinding(),
        persistProduct: async (_r, p) => {
          persisted.push(p)
        },
      }),
      request: () => ({ ...byokRequest(), stage: 'files', outputSchemaId: 'FileBatchV1' }),
    })
    expect(result).toMatchObject({ origin: 'fixture', batches: [batch] })
    expect(canonicalHash(result.batches[0])).toBe(canonicalHash(batch))
    expect(persisted).toHaveLength(1)
  })
  it('conservatively bounds UTF-8 plus framing, rounds integer prices and rejects bounds/repair drift', () => {
    const request = byokRequest(),
      binding = byokBinding()
    expect(inputTokenUpperBound(request, byokPolicy)).toBe(
      Buffer.byteLength(request.context[0].content) + 288
    )
    expect(
      priceTokens(1, 1, {
        ...byokPolicy,
        price: { ...byokPolicy.price, inputMicrosPerMillion: 1, outputMicrosPerMillion: 1 },
      })
    ).toBe(2)
    expect(() => callTerms({ ...request, maxOutputTokens: 40000 }, byokPolicy, binding)).toThrow(
      'BOUND'
    )
    expect(() => callTerms(request, byokPolicy, { ...binding, repairNumber: 3 })).toThrow()
    expect(() => callTerms(request, byokPolicy, { ...binding, repairNumber: 1 })).toThrow()
  })
})

it('retains the maximum for cached-token or non-default-tier pricing not representable in v1 usage', async () => {
  for (const extra of [
    { usage: { prompt_tokens: 50, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 25 } } },
    { usage: { prompt_tokens: 50, completion_tokens: 100 } },
    { service_tier: 'priority' },
  ]) {
    const store = accounting(), request = byokRequest()
    await collectProduct(registry().adapter('openai', async () => secret, async () => response(plan,extra)), request, signal(),
      accountedProviderHooks({ accounting: store, policy: byokPolicy, binding: byokBinding(), persistProduct: async () => undefined }))
    expect(store.rows.get(request.requestId)?.settlement).toMatchObject({ classification: 'uncertain' })
  }
})
it('rejects escaped or base64 credential echoes and prevents keys from entering model context', async () => {
  for (const text of [secret, Buffer.from(secret).toString('base64')]) {
    const result = await events(async () => response({ ...plan, assumptions: [text] }))
    expect(result.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_OUTPUT' })
    expect(JSON.stringify(result)).not.toContain(text)
  }
  const transport = vi.fn<typeof fetch>(async () => response())
  const result = await events(transport, { ...byokRequest(), context: [{ role: 'user', content: secret }] })
  expect(result.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_OUTPUT' })
  expect(transport).not.toHaveBeenCalled()
})
