import type { KeyObject } from 'node:crypto'
import { z } from 'zod'
import { canonicalHash } from '../engine/contracts/canonical.ts'
import { checkId, digest } from '../engine/contracts/primitives.ts'
import { executionReviewSchema, validateDescriptor, type BrokerDescriptorV1, type ExecutionReviewV1 } from '../engine/contracts/review.ts'
import { assertTemplatePolicy } from '../templates/next-postgres-v1/policy.ts'
import { authorizePeer, BrokerError, verifyDescriptor, type TrustedPeer } from './auth.ts'
import type { FileJournal } from './journal.ts'
import { type LeaseRecord } from './journal.ts'

export const brokerRequestSchema = z.strictObject({ action: z.enum(['create', 'status', 'renew', 'runCheck', 'collect', 'destroy']),
  signedDescriptor: z.unknown(), checkId: checkId.optional(), inputDigest: digest.optional() })
export type BrokerRequest = z.infer<typeof brokerRequestSchema>
export interface CurrentAuthority { review: unknown; approval: unknown; context: unknown; currentEpoch: number }
export interface CheckResult { checkId: z.infer<typeof checkId>; startedAt: string; finishedAt: string; exitCode: number;
  timedOut: boolean; oom: boolean; evidenceDigest: string }
const resultSchema = z.strictObject({ checkId, startedAt: z.iso.datetime({ offset: true }), finishedAt: z.iso.datetime({ offset: true }),
  exitCode: z.number().int().min(0).max(255), timedOut: z.boolean(), oom: z.boolean(), evidenceDigest: digest })
