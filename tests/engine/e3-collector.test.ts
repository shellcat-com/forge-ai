import { describe, expect, it } from 'vitest'
import { collectBuildOutput, collectSanitizedLog, type GuestOutput, type QuarantineSink } from '../../runner/collector.ts'
import { compileGuestConfiguration } from '../../runner/hardened.ts'
import { descriptor, hash } from './fixtures.ts'

async function* chunks(...values: string[]) { for (const value of values) yield Buffer.from(value) }
async function* records(...values: Partial<GuestOutput>[]) {
  for (const value of values) yield { path: 'build/server.js', kind: 'file' as const, mode: '0644', bytes: 4, data: chunks('test'), ...value }
}
function sink(): QuarantineSink & { aborted: number; written: number } {
  const target = { aborted: 0, written: 0, async begin() { return {
    async write(bytes: Uint8Array) { target.written += bytes.length }, async finish() { return 'fixture-object' }, async abort() { target.aborted++ },
  } } }
  return target
}
describe('E3 collector and config unit evidence, no guest execution', () => {
  it('hashes exact framed bytes into quarantined output', async () => {
    const result = await collectBuildOutput(records({}), sink(), new AbortController().signal)
    expect(result).toMatchObject({ origin: 'untrusted-build-output', bytes: 4 })
    expect(result.buildOutputDigest).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each(['../escape', 'build/../escape', '/build/file', 'build/.env', 'build/file.tar', 'build/a\\b', 'build/%2e/file', 'public/.git/file'])('rejects hostile output path %s', async path => {
    await expect(collectBuildOutput(records({ path }), sink(), new AbortController().signal)).rejects.toThrow()
  })
  it.each(['symlink', 'hardlink', 'device', 'directory'] as const)('rejects %s before opening sink', async kind => {
    const target = sink()
    await expect(collectBuildOutput(records({ kind }), target, new AbortController().signal)).rejects.toThrow()
    expect(target.written).toBe(0)
  })
  it('rejects duplicate/case aliases, executable bits, lied sizes, cap and abort', async () => {
    await expect(collectBuildOutput(records({}, { path: 'build/SERVER.js' }), sink(), new AbortController().signal)).rejects.toThrow()
    await expect(collectBuildOutput(records({ mode: '0755' }), sink(), new AbortController().signal)).rejects.toThrow()
    const target = sink()
    await expect(collectBuildOutput(records({ bytes: 3 }), target, new AbortController().signal)).rejects.toThrow()
    expect(target.aborted).toBe(1)
    await expect(collectBuildOutput(records({}), sink(), new AbortController().signal, 3)).rejects.toThrow()
    const abort = new AbortController(); abort.abort()
    await expect(collectBuildOutput(records({}), sink(), abort.signal)).rejects.toThrow()
  })
  it('redacts split secret canaries and terminal controls within byte budget', async () => {
    const output = await collectSanitizedLog(chunks('before SEC', 'RET after\u001b[31m'), ['SECRET'], 1024)
    expect(output).toBe('before [REDACTED] after')
    expect(await collectSanitizedLog(chunks('can\u001b[31mary'), ['canary'], 1024)).toBe('[REDACTED]')
    expect(await collectSanitizedLog(chunks('canary'), ['canary'], 5)).not.toContain('canar')
    expect(await collectSanitizedLog(chunks('123456789'), [], 4)).toBe('1234')
  })
  it('compiles strict nonexecutable host configuration; missing or mismatched proof fails', () => {
    const host = { schemaVersion: 1, platform: 'linux', dedicatedHost: true, kvmAvailable: true, jailer: true, seccomp: true,
      cgroupVersion: 2, hostWatchdog: true, networkDefaultDeny: true, metadataDenied: true, lateralDenied: true, dnsDenied: true,
      immutableImageDigest: descriptor.imageDigest, templateDigest: hash, dependencyCacheDigest: hash,
      reviewedHostConfigurationDigest: hash, realIsolationEvidenceDigest: hash, runtimeUid: 10000, runtimeGid: 10000 }
    expect(compileGuestConfiguration(host, descriptor)).toMatchObject({ isolation: 'firecracker-jailer', network: { guestEgress: 'deny-all-ipv4-ipv6-dns' }, cgroup: { memorySwapMax: 0, pidsMax: 512 } })
    expect(() => compileGuestConfiguration({ ...host, platform: 'darwin' }, descriptor)).toThrow()
    expect(() => compileGuestConfiguration({ ...host, seccomp: false }, descriptor)).toThrow()
    expect(() => compileGuestConfiguration(host, { ...descriptor, imageDigest: `sha256:${'b'.repeat(64)}` })).toThrow()
  })
})
