import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, readFile, realpath, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { digest } from '../../engine/contracts/primitives.ts'

const assetSchema = z.strictObject({ path: z.string().regex(/^\/opt\/forge\/[a-zA-Z0-9_./-]+$/)
  .refine(path => !path.split('/').slice(1).some(part => part === '.' || part === '..' || part === '')), sha256: digest })
export const hostConfigSchema = z.strictObject({ schemaVersion: z.literal(1), assets: z.strictObject({
  firecracker: assetSchema, jailer: assetSchema, guestKernel: assetSchema, guestRootfs: assetSchema,
  dependencyCache: assetSchema, seccompFilter: assetSchema, supervisor: assetSchema,
}) })
export type HostConfig = z.infer<typeof hostConfigSchema>
export interface PreflightIO {
  platform: string
  inspect(path: string): Promise<{ realPath: string; regularFile: boolean; directory: boolean; characterDevice: boolean; owner: number; mode: number }>
  read(path: string): Promise<Uint8Array>
  accessible(path: string): Promise<void>
  sha256(path: string): Promise<string>
}
const systemIO: PreflightIO = {
  platform: process.platform,
  async inspect(path) { const stat = await lstat(path); return { realPath: await realpath(path), regularFile: stat.isFile(), directory: stat.isDirectory(),
    characterDevice: stat.isCharacterDevice(), owner: stat.uid, mode: stat.mode } },
  read: readFile,
  async sha256(path) {
    const hash = createHash('sha256'); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex') }
    finally { await file.close() }
  },
  accessible: path => access(path, constants.R_OK | constants.W_OK),
}

/** Read-only facts, not an isolation attestation or an execution-enable switch.
 * This function never invokes a binary or mutates host configuration. */
export async function preflightLinuxHost(input: unknown, io: PreflightIO = systemIO) {
  if (io.platform !== 'linux') throw new Error('Dedicated Linux host required')
  const config = hostConfigSchema.parse(input)
  const device = await io.inspect('/dev/kvm')
  if (!device.characterDevice || device.realPath !== '/dev/kvm') throw new Error('KVM device unavailable')
  await io.accessible('/dev/kvm')
  const smallText = async (path: string) => {
    const bytes = await io.read(path)
    if (!bytes.byteLength || bytes.byteLength > 4096) throw new Error('Invalid host metadata length')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  }
  const controllerText = await smallText('/sys/fs/cgroup/cgroup.controllers')
  if (!/^[a-z_\s]+$/.test(controllerText)) throw new Error('Invalid cgroup metadata')
  const controllers = controllerText.split(/\s+/)
  if (!['cpu', 'memory', 'pids'].every(name => controllers.includes(name))) throw new Error('cgroup v2 controllers unavailable')
  if (!['1', '2'].includes(await smallText('/proc/sys/kernel/unprivileged_bpf_disabled'))) throw new Error('Unprivileged BPF must be disabled')
  const measured: Record<string, string> = {}
  for (const [name, asset] of Object.entries(config.assets)) {
    const stat = await io.inspect(asset.path)
    if (!stat.regularFile || stat.realPath !== asset.path || stat.owner !== 0 || (stat.mode & 0o222) !== 0) throw new Error('Mutable or unsafe pinned asset')
    for (let path = dirname(asset.path); path !== '/'; path = dirname(path)) {
      const parent = await io.inspect(path)
      if (!parent.directory || parent.realPath !== path || parent.owner !== 0 || (parent.mode & 0o022) !== 0) throw new Error('Unsafe asset parent')
    }
    const actual = await io.sha256(asset.path)
    if (actual !== asset.sha256) throw new Error('Pinned asset hash mismatch')
    measured[name] = actual
  }
  return { schemaVersion: 1, status: 'preflight-only', platform: 'linux', measuredAssets: measured,
    controllers, executionEnabled: false, missing: ['reviewed real Linux executor integration', 'real isolation and resource-abuse evidence'] }
}
