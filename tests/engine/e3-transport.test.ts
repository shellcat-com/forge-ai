import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request as httpsRequest, type Server } from 'node:https'
import type { RequestListener } from 'node:http'
import type { Duplex } from 'node:stream'
import { generateKeyPairSync, X509Certificate } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { RunnerClient, createMtlsTransport } from '../../engine/runner-client/index.ts'
import { brokerHttpHandler } from '../../runner/http.ts'
import { SandboxBroker, type HostDriver, type BrokerRequest } from '../../runner/broker.ts'
import { FileJournal } from '../../runner/journal.ts'
import { signDescriptor, signResult } from '../../runner/auth.ts'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { descriptor as original, review as originalReview, approval as originalApproval, context as originalContext, resources, now, id } from './fixtures.ts'

// Real loopback TLS sockets and ephemeral test PKI; authority and host are fixtures.
// No certificate/key is committed, no provider call or generated-code execution.
const execute = promisify(execFile)
const signing = generateKeyPairSync('ed25519')
const alternateSigning = generateKeyPairSync('ed25519')
const clock = () => Date.parse(now)
type Certificate = { key: string; cert: string; fingerprint: string }
let temporary: string
let ca: string
let serverIdentity: Certificate
let wrongHostname: Certificate
let workerIdentity: Certificate
let otherWorker: Certificate
let untrustedWorker: Certificate
const listeners: { server: Server; sockets: Set<Duplex> }[] = []
let uniqueJournal = 0

async function openssl(args: string[]) {
  await execute('openssl', args, { cwd: temporary, timeout: 10000, maxBuffer: 32768 })
}
async function certificate(name: string, usage: 'serverAuth' | 'clientAuth', hostname = '127.0.0.1'): Promise<Certificate> {
  await openssl(['req', '-new', '-newkey', 'ed25519', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`])
  const extensions = `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${usage}\n`
    + (usage === 'serverAuth' ? `subjectAltName=${hostname === '127.0.0.1' ? 'IP' : 'DNS'}:${hostname}\n` : '')
  await writeFile(join(temporary, `${name}.ext`), extensions, { mode: 0o600 })
  await openssl(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
    '-out', `${name}.pem`, '-days', '1', '-extfile', `${name}.ext`])
  const cert = await readFile(join(temporary, `${name}.pem`), 'utf8')
  return { key: await readFile(join(temporary, `${name}.key`), 'utf8'), cert,
    fingerprint: new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase() }
}
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'forge-transport-pki-'))
  await openssl(['req', '-x509', '-newkey', 'ed25519', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=ForgeTestCA',
    '-days', '1', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
  ca = await readFile(join(temporary, 'ca.pem'), 'utf8')
  serverIdentity = await certificate('fixture-server', 'serverAuth')
  wrongHostname = await certificate('wrong-host-server', 'serverAuth', 'other.invalid')
  workerIdentity = await certificate('fixture-worker', 'clientAuth')
  otherWorker = await certificate('other-worker', 'clientAuth')
  await openssl(['req', '-x509', '-newkey', 'ed25519', '-nodes', '-keyout', 'untrusted.key', '-out', 'untrusted.pem', '-subj', '/CN=UntrustedFixture', '-days', '1'])
  untrustedWorker = { key: await readFile(join(temporary, 'untrusted.key'), 'utf8'), cert: await readFile(join(temporary, 'untrusted.pem'), 'utf8'), fingerprint: '' }
}, 20000)
afterEach(async () => {
  for (const listener of listeners.splice(0)) {
    await new Promise<void>(resolve => {
      listener.server.close(() => resolve())
      for (const socket of listener.sockets) socket.destroy()
    })
    expect(listener.server.listening).toBe(false)
  }
})
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }) })

async function listen(handler: RequestListener, identity = serverIdentity) {
  const sockets = new Set<Duplex>()
  const server = createServer({ key: identity.key, cert: identity.cert, ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3' }, handler)
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('tlsClientError', () => { /* Expected authentication failures are intentionally redacted. */ })
  listeners.push({ server, sockets })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected loopback listener')
  return { server, endpoint: `https://127.0.0.1:${address.port}/v1/broker` }
}
function config(endpoint: string, worker = workerIdentity, server = serverIdentity) {
  return { endpoint, ca, cert: worker.cert, key: worker.key, serverCertificateSha256: server.fingerprint }
}
function client(endpoint: string, overrides: Partial<Parameters<typeof createMtlsTransport>[0]> = {}) {
  return new RunnerClient(createMtlsTransport({ ...config(endpoint), ...overrides }), new Map([['fixture-broker-key', signing.publicKey]]), clock)
}
function fixtureBroker() {
  let creates = 0; let dispatched = 0
  const commandPolicy = templateCommandPolicy(resources)
  const review = { ...originalReview, commandPolicy, policyDigest: canonicalHash(commandPolicy) }
  const approval = { ...originalApproval, subjectDigest: canonicalHash(review) }
  const context = { ...originalContext, subjectDigest: canonicalHash(review), policyDigest: review.policyDigest }
  const descriptor = { ...original, executionReviewDigest: canonicalHash(review), commandPolicyDigest: review.policyDigest }
  const driver: HostDriver = { origin: 'fixture', async assertAvailable() {}, async create() { creates++ }, async renew() {},
    async runCheck() { throw new Error('Fixture has no executable checks') }, async collect() { throw new Error('Fixture has no build output') },
    async destroy() { return { resourcesDestroyed: true, fencePersisted: true } } }
  const broker = new SandboxBroker({ journal: new FileJournal(join(temporary, `journal-${uniqueJournal++}`)), driver,
    keys: new Map([['fixture-worker-key', signing.publicKey]]), workerFingerprints: new Set([workerIdentity.fingerprint]),
    authority: async () => { dispatched++; return { review, approval, context, currentEpoch: 1 } },
    capacity: { global: 1, workspace: 1, cpu: 2, memoryMiB: 4096, diskMiB: 8192 }, clock })
  const operation: BrokerRequest = { action: 'create', signedDescriptor: signDescriptor(descriptor, 'fixture-worker-key', signing.privateKey) }
  return { broker, operation, creates: () => creates, dispatched: () => dispatched }
}
function rawRequest(endpoint: string, body: string, worker: Certificate | null = workerIdentity) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpsRequest(endpoint, { method: 'POST', ca, ...(worker ? { cert: worker.cert, key: worker.key } : {}),
      minVersion: 'TLSv1.3', rejectUnauthorized: true, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000) }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject); request.end(body)
  })
}
async function readBody(request: Parameters<RequestListener>[0]) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

