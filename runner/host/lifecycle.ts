import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brokerDescriptorSchema, type BrokerDescriptorV1 } from '../../engine/contracts/review.ts'
import { canonicalHash } from '../../engine/contracts/canonical.ts'
import type { HostInventory } from './inventory.ts'
import { type HostRecord } from './inventory.ts'

/** These are observations from a trusted Linux supervisor, never guest assertions
 * or operator enablement flags. The real OS adapter has not been provided yet. */
const observationSchema = z.strictObject({ operationId: z.uuid(), launchAttemptId: z.uuid(),
  ingressAbsent: z.boolean(), launcherAbsent: z.boolean(), vmAbsent: z.boolean(), volumesAbsent: z.boolean(),
  appCredentialsAbsent: z.boolean(), observedAt: z.number().int() })
export type HostObservation = z.infer<typeof observationSchema>
export interface LinuxExecutor {
  readonly origin: 'fixture' | 'runner'
  /** Starts only pinned Firecracker/jailer, never guest commands on the host.
   * Resolve image/template digests only through the pinned host catalog. The executor
   * owns a per-attempt launcher unit whose absence can be observed. */
  launch(descriptor: BrokerDescriptorV1, attemptId: string, signal: AbortSignal): Promise<void>
  revokeIngress(descriptor: BrokerDescriptorV1, signal: AbortSignal): Promise<void>
  stopLauncherAndVm(descriptor: BrokerDescriptorV1, attemptId: string, signal: AbortSignal): Promise<void>
  wipeAppStorageAndCredentials(descriptor: BrokerDescriptorV1, signal: AbortSignal): Promise<void>
  observe(descriptor: BrokerDescriptorV1, attemptId: string, signal: AbortSignal): Promise<HostObservation>
}
export interface HostLimits { guests: number; cpu: number; memoryMiB: number; diskMiB: number }
function binding(d: BrokerDescriptorV1): string {
  const { issuedAt: _issuedAt, expiresAt: _expiresAt, leaseEpoch: _leaseEpoch, ...stable } = d
  void _issuedAt; void _expiresAt; void _leaseEpoch
  return canonicalHash(stable)
}
function status(record: HostRecord, origin: LinuxExecutor['origin']) {
  return { origin, operationId: record.descriptor.operationId, state: record.state,
    leaseEpoch: record.descriptor.leaseEpoch, resourcesReserved: record.resourcesReserved,
    resourcesDestroyed: !record.resourcesReserved, fencePersisted: record.tombstone, cleanupEvidenceDigest: record.cleanupEvidenceDigest }
}

/** Host-local lifecycle called only by the authenticated SandboxBroker driver.
 * No second control API, approvals database, or generic command endpoint. */