export interface HostDriver {
  readonly origin: 'fixture' | 'runner'
  assertAvailable(descriptor: BrokerDescriptorV1): Promise<void>
  create(descriptor: BrokerDescriptorV1): Promise<void>
  renew(descriptor: BrokerDescriptorV1): Promise<void>
  runCheck(descriptor: BrokerDescriptorV1, command: ExecutionReviewV1['commandPolicy']['commands'][number], inputDigest: string): Promise<CheckResult>
  collect(descriptor: BrokerDescriptorV1): Promise<{ buildOutputDigest: string }>
  /** Host must durably tombstone operation/environment BEFORE revoking ingress and
   * teardown. A delayed create/renew MUST reject that tombstone across host restart.
   * Capacity is released only after both facts are authenticated and confirmed. */
  destroy(descriptor: BrokerDescriptorV1): Promise<{ resourcesDestroyed: boolean; fencePersisted: boolean }>
}
export interface BrokerOptions {
  journal: FileJournal; driver: HostDriver; keys: ReadonlyMap<string, KeyObject>; workerFingerprints: ReadonlySet<string>
  /** Must read current locked E1 authorization, cancellation and revocation state. */
  authority: (descriptor: BrokerDescriptorV1) => Promise<CurrentAuthority>
  capacity: { global: number; workspace: number; cpu: number; memoryMiB: number; diskMiB: number }
  clock?: () => number; driverTimeoutMs?: number
}
function identity(d: BrokerDescriptorV1): string {
  const { issuedAt: _issuedAt, expiresAt: _expiresAt, leaseEpoch: _leaseEpoch, ...stable } = d
  void _issuedAt; void _expiresAt; void _leaseEpoch
  return canonicalHash(stable)
}
function publicStatus(record: LeaseRecord) {
  return { operationId: record.descriptor.operationId, environmentId: record.descriptor.environmentId,
    leaseEpoch: record.descriptor.leaseEpoch, status: record.status, origin: record.origin, cleanupConfirmed: record.cleanupConfirmed }
}
export class SandboxBroker {
  private readonly now: () => number
  constructor(private readonly options: BrokerOptions) {
    this.now = options.clock ?? Date.now
    if (Object.values(options.capacity).some(n => !Number.isSafeInteger(n) || n < 1)) throw new BrokerError('INVALID')
  }
  async dispatch(peer: TrustedPeer, input: unknown): Promise<unknown> {
    authorizePeer(peer, this.options.workerFingerprints)
    const request = brokerRequestSchema.parse(input)
    const d = verifyDescriptor(request.signedDescriptor, this.options.keys, this.now()).descriptor
    if (request.action === 'runCheck' ? !request.checkId || !request.inputDigest : request.checkId !== undefined || request.inputDigest !== undefined) throw new BrokerError('INVALID')
    if (request.action === 'create') await this.bounded(() => this.options.driver.assertAvailable(d), this.options.driverTimeoutMs ?? 5000)
    const outcome = await this.options.journal.transaction(async (state, checkpoint) => {
      // Cleanup/status still require a valid signed scope, but remain available after revocation.
      let review: ExecutionReviewV1 | undefined
      if (request.action !== 'destroy' && request.action !== 'status') {
        const a = await this.bounded(() => this.options.authority(d), this.options.driverTimeoutMs ?? 5000)
        validateDescriptor(d, a.review, a.approval, a.context, a.currentEpoch)
        review = executionReviewSchema.parse(a.review)
        assertTemplatePolicy(review.commandPolicy)
      }
      let record = state.leases[d.operationId]
      if (record && (record.identityDigest !== identity(d) || d.leaseEpoch < record.descriptor.leaseEpoch)) throw new BrokerError('STALE')
      if (!record) {
        if (request.action !== 'create') throw new BrokerError('CONFLICT')
        const active = Object.values(state.leases).filter(x => !x.cleanupConfirmed)
        if (Object.values(state.leases).some(x => x.descriptor.environmentId === d.environmentId || x.descriptor.appDatabaseId === d.appDatabaseId)) throw new BrokerError('CONFLICT')
        const cap = this.options.capacity
        if (active.length >= cap.global || active.filter(x => x.descriptor.workspaceId === d.workspaceId).length >= cap.workspace
          || (['cpu', 'memoryMiB', 'diskMiB'] as const).some(k => active.reduce((n, x) => n + x.descriptor.resources[k], d.resources[k]) > cap[k])) throw new BrokerError('CAPACITY')
        record = { descriptor: d, identityDigest: identity(d), status: 'creating', createdAt: this.now(), checks: {},
          verificationStartedAt: null, buildOutputDigest: null, pendingHost: 'create', cleanupConfirmed: false, origin: this.options.driver.origin }
        state.leases[d.operationId] = record
        await checkpoint() // Intent must survive a crash before host acknowledgement.
        return () => this.hostOperation(d, 'create', () => this.options.driver.create(d))
      }
      if (request.action === 'status') return publicStatus(record)
      if (request.action === 'destroy') {
        if (record.cleanupConfirmed) return publicStatus(record)
        record.descriptor = d; record.status = 'stopping'; record.pendingHost = 'destroy'; await checkpoint()
        return () => this.hostOperation(d, 'destroy', () => this.options.driver.destroy(d))
      }
      if (record.pendingHost) throw new BrokerError('UNCERTAIN')
      if (record.status !== 'ready' || record.cleanupConfirmed || Date.parse(record.descriptor.expiresAt) <= this.now()) throw new BrokerError('STALE')
      if (request.action === 'create') {
        if (d.leaseEpoch !== record.descriptor.leaseEpoch) throw new BrokerError('STALE')
        return publicStatus(record)
      }
      if (request.action === 'renew') {
        if (Date.parse(d.expiresAt) <= Date.parse(record.descriptor.expiresAt) || this.now() - record.createdAt >= d.resources.activeMs) throw new BrokerError('STALE')
        record.descriptor = d; record.pendingHost = 'renew'; await checkpoint()
        return () => this.hostOperation(d, 'renew', () => this.options.driver.renew(d))
      }
      if (d.leaseEpoch !== record.descriptor.leaseEpoch) throw new BrokerError('STALE')
      if (this.now() - record.createdAt >= d.resources.activeMs) throw new BrokerError('STALE')
      if (request.action === 'collect') {
        if (!review || !review.commandPolicy.requiredChecks.every(id => {
          const result = record.checks[id]
          return result?.status === 'done' && resultSchema.parse(result.result).exitCode === 0 && !resultSchema.parse(result.result).timedOut && !resultSchema.parse(result.result).oom
        })) throw new BrokerError('CONFLICT')
        if (record.buildOutputDigest) return { ...publicStatus(record), buildOutputDigest: record.buildOutputDigest, checks: Object.values(record.checks).map(x => x.result) }
        record.pendingHost = 'collect'; await checkpoint()
        return () => this.hostOperation(d, 'collect', () => this.options.driver.collect(d))
      }
      if (!review || !request.checkId || !request.inputDigest) throw new BrokerError('INVALID')
      // No caller-chosen auxiliary inputs: every check consumes the approved source manifest.
      if (request.inputDigest !== d.sourceManifestDigest) throw new BrokerError('INVALID')
      const prior = record.checks[request.checkId]
      if (prior) {
        if (prior.inputDigest !== request.inputDigest) throw new BrokerError('CONFLICT')
        if (prior.status !== 'done') throw new BrokerError('UNCERTAIN')
        return { ...publicStatus(record), result: prior.result }
      }
      const commands = review.commandPolicy.commands
      const index = commands.findIndex(x => x.checkId === request.checkId)
      if (index < 0 || commands.slice(0, index).some(x => {
        const result = record.checks[x.checkId]
        return result?.status !== 'done' || resultSchema.parse(result.result).exitCode !== 0 || resultSchema.parse(result.result).timedOut || resultSchema.parse(result.result).oom
      })) throw new BrokerError('CONFLICT')
      record.verificationStartedAt ??= this.now()
      const remaining = Math.min(d.resources.verificationMs - (this.now() - record.verificationStartedAt), d.resources.activeMs - (this.now() - record.createdAt))
      if (remaining <= 0) throw new BrokerError('STALE')
      record.checks[request.checkId] = { inputDigest: request.inputDigest, status: 'pending' }; await checkpoint()
      const command = { ...commands[index], timeoutMs: Math.min(commands[index].timeoutMs, remaining) }
      const selectedCheck = request.checkId
      const selectedInput = request.inputDigest
      // Release the journal lock while guest code runs so heartbeat/cancellation can fence it.
      return async () => {
        let result: CheckResult
        try { result = resultSchema.parse(await this.bounded(() => this.options.driver.runCheck(d, command, selectedInput), command.timeoutMs)) }
        catch {
          await this.options.journal.transaction(async (latest, save) => {
            const current = latest.leases[d.operationId]
            if (current && current.descriptor.leaseEpoch === d.leaseEpoch && current.status === 'ready') {
              current.status = 'quarantined'; await save()
            }
          })
          throw new BrokerError('UNCERTAIN')
        }
        return this.options.journal.transaction(async (latest, save) => {
          const current = latest.leases[d.operationId]
          const authority = await this.bounded(() => this.options.authority(d), this.options.driverTimeoutMs ?? 5000)
          if (!current || current.status !== 'ready' || current.descriptor.leaseEpoch !== d.leaseEpoch
            || authority.currentEpoch !== d.leaseEpoch || Date.parse(current.descriptor.expiresAt) <= this.now()
            || this.now() - current.createdAt >= d.resources.activeMs
            || this.now() - (current.verificationStartedAt ?? 0) >= d.resources.verificationMs) throw new BrokerError('STALE')
          // The fresh lease is signed on renewal; current E1 approval is revalidated now.
          validateDescriptor(current.descriptor, authority.review, authority.approval, authority.context, authority.currentEpoch)
          if (result.checkId !== selectedCheck || Date.parse(result.finishedAt) < Date.parse(result.startedAt)) throw new BrokerError('INVALID')
          current.checks[selectedCheck] = { inputDigest: selectedInput, status: 'done', result }; await save()
          return { ...publicStatus(current), result }
        })
      }
    })
    return typeof outcome === 'function' ? outcome() : outcome
  }

