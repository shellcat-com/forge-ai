import { z } from 'zod'
import { imageDigest, digest } from '../engine/contracts/primitives.ts'
import type { BrokerDescriptorV1 } from '../engine/contracts/review.ts'
import type { HostDriver } from './broker.ts'
import { BrokerError } from './auth.ts'

export const hardenedHostSchema = z.strictObject({ schemaVersion: z.literal(1), platform: z.literal('linux'),
  dedicatedHost: z.literal(true), kvmAvailable: z.literal(true), jailer: z.literal(true), seccomp: z.literal(true),
  cgroupVersion: z.literal(2), hostWatchdog: z.literal(true), networkDefaultDeny: z.literal(true),
  metadataDenied: z.literal(true), lateralDenied: z.literal(true), dnsDenied: z.literal(true),
  immutableImageDigest: imageDigest, templateDigest: digest, dependencyCacheDigest: digest,
  reviewedHostConfigurationDigest: digest, realIsolationEvidenceDigest: digest,
  runtimeUid: z.number().int().min(10000), runtimeGid: z.number().int().min(10000) })

/** Configuration compiler only. Attestation booleans cannot enable execution:
 * D2's Linux executor implementation is not installed or live-validated. */
export function compileGuestConfiguration(input: unknown, descriptor: BrokerDescriptorV1) {
  const host = hardenedHostSchema.parse(input)
  if (host.immutableImageDigest !== descriptor.imageDigest || host.templateDigest !== descriptor.templateDigest) throw new BrokerError('INVALID')
  return { schemaVersion: 1, environmentId: descriptor.environmentId, appDatabaseId: descriptor.appDatabaseId,
    isolation: 'firecracker-jailer', uid: host.runtimeUid, gid: host.runtimeGid,
    imageDigest: host.immutableImageDigest, dependencyCacheDigest: host.dependencyCacheDigest,
    machine: { vcpu_count: descriptor.resources.cpu, mem_size_mib: descriptor.resources.memoryMiB, smt: false },
    cgroup: { cpuMax: `${descriptor.resources.cpu * 100000} 100000`, memoryMax: descriptor.resources.memoryMiB * 1024 * 1024,
      memorySwapMax: 0, pidsMax: descriptor.resources.processes },
    diskBytes: descriptor.resources.diskMiB * 1024 * 1024,
    watchdog: { leaseEpoch: descriptor.leaseEpoch, expiresAt: descriptor.expiresAt, action: 'revoke-ingress-then-destroy-or-quarantine' },
    network: { guestEgress: 'deny-all-ipv4-ipv6-dns', appDatabase: '127.0.0.1:5432', previewIngress: 'assigned-gateway-only' },
    source: { target: '/workspace', readOnly: true }, scratch: { target: '/scratch', noSuid: true, noDev: true },
    environment: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOME: '/scratch/home', TMPDIR: '/scratch/tmp' },
    forbidden: ['host-exec', 'docker-socket', 'host-home', 'platform-secrets', 'shared-writable-cache', 'nested-virtualization'] }
}
/** There is no local exec fallback, even on Linux or when flags are supplied. */
export class UnavailableFirecrackerDriver implements HostDriver {
  readonly origin = 'runner' as const
  async assertAvailable(): Promise<never> { throw new BrokerError('UNAVAILABLE') }
  async create(): Promise<never> { throw new BrokerError('UNAVAILABLE') }
  async renew(): Promise<never> { throw new BrokerError('UNAVAILABLE') }
  async runCheck(): Promise<never> { throw new BrokerError('UNAVAILABLE') }
  async collect(): Promise<never> { throw new BrokerError('UNAVAILABLE') }
  async destroy() { return { resourcesDestroyed: false, fencePersisted: false } }
}