export class HostLeaseSupervisor {
  private readonly launches = new Map<string, AbortController>()
  private readonly pendingOs = new Map<string, Promise<unknown>>()
  private readonly cleaning = new Map<string, Promise<ReturnType<typeof status>>>()
  constructor(private readonly inventory: HostInventory, private readonly executor: LinuxExecutor,
    private readonly limits: HostLimits, private readonly now = Date.now, private readonly timeoutMs = 5000) {
    if (Object.values(limits).some(x => !Number.isSafeInteger(x) || x <= 0) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid host limits')
  }
  async create(input: unknown) {
    const d = brokerDescriptorSchema.parse(input)
    if (Date.parse(d.issuedAt) > this.now() || Date.parse(d.expiresAt) <= this.now()) throw new Error('Expired host lease')
    const admitted = await this.inventory.transaction(state => {
      if (this.now() < state.lastObservedAt) throw new Error('Host clock regressed')
      state.lastObservedAt = this.now()
      const prior = state.records[d.operationId]
      if (prior) {
        if (prior.bindingDigest !== binding(d) || prior.descriptor.leaseEpoch !== d.leaseEpoch || prior.tombstone) throw new Error('Host operation fenced')
        if (prior.state !== 'running') throw new Error('Host launch outcome uncertain')
        return { record: prior, fresh: false }
      }
      if (Object.values(state.records).some(x => x.descriptor.environmentId === d.environmentId || x.descriptor.appDatabaseId === d.appDatabaseId)) throw new Error('Host resource identity reused')
      const active = Object.values(state.records).filter(x => x.resourcesReserved)
      if (active.length >= this.limits.guests || (['cpu', 'memoryMiB', 'diskMiB'] as const).some(k => active.reduce((n, x) => n + x.descriptor.resources[k], d.resources[k]) > this.limits[k])) throw new Error('Host capacity retained')
      const record: HostRecord = { descriptor: d, bindingDigest: binding(d), launchAttemptId: randomUUID(), state: 'launching',
        createdAt: this.now(), tombstone: false, launchUncertain: true, resourcesReserved: true, ingressRevoked: false, cleanupEvidenceDigest: null }
      state.records[d.operationId] = record
      return { record, fresh: true }
    })
    if (!admitted.fresh) return status(admitted.record, this.executor.origin)
    const releaseActivity = this.inventory.beginExternalOperation()
    const controller = new AbortController(); this.launches.set(d.operationId, controller)
    let launchFailed = false
    const launch = Promise.resolve().then(async () => {
      const allowed = await this.inventory.transaction(state => !state.records[d.operationId].tombstone)
      if (!allowed) throw new Error('Host launch tombstoned before dispatch')
      controller.signal.throwIfAborted()
      return this.executor.launch(d, admitted.record.launchAttemptId, controller.signal)
    })
    // A timed-out/aborted call may settle late; keep it in the inventory until it
    // settles and never release capacity while its in-process invocation can act.
    const settled = launch.then(() => undefined, () => { launchFailed = true }).then(async () => {
      this.launches.delete(d.operationId)
      try {
        await this.inventory.transaction(state => {
          const current = state.records[d.operationId]
          if (current?.launchAttemptId === admitted.record.launchAttemptId) current.launchUncertain = false
        })
      } finally { releaseActivity() }
    })
    try {
      await this.deadline(settled, controller)
      const record = await this.inventory.transaction(state => {
        const current = state.records[d.operationId]
        if (launchFailed || current.tombstone || current.descriptor.leaseEpoch !== d.leaseEpoch || Date.parse(current.descriptor.expiresAt) <= this.now()) throw new Error('Host launch fenced or failed')
        current.state = 'running'; return current
      })
      return status(record, this.executor.origin)
    } catch {
      // Discard late launcher success. Persist tombstone before cleanup attempt.
      await this.destroy(d)
      throw new Error('Host launch uncertain or fenced')
    }
  }
  async renew(input: unknown) {
    const d = brokerDescriptorSchema.parse(input)
    const record = await this.inventory.transaction(state => {
      if (this.now() < state.lastObservedAt) throw new Error('Host clock regressed')
      state.lastObservedAt = this.now()
      const current = state.records[d.operationId]
      if (!current || current.tombstone || current.state !== 'running' || current.bindingDigest !== binding(d)
        || d.leaseEpoch < current.descriptor.leaseEpoch || Date.parse(current.descriptor.expiresAt) <= this.now()
        || Date.parse(d.issuedAt) > this.now() || Date.parse(d.expiresAt) <= Date.parse(current.descriptor.expiresAt)
        || this.now() - current.createdAt >= d.resources.activeMs) throw new Error('Host renewal fenced')
      current.descriptor = d; return current
    })
    return status(record, this.executor.origin)
  }
  async destroy(input: unknown) {
    const d = brokerDescriptorSchema.parse(input)
    const record = await this.inventory.transaction(state => {
      let current = state.records[d.operationId]
      if (!current) {
        if (Object.values(state.records).some(x => x.descriptor.environmentId === d.environmentId || x.descriptor.appDatabaseId === d.appDatabaseId)) throw new Error('Host resource identity reused')
        // A destroy arriving before create still permanently consumes this identity.
        current = { descriptor: d, bindingDigest: binding(d), launchAttemptId: randomUUID(), state: 'stopping', createdAt: this.now(),
          tombstone: true, launchUncertain: false, resourcesReserved: true, ingressRevoked: false, cleanupEvidenceDigest: null }
        state.records[d.operationId] = current
      }
      if (current.bindingDigest !== binding(d) || d.leaseEpoch < current.descriptor.leaseEpoch) throw new Error('Host cleanup fenced')
      current.descriptor = d; current.tombstone = true
      if (current.resourcesReserved) current.state = 'stopping'
      return current
    })
    this.launches.get(d.operationId)?.abort()
    if (!record.resourcesReserved) return status(record, this.executor.origin)
    const existing = this.cleaning.get(d.operationId)
    if (existing) return existing
    const cleanup = this.cleanup(record).finally(() => this.cleaning.delete(d.operationId))
    this.cleaning.set(d.operationId, cleanup)
    return cleanup
  }
  private async cleanup(record: HostRecord) {
    const releaseCleanup = this.inventory.beginExternalOperation()
    try {
      const d = record.descriptor; const launchWasPending = record.launchUncertain || this.launches.has(d.operationId)
      let observation: HostObservation | undefined; let observationRequestedAt = this.now()
      try { await this.call(`${d.operationId}:revoke`, signal => this.executor.revokeIngress(d, signal)) } catch { /* Stop anyway; no release until ingress absence is observed. */ }
      try {
        await this.call(`${d.operationId}:stop`, signal => this.executor.stopLauncherAndVm(d, record.launchAttemptId, signal))
        await this.call(`${d.operationId}:wipe`, signal => this.executor.wipeAppStorageAndCredentials(d, signal))
        observationRequestedAt = this.now()
        observation = observationSchema.parse(await this.call(`${d.operationId}:observe`, signal => this.executor.observe(d, record.launchAttemptId, signal)))
      } catch { /* Quarantine retains capacity. A later watchdog tick retries. */ }
      return await this.inventory.transaction(state => {
        const current = state.records[d.operationId]
        if (!current.tombstone || current.launchAttemptId !== record.launchAttemptId) throw new Error('Host cleanup identity conflict')
        const fresh = observation && observation.operationId === d.operationId && observation.launchAttemptId === record.launchAttemptId
          && observation.observedAt >= observationRequestedAt && observation.observedAt <= this.now() && this.now() - observation.observedAt <= this.timeoutMs
        const observedAbsent = observation && fresh && observation.ingressAbsent && observation.launcherAbsent && observation.vmAbsent
          && observation.volumesAbsent && observation.appCredentialsAbsent && !this.launches.has(d.operationId)
        const absent = observedAbsent && !launchWasPending
        // After a fenced supervisor restart, first confirm the old launcher is gone;
        // a second cleanup pass then supplies post-settlement absence evidence.
        if (observedAbsent) current.launchUncertain = false
        current.ingressRevoked = !!(observation && fresh && observation.ingressAbsent)
        current.state = absent ? 'destroyed' : 'quarantined'
        current.resourcesReserved = !absent
        if (absent) { current.launchUncertain = false; current.cleanupEvidenceDigest = canonicalHash(observation) }
        return status(current, this.executor.origin)
      })
    } finally { releaseCleanup() }
  }
  /** Independent host timer: no broker/control-plane connectivity is needed. A
   * backwards wall clock fences every guest, avoiding extended leases. */
  async tick() {
    const now = this.now()
    const expired = await this.inventory.transaction(state => {
      const clockRegressed = now < state.lastObservedAt; state.lastObservedAt = Math.max(now, state.lastObservedAt)
      return Object.values(state.records).filter(record => record.resourcesReserved
      && (clockRegressed || record.tombstone || Date.parse(record.descriptor.expiresAt) <= now
        || now - record.createdAt >= record.descriptor.resources.activeMs)).map(record => record.descriptor)
    })
    return Promise.all(expired.map(descriptor => this.destroy(descriptor)))
  }
  async snapshot() { return this.inventory.transaction(state => Object.values(state.records).map(record => status(record, this.executor.origin))) }
  private async call<T>(key: string, fn: (signal: AbortSignal) => Promise<T>) {
    if (this.pendingOs.has(key)) throw new Error('Previous host OS operation remains unsettled')
    const controller = new AbortController(); const release = this.inventory.beginExternalOperation()
    const operation = Promise.resolve().then(() => fn(controller.signal)).finally(() => { this.pendingOs.delete(key); release() })
    this.pendingOs.set(key, operation)
    return this.deadline(operation, controller)
  }
  private async deadline<T>(promise: Promise<T>, controller: AbortController): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Host operation deadline')) }, this.timeoutMs) })]) }
    finally { clearTimeout(timer) }
  }
}
