import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalHash, canonicalJson, sha256 } from '../../engine/contracts/canonical.ts'
import { runtimeImageDigest, runtimeImageSchema } from '../../runner/image/contract.ts'
import { GuestRpc, rpcMac, VsockTransport, type GuestTransport } from '../../runner/guest/protocol.ts'
import { FirecrackerLinuxExecutor, InstalledLinuxHelper, type LinuxHelper, type HelperAction } from '../../runner/host/linux-executor.ts'
import { FirecrackerDriver, type IsolatedExternalChecks } from '../../runner/firecracker-driver.ts'
import { HostInventory } from '../../runner/host/inventory.ts'
import { HostLeaseSupervisor } from '../../runner/host/lifecycle.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { UnavailableFirecrackerDriver } from '../../runner/hardened.ts'
import { descriptor, manifest, review, hash, id } from './fixtures.ts'

// All runtime calls below are explicit fixture transports/OS operations. The
// Unix socket test exercises framing only, not Linux vsock or isolation.
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const key = Buffer.alloc(32, 17)
const rpcBinding = { descriptor, attemptId: id(50), socketPath: '/fixture/rpc.sock', key }
function response(payload: Uint8Array, output: unknown) {
  const { mac: _mac, ...request } = JSON.parse(Buffer.from(payload).toString()); void _mac
  const body = { requestId: request.requestId, requestDigest: canonicalHash(request), ok: true, output }
  return Buffer.from(canonicalJson({ ...body, mac: rpcMac(key, body) }))
}
const asset = (name: string) => ({ path: `/opt/forge/${name}`, sha256: hash })
const image = { schemaVersion: 1, architecture: 'x86_64', isolation: 'firecracker-jailer-vsock-v1',
  templateInputsDigest: hash, imageInputsDigest: hash, guestAgentDigest: hash,
  assets: Object.fromEntries(['firecracker', 'jailer', 'guestKernel', 'guestRootfs', 'dependencyCache', 'seccompFilter', 'supervisor'].map(n => [n, asset(n)])) }

describe('Task02 image and RPC contracts (fixture evidence)', () => {
  it('binds all image assets, accepts no final circular template digest or tag', () => {
    const parsed = runtimeImageSchema.parse(image)
    expect(runtimeImageDigest(image)).toBe(`sha256:${canonicalHash(parsed)}`)
    for (const name of Object.keys(parsed.assets) as (keyof typeof parsed.assets)[]) {
      const changed = structuredClone(parsed); changed.assets[name].sha256 = sha256(name)
      expect(runtimeImageDigest(changed)).not.toBe(runtimeImageDigest(image))
    }
    expect(() => runtimeImageDigest({ ...image, templateDigest: hash })).toThrow()
    expect(() => runtimeImageDigest({ ...image, architecture: 'arm64' })).toThrow()
  })
  it('keeps source/catalog hashing acyclic', () => {
    const imageDigest = runtimeImageDigest(image)
    const finalCatalog = canonicalHash({ files: manifest.files, imageDigest })
    expect(finalCatalog).toMatch(/^[a-f0-9]{64}$/)
    expect(imageDigest).toBe(runtimeImageDigest(image))
  })
  it('authenticates response and exact request identity', async () => {
    const rpc = new GuestRpc({ exchange: async (_path, payload) => response(payload, { alive: true }) })
    expect(await rpc.call(rpcBinding, 'http', {}, AbortSignal.timeout(1000))).toEqual({ alive: true })
    const forged = new GuestRpc({ exchange: async (_path, payload) => {
      const value = JSON.parse(response(payload, {}).toString()); value.output = { forged: true }
      return Buffer.from(JSON.stringify(value))
    } })
    await expect(forged.call(rpcBinding, 'http', {}, AbortSignal.timeout(1000))).rejects.toThrow('Unauthenticated')
    const mismatch = new GuestRpc({ exchange: async (_path, payload) => {
      const value = JSON.parse(response(payload, {}).toString()); delete value.mac; value.requestId = id(91)
      return Buffer.from(canonicalJson({ ...value, mac: rpcMac(key, value) }))
    } })
    await expect(mismatch.call(rpcBinding, 'http', {}, AbortSignal.timeout(1000))).rejects.toThrow('mismatched')
  })
  it('enforces frame caps even when injected transport ignores caps', async () => {
    const rpc = new GuestRpc({ exchange: async () => Buffer.alloc(1048577) })
    await expect(rpc.call(rpcBinding, 'http', {}, AbortSignal.timeout(1000))).rejects.toThrow('cap')
  })
  it('reads split Firecracker handshake and length frame through a real local Unix socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-vsock-fixture-')); cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'rpc.sock'); const payload = Buffer.from('{}')
    const server = createServer(socket => {
      let handshake = false
      socket.on('data', data => {
        if (!handshake) { expect(data.toString()).toBe('CONNECT 4100\n'); handshake = true; socket.write('O'); setImmediate(() => socket.write('K 1234\n')) }
        else { const header = Buffer.alloc(4); header.writeUInt32BE(payload.length); socket.write(header.subarray(0, 2)); setImmediate(() => socket.write(Buffer.concat([header.subarray(2), payload]))) }
      })
    })
    await new Promise<void>(resolve => server.listen(path, resolve)); cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    expect(Buffer.from(await new VsockTransport().exchange(path, payload, AbortSignal.timeout(1000))).toString()).toBe('{}')
  })
  it('rejects truncated/oversized Unix frames and pre-aborted requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-frame-fixture-')); cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'rpc.sock')
    const server = createServer(socket => socket.once('data', () => { const header = Buffer.alloc(4); header.writeUInt32BE(1048577); socket.end(Buffer.concat([Buffer.from('OK 9\n'), header])) }))
    await new Promise<void>(resolve => server.listen(path, resolve)); cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    await expect(new VsockTransport().exchange(path, Buffer.from('{}'), AbortSignal.timeout(1000))).rejects.toThrow('cap')
    expect(() => new VsockTransport().exchange(path, Buffer.from('{}'), AbortSignal.abort())).toThrow()
  })
  it('retains unavailable default and rejects host fallback on macOS', async () => {
    await expect(new UnavailableFirecrackerDriver().assertAvailable()).rejects.toThrow('UNAVAILABLE')
    if (process.platform !== 'linux') await expect(new InstalledLinuxHelper().call('preflight', descriptor, null, AbortSignal.timeout(1000))).rejects.toThrow('Linux')
  })
  it('runs Python OS/guest fault simulations without executing candidate code', () => {
    expect(execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests/runner'], { encoding: 'utf8', timeout: 10000, stdio: 'pipe' })).toBe('')
  })
})