describe('E3 real loopback mTLS transport with fixture authority and host', () => {
  it('round-trips signed descriptor and nonce-bound response with idempotent fixture create', async () => {
    const fixture = fixtureBroker()
    const { endpoint } = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock))
    const runner = client(endpoint)
    expect(await runner.call(fixture.operation, new AbortController().signal)).toMatchObject({ origin: 'fixture', status: 'ready' })
    expect(await runner.call(fixture.operation, new AbortController().signal)).toMatchObject({ origin: 'fixture', status: 'ready' })
    expect(fixture.creates()).toBe(1)
    // A new pinned client must not inherit an earlier global-agent TLS session.
    await expect(client(endpoint, { serverCertificateSha256: 'b'.repeat(64) }).call(fixture.operation, new AbortController().signal)).rejects.toThrow()
  })
  it('refuses absent/untrusted certificates at TLS and a trusted non-allowlisted worker at broker admission', async () => {
    const fixture = fixtureBroker()
    const { endpoint } = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock))
    const body = JSON.stringify({ ...fixture.operation, requestId: id(60) })
    await expect(rawRequest(endpoint, body, null)).rejects.toThrow()
    await expect(rawRequest(endpoint, body, untrustedWorker)).rejects.toThrow()
    expect(await rawRequest(endpoint, body, otherWorker)).toMatchObject({ status: 403, body: '{"code":"UNAUTHORIZED"}' })
    expect(fixture.creates()).toBe(0)
  })
  it('rejects a valid-CA server with a wrong hostname and a mismatched pinned certificate', async () => {
    const fixture = fixtureBroker()
    const { endpoint } = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock), wrongHostname)
    await expect(client(endpoint, { serverCertificateSha256: wrongHostname.fingerprint }).call(fixture.operation, new AbortController().signal)).rejects.toThrow('unavailable')
    const healthy = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock))
    await expect(client(healthy.endpoint, { serverCertificateSha256: 'b'.repeat(64) }).call(fixture.operation, new AbortController().signal)).rejects.toThrow('unavailable')
    expect(fixture.creates()).toBe(0)
  })
  it('rejects descriptor signature tampering despite an authenticated worker certificate', async () => {
    const fixture = fixtureBroker()
    const { endpoint } = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock))
    const tampered = { ...fixture.operation, signedDescriptor: { ...(fixture.operation.signedDescriptor as object), signature: 'A'.repeat(86) } }
    await expect(client(endpoint).call(tampered, new AbortController().signal)).rejects.toThrow('rejected')
    expect(fixture.creates()).toBe(0)
  })
  it.each(['nonce', 'response', 'key'] as const)('rejects authenticated broker response %s tampering', async kind => {
    const fixture = fixtureBroker()
    const { endpoint } = await listen(async (request, response) => {
      const body = await readBody(request)
      const signed = signResult(kind === 'nonce' ? { ...body, requestId: id(99) } : body, { origin: 'fixture' },
        'fixture-broker-key', kind === 'key' ? alternateSigning.privateKey : signing.privateKey, clock())
      if (kind === 'response') signed.response = { origin: 'runner' }
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(signed))
    })
    await expect(client(endpoint).call(fixture.operation, new AbortController().signal)).rejects.toThrow('UNAUTHORIZED')
  })
  it('enforces the request cap before authority/host dispatch', async () => {
    const fixture = fixtureBroker()
    const { endpoint } = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock))
    const outcome = await rawRequest(endpoint, 'x'.repeat(16385)).then(result => result.status, () => 0)
    expect(outcome).not.toBe(200); expect(fixture.dispatched()).toBe(0); expect(fixture.creates()).toBe(0)
    await expect(createMtlsTransport(config(endpoint)).send({ ...fixture.operation, signedDescriptor: 'x'.repeat(16385), requestId: id(90) }, new AbortController().signal)).rejects.toThrow('too large')
  })
  it('bounds oversized/malformed responses and does not follow redirects', async () => {
    const fixture = fixtureBroker()
    for (const behavior of ['oversized', 'malformed', 'redirect']) {
      const { endpoint } = await listen((_request, response) => {
        if (behavior === 'redirect') response.writeHead(302, { location: 'https://never-requested.invalid/' })
        else response.writeHead(200, { 'content-type': 'application/json' })
        response.end(behavior === 'oversized' ? 'x'.repeat(128 * 1024 + 1) : 'not-json')
      })
      await expect(client(endpoint).call(fixture.operation, new AbortController().signal)).rejects.toThrow()
    }
  })
  it('uses an absolute deadline despite a continuously trickling response', async () => {
    const fixture = fixtureBroker(); let chunks = 0
    const { endpoint } = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }); response.write('{')
      const timer = setInterval(() => { chunks++; response.write(' ') }, 10)
      response.on('close', () => clearInterval(timer))
    })
    const started = Date.now()
    await expect(client(endpoint, { absoluteTimeoutMs: 150 }).call(fixture.operation, new AbortController().signal)).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1500); expect(chunks).toBeGreaterThan(2)
  })
  it('cancels an in-flight response and bounds a trickling inbound body', async () => {
    const fixture = fixtureBroker(); let received!: () => void
    const entered = new Promise<void>(resolve => { received = resolve })
    const hanging = await listen((_request, response) => { response.writeHead(200); response.write('{'); received() })
    const stop = new AbortController()
    const call = client(hanging.endpoint).call(fixture.operation, stop.signal); await entered; stop.abort()
    await expect(call).rejects.toThrow()
    const { endpoint } = await listen(brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock, { bodyTimeoutMs: 150 }))
    const started = Date.now(); let written = 0
    await expect(new Promise<void>((resolve, reject) => {
      const request = httpsRequest(endpoint, { method: 'POST', ca, cert: workerIdentity.cert, key: workerIdentity.key,
        rejectUnauthorized: true, minVersion: 'TLSv1.3', headers: { 'content-type': 'application/json', 'content-length': '10000' }, signal: AbortSignal.timeout(2000) }, response => {
        response.resume(); response.on('end', resolve)
      })
      request.on('error', reject); request.write('{')
      const timer = setInterval(() => { written++; request.write(' ') }, 10)
      request.on('close', () => clearInterval(timer))
    })).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1500); expect(written).toBeGreaterThan(2); expect(fixture.dispatched()).toBe(0)
  })
  it('rejects deadlines that would remove or broaden the production bounds', () => {
    const fixture = fixtureBroker()
    for (const deadline of [0, -1, 250001, Number.POSITIVE_INFINITY]) expect(() => createMtlsTransport({ ...config('https://127.0.0.1:1/v1/broker'), absoluteTimeoutMs: deadline })).toThrow()
    for (const deadline of [0, -1, 10001, Number.NaN]) expect(() => brokerHttpHandler(fixture.broker, { keyId: 'fixture-broker-key', key: signing.privateKey }, clock, { bodyTimeoutMs: deadline })).toThrow()
  })
})
