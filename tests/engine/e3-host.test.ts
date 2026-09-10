import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostInventory } from '../../runner/host/inventory.ts'
import { HostLeaseSupervisor, type LinuxExecutor } from '../../runner/host/lifecycle.ts'
import { preflightLinuxHost, type PreflightIO } from '../../runner/host/preflight.ts'
import { watchHost } from '../../runner/host/watchdog.ts'
import { descriptor, id, now, hash } from './fixtures.ts'

// Explicit OS fakes only. These tests never invoke Firecracker, KVM, nft or systemd.
class FixtureOS implements LinuxExecutor {
  readonly origin = 'fixture' as const
  events: string[] = []; vm = false; ingress = false; volume = false; credentials = false
  stopFails = false; observationFails = false; pending: (() => Promise<void>) | undefined
  time = Date.parse(now)
  async launch() { this.events.push('launch'); await this.pending?.(); this.vm = true; this.ingress = true; this.volume = true; this.credentials = true }
  async revokeIngress() { this.events.push('revoke'); this.ingress = false }
  async stopLauncherAndVm() { this.events.push('stop'); if (this.stopFails) throw new Error('fixture partition'); this.vm = false }
  async wipeAppStorageAndCredentials() { this.events.push('wipe'); this.volume = false; this.credentials = false }
  async observe(d: typeof descriptor, attemptId: string) {
    this.events.push('observe'); if (this.observationFails) throw new Error('fixture observation unavailable')
    return { operationId: d.operationId, launchAttemptId: attemptId, ingressAbsent: !this.ingress,
      launcherAbsent: true, vmAbsent: !this.vm, volumesAbsent: !this.volume, appCredentialsAbsent: !this.credentials, observedAt: this.time }
  }
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })
async function fixture(timeoutMs = 1000) {
  const root = await mkdtemp(join(tmpdir(), 'forge-host-fixture-'))
  cleanup.push(() => rm(root, { force: true, recursive: true }))
  const inventory = await HostInventory.acquire(root); let closed = false
  cleanup.push(async () => { if (!closed) await inventory.close() })
  const os = new FixtureOS()
  const limits = { guests: 1, cpu: 2, memoryMiB: 4096, diskMiB: 8192 }
  const host = new HostLeaseSupervisor(inventory, os, limits, () => os.time, timeoutMs)
  return { root, inventory, os, host, limits, close: async () => { await inventory.close(); closed = true } }
}
describe('E3 durable host inventory/watchdog using explicit OS fakes', () => {
  it('stores idempotent create and denies a second lifetime owner', async () => {
    const s = await fixture(); await s.host.create(descriptor); await s.host.create(descriptor)
    expect(s.os.events).toEqual(['launch'])
    await expect(HostInventory.acquire(s.root)).rejects.toThrow()
    expect(await s.host.snapshot()).toEqual([expect.objectContaining({ origin: 'fixture', resourcesReserved: true })])
  })
  it('expires after control partition, revokes before stopping and confirms inventory', async () => {
    const s = await fixture(); await s.host.create(descriptor); s.os.time += 60001
    expect(await s.host.tick()).toEqual([expect.objectContaining({ state: 'destroyed', resourcesDestroyed: true, fencePersisted: true })])
    expect(s.os.events).toEqual(['launch', 'revoke', 'stop', 'wipe', 'observe'])
    await expect(s.host.renew({ ...descriptor, issuedAt: new Date(s.os.time).toISOString(), expiresAt: new Date(s.os.time + 60000).toISOString() })).rejects.toThrow('fenced')
  })
  it('quarantines failed cleanup and retains quota until positive observation', async () => {
    const s = await fixture(); await s.host.create(descriptor); s.os.stopFails = true
    expect(await s.host.destroy(descriptor)).toMatchObject({ state: 'quarantined', resourcesReserved: true, fencePersisted: true })
    await expect(s.host.create({ ...descriptor, operationId: id(50), environmentId: id(51), appDatabaseId: id(52) })).rejects.toThrow('capacity')
    s.os.stopFails = false; s.os.observationFails = true
    expect(await s.host.destroy(descriptor)).toMatchObject({ resourcesReserved: true })
    s.os.observationFails = false
    expect(await s.host.destroy(descriptor)).toMatchObject({ resourcesDestroyed: true })
    const count = s.os.events.length; await s.host.destroy(descriptor); expect(s.os.events.length).toBe(count)
  })
  it('persists tombstone over restart and denies late create/resource reuse', async () => {
    const s = await fixture(); await s.host.destroy(descriptor); await s.close()
    const reopened = await HostInventory.acquire(s.root); cleanup.push(() => reopened.close())
    const host = new HostLeaseSupervisor(reopened, s.os, s.limits, () => s.os.time)
    await expect(host.create(descriptor)).rejects.toThrow('fenced')
    await expect(host.create({ ...descriptor, operationId: id(55) })).rejects.toThrow('reused')
    await expect(host.destroy({ ...descriptor, operationId: id(56) })).rejects.toThrow('reused')
    expect(await host.destroy(descriptor)).toMatchObject({ resourcesDestroyed: true })
  })
  it('retains reservation while uncooperative launch is pending, then kills late success', async () => {
    const s = await fixture(); let release!: () => void; let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    s.os.pending = () => { started(); return new Promise<void>(resolve => { release = resolve }) }
    const launch = s.host.create(descriptor); await entered
    await expect(s.inventory.close()).rejects.toThrow('unsettled')
    expect(await s.host.destroy(descriptor)).toMatchObject({ state: 'quarantined', resourcesReserved: true })
    release(); await expect(launch).rejects.toThrow('uncertain')
    expect(s.os.vm).toBe(false)
    expect(await s.host.snapshot()).toEqual([expect.objectContaining({ state: 'destroyed', resourcesReserved: false })])
  })
  it('expired launch is bounded and cannot release its reservation before settling', async () => {
    const s = await fixture(500); let release!: () => void; let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    s.os.pending = () => { started(); return new Promise<void>(resolve => { release = resolve }) }
    const pending = s.host.create(descriptor); await entered
    await expect(pending).rejects.toThrow('uncertain')
    expect(await s.host.snapshot()).toEqual([expect.objectContaining({ resourcesReserved: true })])
    release(); await new Promise(resolve => setTimeout(resolve, 10))
    expect(await s.host.tick()).toEqual([expect.objectContaining({ resourcesDestroyed: true })])
  })
  it('rejects absence captured before a delayed launch settles', async () => {
    const s = await fixture(); let releaseLaunch!: () => void; let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    s.os.pending = () => { entered(); return new Promise<void>(resolve => { releaseLaunch = resolve }) }
    const launch = s.host.create(descriptor); await started
    const originalObserve = s.os.observe.bind(s.os)
    let releaseObservation!: () => void; let captured!: () => void
    const capturedObservation = new Promise<void>(resolve => { captured = resolve })
    let firstObservation = true
    s.os.observe = async (d, attempt) => {
      if (!firstObservation) return originalObserve(d, attempt)
      firstObservation = false
      const prior = await originalObserve(d, attempt); captured()
      await new Promise<void>(resolve => { releaseObservation = resolve }); return prior
    }
    const destruction = s.host.destroy(descriptor); await capturedObservation
    releaseLaunch()
    await expect.poll(() => s.inventory.transaction(state => state.records[descriptor.operationId].launchUncertain), { interval: 5 }).toBe(false)
    releaseObservation()
    expect(await destruction).toMatchObject({ resourcesReserved: true, state: 'quarantined' })
    await expect(launch).rejects.toThrow('uncertain')
    s.os.observe = originalObserve
    await s.host.tick()
    expect(await s.host.snapshot()).toEqual([expect.objectContaining({ resourcesDestroyed: true })])
    expect(s.os.vm).toBe(false)
  })
  it('retains ownership while cleanup callbacks run and rejects prior observations', async () => {
    const s = await fixture(); await s.host.create(descriptor)
    let release!: () => void; let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const original = s.os.stopLauncherAndVm.bind(s.os)
    s.os.stopLauncherAndVm = async () => { entered(); await new Promise<void>(resolve => { release = resolve }); await original() }
    const pending = s.host.destroy(descriptor); await started
    await expect(s.inventory.close()).rejects.toThrow('unsettled')
    release(); expect(await pending).toMatchObject({ resourcesDestroyed: true })
    await s.close()
  })
  it('does not use an observation from before the current cleanup request', async () => {
    const s = await fixture(); await s.host.create(descriptor)
    const observe = s.os.observe.bind(s.os)
    s.os.observe = async (d, attempt) => ({ ...await observe(d, attempt), observedAt: s.os.time - 1 })
    expect(await s.host.destroy(descriptor)).toMatchObject({ resourcesReserved: true })
  })
  it('higher epoch fences old cleanup; a backwards clock fails closed', async () => {
    const s = await fixture(); await s.host.create(descriptor); s.os.time += 15000
    await s.host.renew({ ...descriptor, leaseEpoch: 2, issuedAt: new Date(s.os.time).toISOString(), expiresAt: new Date(s.os.time + 60000).toISOString() })
    await expect(s.host.destroy(descriptor)).rejects.toThrow('fenced')
    await s.host.tick(); s.os.time -= 1000
    expect(await s.host.tick()).toEqual([expect.objectContaining({ state: 'destroyed' })])
  })
  it('watchdog runs independently and can be stopped without starting a guest', async () => {
    const s = await fixture(); await s.host.create(descriptor); s.os.time += 60001
    const stop = new AbortController(); const errors: Error[] = []
    const running = watchHost(s.host, stop.signal, error => errors.push(error), 100)
    await new Promise(resolve => setTimeout(resolve, 30)); stop.abort(); await running
    expect(errors).toEqual([])
    expect(await s.host.snapshot()).toEqual([expect.objectContaining({ resourcesDestroyed: true })])
  })
})

