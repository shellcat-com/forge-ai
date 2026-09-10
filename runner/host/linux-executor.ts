import { execFile } from 'node:child_process'
import { z } from 'zod'
import { brokerDescriptorSchema, type BrokerDescriptorV1 } from '../../engine/contracts/review.ts'
import { uuid } from '../../engine/contracts/primitives.ts'
import type { HostObservation, LinuxExecutor } from './lifecycle.ts'
import type { RpcBinding } from '../guest/protocol.ts'

export type HelperAction = 'preflight' | 'launch' | 'renew' | 'revoke' | 'stop' | 'wipe' | 'observe' | 'binding'
export interface LinuxHelper {
  readonly origin: 'fixture' | 'runner'
  call(action: HelperAction, descriptor: BrokerDescriptorV1, attemptId: string | null, signal: AbortSignal): Promise<unknown>
}
/** Runs only the installed platform helper. No shell, inherited environment,
 * candidate argv, secret logging or process-execution fallback. Not wired by default. */
export class InstalledLinuxHelper implements LinuxHelper {
  readonly origin = 'runner' as const
  async call(action: HelperAction, descriptor: BrokerDescriptorV1, attemptId: string | null, signal: AbortSignal) {
    if (process.platform !== 'linux') throw new Error('Dedicated Linux/KVM host required')
    signal.throwIfAborted()
    const payload = JSON.stringify({ action, descriptor: brokerDescriptorSchema.parse(descriptor),
      attemptId: attemptId === null ? null : uuid.parse(attemptId) })
    return new Promise<unknown>((resolve, reject) => {
      const child = execFile('/opt/forge/bin/forge-linux-helper', [], {
        env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }, cwd: '/',
        timeout: 5000, maxBuffer: 32 * 1024, signal,
      }, (error, stdout) => {
        if (error) reject(new Error('Linux helper failed; cleanup required'))
        else { try { resolve(JSON.parse(stdout)) } catch { reject(new Error('Invalid helper response')) } }
      })
      child.stdin?.end(payload)
      child.stdin?.on('error', () => { /* Exit callback reports the bounded failure. */ })
    })
  }
}
export class FirecrackerLinuxExecutor implements LinuxExecutor {
  readonly origin: 'fixture' | 'runner'
  constructor(private readonly helper: LinuxHelper = new InstalledLinuxHelper()) { this.origin = helper.origin }
  async assertAvailable(d: BrokerDescriptorV1, signal: AbortSignal) {
    const result = await this.helper.call('preflight', d, null, signal)
    z.strictObject({ available: z.literal(true), imageDigest: z.literal(d.imageDigest) }).parse(result)
  }
  async launch(d: BrokerDescriptorV1, attemptId: string, signal: AbortSignal) { await this.helper.call('launch', d, attemptId, signal) }
  async renew(d: BrokerDescriptorV1, signal: AbortSignal) { await this.helper.call('renew', d, null, signal) }
  async revokeIngress(d: BrokerDescriptorV1, signal: AbortSignal) { await this.helper.call('revoke', d, null, signal) }
  async stopLauncherAndVm(d: BrokerDescriptorV1, attemptId: string, signal: AbortSignal) { await this.helper.call('stop', d, attemptId, signal) }
  async wipeAppStorageAndCredentials(d: BrokerDescriptorV1, signal: AbortSignal) { await this.helper.call('wipe', d, null, signal) }
  async observe(d: BrokerDescriptorV1, attemptId: string, signal: AbortSignal): Promise<HostObservation> {
    return z.strictObject({ operationId: z.literal(d.operationId), launchAttemptId: z.literal(attemptId),
      ingressAbsent: z.boolean(), launcherAbsent: z.boolean(), vmAbsent: z.boolean(), volumesAbsent: z.boolean(),
      appCredentialsAbsent: z.boolean(), observedAt: z.number().int() }).parse(await this.helper.call('observe', d, attemptId, signal))
  }
  async binding(d: BrokerDescriptorV1, signal: AbortSignal): Promise<RpcBinding> {
    const receipt = z.strictObject({ attemptId: uuid, key: z.string().regex(/^[0-9a-f]{64}$/),
      socketPath: z.string().regex(/^\/var\/lib\/forge\/jailer\/firecracker\/[0-9a-f-]{36}\/root\/rpc\.sock$/) })
      .parse(await this.helper.call('binding', d, null, signal))
    return { descriptor: d, attemptId: receipt.attemptId, socketPath: receipt.socketPath, key: Buffer.from(receipt.key, 'hex') }
  }
}