  private async bounded<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([fn(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BrokerError('UNCERTAIN')), timeoutMs) })]) }
    finally { clearTimeout(timer) }
  }
  private async hostOperation(d: BrokerDescriptorV1, action: 'create' | 'renew' | 'collect' | 'destroy', fn: () => Promise<unknown>) {
    let output: unknown; let failed = false
    try { output = await this.bounded(fn, this.options.driverTimeoutMs ?? 5000) } catch { failed = true }
    return this.options.journal.transaction(async (state, checkpoint) => {
      const record = state.leases[d.operationId]
      if (!record || record.descriptor.leaseEpoch !== d.leaseEpoch || record.pendingHost !== action
        || canonicalHash(record.descriptor) !== canonicalHash(d)) throw new BrokerError('STALE')
      if (action !== 'destroy') {
        try {
          const a = await this.bounded(() => this.options.authority(d), this.options.driverTimeoutMs ?? 5000)
          validateDescriptor(d, a.review, a.approval, a.context, a.currentEpoch)
        } catch { failed = true }
        if (Date.parse(d.expiresAt) <= this.now()) failed = true
      }
      if (failed) {
        record.status = 'quarantined'; record.pendingHost = null; await checkpoint()
        throw new BrokerError('UNCERTAIN')
      }
      if (action === 'destroy') {
        const cleanup = z.strictObject({ resourcesDestroyed: z.boolean(), fencePersisted: z.boolean() }).parse(output)
        record.cleanupConfirmed = cleanup.resourcesDestroyed && cleanup.fencePersisted
        record.status = record.cleanupConfirmed ? 'destroyed' : 'quarantined'
      } else if (action === 'collect') {
        record.buildOutputDigest = z.strictObject({ buildOutputDigest: digest }).parse(output).buildOutputDigest
      } else record.status = 'ready'
      record.pendingHost = null; await checkpoint()
      return action === 'collect' ? { ...publicStatus(record), buildOutputDigest: record.buildOutputDigest, checks: Object.values(record.checks).map(x => x.result) } : publicStatus(record)
    })
  }
  /** Supplement to the mandatory independent HOST watchdog; invoke at least every second. */
  async sweep(): Promise<number> {
    const pending = await this.options.journal.transaction(async (state, checkpoint) => {
      const cleanup: BrokerDescriptorV1[] = []
      for (const record of Object.values(state.leases)) {
        if (!record.cleanupConfirmed && (record.status !== 'ready' || Date.parse(record.descriptor.expiresAt) <= this.now()
          || this.now() - record.createdAt >= record.descriptor.resources.activeMs)) {
          record.status = 'stopping'; record.pendingHost = 'destroy'; cleanup.push(record.descriptor)
        }
      }
      if (cleanup.length) await checkpoint()
      return cleanup
    })
    for (const d of pending) {
      try { await this.hostOperation(d, 'destroy', () => this.options.driver.destroy(d)) } catch { /* Remains quarantined, capacity retained. */ }
    }
    return pending.length
  }
}