function preflightFixture() {
  const assets = Object.fromEntries(['firecracker', 'jailer', 'guestKernel', 'guestRootfs', 'dependencyCache', 'seccompFilter', 'supervisor'].map(name => [name, { path: `/opt/forge/${name}`, sha256: hash }]))
  const io: PreflightIO = { platform: 'linux', async inspect(path) { return { realPath: path, regularFile: !['/opt', '/opt/forge', '/dev/kvm'].includes(path), directory: ['/opt', '/opt/forge'].includes(path), characterDevice: path === '/dev/kvm', owner: 0, mode: 0o555 } },
    async read(path) { return Buffer.from(path.includes('cgroup.controllers') ? 'cpu memory pids io' : '1') }, async accessible() {}, async sha256() { return hash } }
  return { input: { schemaVersion: 1, assets }, io }
}
describe('E3 read-only preflight with explicit fake Linux facts', () => {
  it('verifies facts without granting execution', async () => { const s = preflightFixture(); expect(await preflightLinuxHost(s.input, s.io)).toMatchObject({ status: 'preflight-only', executionEnabled: false }) })
  it('rejects macOS before inspecting or executing anything', async () => { const s = preflightFixture(); s.io.platform = 'darwin'; await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow('Linux') })
  it.each(['0', '', 'garbage', '3', '11', ' '.repeat(4097)])('rejects malformed/enabled BPF fact %j', async value => {
    const s = preflightFixture(); const read = s.io.read
    s.io.read = async path => path.includes('unprivileged_bpf') ? Buffer.from(value) : read(path)
    await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow()
  })
  it('rejects missing KVM, cgroup controllers, digest drift, writable assets and aliases', async () => {
    let s = preflightFixture(); s.io.accessible = async () => { throw new Error('KVM unavailable') }; await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow('KVM')
    s = preflightFixture(); s.io.read = async () => Buffer.from('cpu'); await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow('controllers')
    s = preflightFixture(); s.io.sha256 = async () => 'b'.repeat(64); await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow('hash')
    s = preflightFixture(); const inspect = s.io.inspect; s.io.inspect = async path => ({ ...await inspect(path), mode: 0o777 }); await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow('asset')
    s = preflightFixture(); const original = s.io.inspect; s.io.inspect = async path => ({ ...await original(path), realPath: path === '/opt/forge' ? '/tmp/alias' : path }); await expect(preflightLinuxHost(s.input, s.io)).rejects.toThrow('parent')
  })
})