class FixtureHelper implements LinuxHelper {
  readonly origin = 'fixture' as const
  calls: HelperAction[] = []; bindings = 0; fenceAt = Infinity
  async call(action: HelperAction) {
    this.calls.push(action)
    if (action === 'binding') {
      if (++this.bindings >= this.fenceAt) throw new Error('Fixture lease fenced')
      return { attemptId: id(50), key: key.toString('hex'), socketPath: `/var/lib/forge/jailer/firecracker/${id(50)}/root/rpc.sock` }
    }
    return {}
  }
}
async function fixture(transport?: GuestTransport) {
  const dir = await mkdtemp(join(tmpdir(), 'forge-driver-fixture-')); cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const inventory = await HostInventory.acquire(dir); cleanup.push(() => inventory.close())
  const helper = new FixtureHelper(); const executor = new FirecrackerLinuxExecutor(helper)
  const supervisor = new HostLeaseSupervisor(inventory, executor, { guests: 1, cpu: 2, memoryMiB: 4096, diskMiB: 8192 })
  const commandPolicy = templateCommandPolicy(descriptor.resources)
  const m = { ...manifest, commandPolicyDigest: canonicalHash(commandPolicy) }
  const r = { ...review, migrationBundleDigest: canonicalHash(m.migrations), candidateDigest: canonicalHash(m), commandPolicy, policyDigest: canonicalHash(commandPolicy) }
  const d = { ...descriptor, sourceManifestDigest: canonicalHash(m), executionReviewDigest: canonicalHash(r), commandPolicyDigest: r.policyDigest }
  const external: IsolatedExternalChecks = { origin: 'fixture', run: async () => { throw new Error('Separate isolated harness unavailable') } }
  const evidence: Uint8Array[] = []
  const driver = new FirecrackerDriver(supervisor, executor, new GuestRpc(transport ?? { exchange: async (_path, payload) => response(payload, { status: 200, headers: {}, body: 'b2s=' }) }),
    async () => ({ manifest: m, review: r, readBlob: async () => Buffer.from('fixture base') }), external,
    { begin: async () => ({ write: async () => {}, finish: async () => id(90), abort: async () => {} }) }, async bytes => { evidence.push(bytes) })
  return { driver, helper, d, commandPolicy, evidence }
}
describe('Task02 driver integration (fixture only)', () => {
  it('never upgrades fixture helper/external harness to runner origin', async () => { expect((await fixture()).driver.origin).toBe('fixture') })
  it('checks lease before and after HTTP; late response is discarded', async () => {
    const s = await fixture(); s.helper.fenceAt = 2
    await expect(s.driver.requestApp(s.d, { method: 'GET', path: '/', headers: {}, body: new Uint8Array() }, AbortSignal.timeout(1000))).rejects.toThrow('fenced')
    expect(s.helper.bindings).toBe(2)
  })
  it('requires actual guest database and process health, not a process-only reply', async () => {
    const healthy = await fixture({ exchange: async (_path, payload) => response(payload, { processReady: true, databaseReady: true }) })
    expect(await healthy.driver.health(healthy.d, AbortSignal.timeout(1000))).toEqual({ processReady: true, databaseReady: true })
    const unhealthy = await fixture({ exchange: async (_path, payload) => response(payload, { processReady: true, databaseReady: false }) })
    await expect(unhealthy.driver.health(unhealthy.d, AbortSignal.timeout(1000))).rejects.toThrow()
  })
  it('denies provider/control credentials and arbitrary upstream URLs', async () => {
    const s = await fixture()
    for (const headers of ([{ authorization: 'synthetic-canary' }, { cookie: 'synthetic-canary' }, { host: 'metadata' }] as Record<string, string>[]))
      await expect(s.driver.requestApp(s.d, { method: 'GET', path: '/', headers, body: new Uint8Array() }, AbortSignal.timeout(1000))).rejects.toThrow()
    for (const path of ['http://169.254.169.254/', '//localhost/', '/\r\nHost: metadata'])
      await expect(s.driver.requestApp(s.d, { method: 'GET', path, headers: {}, body: new Uint8Array() }, AbortSignal.timeout(1000))).rejects.toThrow()
    expect(s.helper.calls).toEqual([])
  })
  it('filters unsafe response headers and rejects redirects', async () => {
    const s = await fixture({ exchange: async (_path, payload) => response(payload, { status: 200, headers: { 'set-cookie': 'bad', 'content-type': 'text/plain' }, body: 'b2s=' }) })
    expect(await s.driver.requestApp(s.d, { method: 'GET', path: '/', headers: {}, body: new Uint8Array() }, AbortSignal.timeout(1000)))
      .toEqual({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('ok') })
    const redirect = await fixture({ exchange: async (_path, payload) => response(payload, { status: 302, headers: {}, body: '' }) })
    await expect(redirect.driver.requestApp(redirect.d, { method: 'GET', path: '/', headers: {}, body: new Uint8Array() }, AbortSignal.timeout(1000))).rejects.toThrow('redirect')
  })
  it('rejects changed source and shell/command injection before guest dispatch', async () => {
    const s = await fixture(); const build = s.commandPolicy.commands.find(c => c.checkId === 'build')!
    await expect(s.driver.runCheck({ ...s.d, sourceManifestDigest: hash }, build, hash)).rejects.toThrow('binding')
    await expect(s.driver.runCheck(s.d, { ...build, argv: ['build; env'] }, s.d.sourceManifestDigest)).rejects.toThrow('command')
    expect(s.helper.calls).toEqual([])
  })
  it('records guest failures bound to image/source rather than reading success text', async () => {
    const s = await fixture({ exchange: async (_path, payload) => response(payload, { exitCode: 1, timedOut: false, oom: true, log: 'success' }) })
    const result = await s.driver.runCheck(s.d, s.commandPolicy.commands.find(c => c.checkId === 'build')!, s.d.sourceManifestDigest)
    expect(result).toMatchObject({ exitCode: 1, oom: true })
    expect(result.evidenceDigest).toBe(sha256(s.evidence[0]))
    expect(JSON.parse(Buffer.from(s.evidence[0]).toString())).toMatchObject({ origin: 'fixture', imageDigest: s.d.imageDigest, sourceManifestDigest: s.d.sourceManifestDigest })
  })
  it('does not substitute a local browser process for missing isolated harness', async () => {
    const s = await fixture()
    await expect(s.driver.runCheck(s.d, s.commandPolicy.commands.find(c => c.checkId === 'migration-prior')!, s.d.sourceManifestDigest)).rejects.toThrow('isolated harness unavailable')
  })
})
