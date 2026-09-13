import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SandboxBroker, type HostDriver, type CheckResult } from '../../runner/broker.ts'
import { FileJournal } from '../../runner/journal.ts'
import { signDescriptor, verifyDescriptor, signResult, verifyResult } from '../../runner/auth.ts'
import { UnavailableFirecrackerDriver } from '../../runner/hardened.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
import { descriptor as base, review as initialReview, approval as initialApproval, context as initialContext, resources, now, hash, id } from './fixtures.ts'
import type { BrokerDescriptorV1 } from '../../engine/contracts/review.ts'

const keys = generateKeyPairSync('ed25519')
const peer = { authorized: true as const, certificateSha256: hash }
const clockStart = Date.parse(now)
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
class FixtureDriver implements HostDriver {
  readonly origin = 'fixture' as const
  creates = 0; runs = 0; destroys = 0; collections = 0; failCreate = false; cleanup = true
  pending: (() => Promise<void>) | undefined
  createPending: (() => Promise<void>) | undefined
  tombstones = new Set<string>()
  alive = new Set<string>()
  async assertAvailable() {}
  async create(d: BrokerDescriptorV1) { this.creates++; await this.createPending?.(); if (this.failCreate || this.tombstones.has(d.operationId)) throw new Error('fixture fenced or lost acknowledgement'); this.alive.add(d.operationId) }
  async renew() {}
  async runCheck(_d: BrokerDescriptorV1, command: Parameters<HostDriver['runCheck']>[1]): Promise<CheckResult> {
    this.runs++; await this.pending?.()
    return { checkId: command.checkId, startedAt: now, finishedAt: now, exitCode: 0, timedOut: false, oom: false, evidenceDigest: hash }
  }
  async collect() { this.collections++; return { buildOutputDigest: hash } }
  async destroy(d: BrokerDescriptorV1) { this.destroys++; if (this.cleanup) { this.tombstones.add(d.operationId); this.alive.delete(d.operationId) }; return { resourcesDestroyed: this.cleanup, fencePersisted: this.cleanup } }
}
async function setup(driver: HostDriver = new FixtureDriver()) {
  const dir = await mkdtemp(join(tmpdir(), 'forge-e3-')); dirs.push(dir)
  let time = clockStart
  const commandPolicy = templateCommandPolicy(resources)
  const review = { ...initialReview, commandPolicy, policyDigest: canonicalHash(commandPolicy) }
  const approval = { ...initialApproval, subjectDigest: canonicalHash(review) }
  const context = { ...initialContext, subjectDigest: canonicalHash(review), policyDigest: review.policyDigest }
  const descriptor = { ...base, executionReviewDigest: canonicalHash(review), commandPolicyDigest: review.policyDigest }
  const options = { journal: new FileJournal(dir), driver, keys: new Map([['test', keys.publicKey]]), workerFingerprints: new Set([hash]),
    authority: async () => ({ review, approval, context: { ...context, now: new Date(time).toISOString() }, currentEpoch: descriptor.leaseEpoch }),
    capacity: { global: 2, workspace: 1, cpu: 4, memoryMiB: 8192, diskMiB: 16384 }, clock: () => time }
  const broker = new SandboxBroker(options)
  const call = (action: 'create' | 'status' | 'renew' | 'runCheck' | 'collect' | 'destroy', d = descriptor,
    extra = {}) => broker.dispatch(peer, { action, signedDescriptor: signDescriptor(d, 'test', keys.privateKey), ...extra })
  return { broker, options, descriptor, call, advance: (ms: number) => { time += ms }, review, context }
}
describe('E3 broker protocol with EXPLICIT fixture host; no isolation acceptance', () => {
  it('verifies Ed25519 signature, key allowlist, bytes, expiry and peer', async () => {
    const signed = signDescriptor(base, 'test', keys.privateKey)
    expect(verifyDescriptor(signed, new Map([['test', keys.publicKey]]), clockStart).descriptor).toEqual(base)
    expect(() => verifyDescriptor(signed, new Map(), clockStart)).toThrow('UNAUTHORIZED')
    expect(() => verifyDescriptor({ ...signed, signature: 'A'.repeat(86) }, new Map([['test', keys.publicKey]]), clockStart)).toThrow('UNAUTHORIZED')
    expect(() => verifyDescriptor(signed, new Map([['test', keys.publicKey]]), clockStart + 60000)).toThrow('STALE')
    const { broker } = await setup()
    await expect(broker.dispatch({ ...peer, certificateSha256: 'b'.repeat(64) }, {})).rejects.toThrow('UNAUTHORIZED')
  })
  it('authenticates response to exact nonce/request and expiry', () => {
    const request = { nonce: id(40) }; const response = { origin: 'fixture' }
    const signed = signResult(request, response, 'test', keys.privateKey, clockStart)
    expect(verifyResult(signed, request, new Map([['test', keys.publicKey]]), clockStart)).toEqual(response)
    expect(() => verifyResult(signed, { nonce: id(41) }, new Map([['test', keys.publicKey]]), clockStart)).toThrow('UNAUTHORIZED')
    expect(() => verifyResult(signed, request, new Map([['test', keys.publicKey]]), clockStart + 30000)).toThrow('UNAUTHORIZED')
  })
  it('persists idempotent create and check across broker restart', async () => {
    const driver = new FixtureDriver(); const s = await setup(driver)
    await s.call('create'); await s.call('create')
    expect(driver.creates).toBe(1)
    const request = { action: 'runCheck', signedDescriptor: signDescriptor(s.descriptor, 'test', keys.privateKey), checkId: 'source-policy', inputDigest: s.descriptor.sourceManifestDigest }
    const first = await s.broker.dispatch(peer, request)
    expect(await new SandboxBroker(s.options).dispatch(peer, request)).toEqual(first)
    expect(driver.runs).toBe(1)
    expect(first).toMatchObject({ origin: 'fixture' })
  })
  it('rejects unapproved commands, out-of-order checks, collection before checks, scope reuse', async () => {
    const s = await setup(); await s.call('create')
    await expect(s.call('runCheck', s.descriptor, { checkId: 'build', inputDigest: s.descriptor.sourceManifestDigest })).rejects.toThrow('CONFLICT')
    await expect(s.call('collect')).rejects.toThrow('CONFLICT')
    await expect(s.call('runCheck', s.descriptor, { checkId: 'source-policy', inputDigest: hash })).rejects.toThrow('INVALID')
    await expect(s.call('status', { ...s.descriptor, environmentId: id(99) })).rejects.toThrow('STALE')
    s.review.commandPolicy.commands[0].argv.push('--skip')
    await expect(s.call('create')).rejects.toThrow()
  })
  it('holds admission after uncertain create, releases only confirmed cleanup', async () => {
    const driver = new FixtureDriver(); driver.failCreate = true; driver.cleanup = false
    const s = await setup(driver)
    await expect(s.call('create')).rejects.toThrow('UNCERTAIN')
    await expect(s.call('create')).rejects.toThrow('STALE')
    expect(driver.creates).toBe(1)
    await expect(s.call('create', { ...s.descriptor, operationId: id(50), environmentId: id(51), appDatabaseId: id(52) })).rejects.toThrow('CAPACITY')
    expect(await s.call('destroy')).toMatchObject({ status: 'quarantined', cleanupConfirmed: false })
    driver.cleanup = true
    expect(await s.call('destroy')).toMatchObject({ status: 'destroyed', cleanupConfirmed: true })
    await s.call('destroy'); expect(driver.destroys).toBe(2)
  })
  it('host unavailability cannot create records or execute locally', async () => {
    const s = await setup(new UnavailableFirecrackerDriver())
    await expect(s.call('create')).rejects.toThrow('UNAVAILABLE')
    await expect(s.call('status')).rejects.toThrow('CONFLICT')
  })
  it('allows heartbeat/cancellation while check runs; late result cannot commit', async () => {
    const driver = new FixtureDriver(); const s = await setup(driver)
    let release!: () => void; let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    driver.pending = () => { started(); return new Promise<void>(resolve => { release = resolve }) }
    await s.call('create')
    const pending = s.call('runCheck', s.descriptor, { checkId: 'source-policy', inputDigest: s.descriptor.sourceManifestDigest })
    await entered
    s.advance(15000)
    await s.call('renew', { ...s.descriptor, issuedAt: new Date(clockStart + 15000).toISOString(), expiresAt: new Date(clockStart + 75000).toISOString() })
    await s.call('destroy'); release()
    await expect(pending).rejects.toThrow('STALE')
  })
  it('fixture host tombstone prevents delayed create after cleanup; broker never revives it', async () => {
    const driver = new FixtureDriver(); const s = await setup(driver)
    let release!: () => void; let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    driver.createPending = () => { entered(); return new Promise<void>(resolve => { release = resolve }) }
    const pending = s.call('create'); await started
    expect(await s.call('status')).toMatchObject({ status: 'creating' })
    expect(await s.broker.sweep()).toBe(1)
    release(); await expect(pending).rejects.toThrow('STALE')
    expect(driver.alive.size).toBe(0)
    expect(await s.call('status')).toMatchObject({ status: 'destroyed', cleanupConfirmed: true })
  })
  it('collects once only after every required check and persists its immutable digest', async () => {
    const driver = new FixtureDriver(); const s = await setup(driver); await s.call('create')
    for (const command of s.review.commandPolicy.commands) await s.call('runCheck', s.descriptor, { checkId: command.checkId, inputDigest: s.descriptor.sourceManifestDigest })
    const first = await s.call('collect')
    expect(first).toMatchObject({ buildOutputDigest: hash, origin: 'fixture' })
    expect(await s.call('collect')).toEqual(first)
    expect(driver.collections).toBe(1)
  })
  it('higher epoch fences old worker and cancellation still permits teardown', async () => {
    const s = await setup(); await s.call('create')
    const stale = { ...s.descriptor }
    s.advance(15000); s.descriptor.leaseEpoch = 2
    s.descriptor.issuedAt = new Date(clockStart + 15000).toISOString()
    s.descriptor.expiresAt = new Date(clockStart + 75000).toISOString()
    await s.call('renew')
    await expect(s.call('status', stale)).rejects.toThrow('STALE')
    s.context.cancelRequested = true
    await expect(s.call('runCheck', s.descriptor, { checkId: 'source-policy', inputDigest: s.descriptor.sourceManifestDigest })).rejects.toThrow()
    expect(await s.call('destroy')).toMatchObject({ cleanupConfirmed: true, leaseEpoch: 2 })
  })
  it('expired lease is swept and cannot be revived', async () => {
    const driver = new FixtureDriver(); const s = await setup(driver); await s.call('create')
    s.advance(61000); expect(await s.broker.sweep()).toBe(1)
    expect(driver.destroys).toBe(1)
    await expect(s.call('renew', { ...s.descriptor, issuedAt: new Date(clockStart + 61000).toISOString(), expiresAt: new Date(clockStart + 121000).toISOString() })).rejects.toThrow('STALE')
  })
})
