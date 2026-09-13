import { open, mkdir, lstat, readFile, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brokerDescriptorSchema } from '../../engine/contracts/review.ts'
import { digest, uuid } from '../../engine/contracts/primitives.ts'

export const hostRecordSchema = z.strictObject({ descriptor: brokerDescriptorSchema, bindingDigest: digest,
  launchAttemptId: uuid, state: z.enum(['launching', 'running', 'stopping', 'quarantined', 'destroyed']),
  createdAt: z.number().int(), tombstone: z.boolean(), launchUncertain: z.boolean(), resourcesReserved: z.boolean(),
  ingressRevoked: z.boolean(), cleanupEvidenceDigest: digest.nullable() })
const inventorySchema = z.strictObject({ schemaVersion: z.literal(1), lastObservedAt: z.number().int(), records: z.record(z.string(), hostRecordSchema) })
export type HostRecord = z.infer<typeof hostRecordSchema>
export type HostInventoryState = z.infer<typeof inventorySchema>

/** One host supervisor owns this lifetime lock, independently of broker/worker
 * liveness. A crashed-owner lock is not auto-stolen: fence the process first. */
export class HostInventory {
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private activeOperations = 0
  private constructor(private readonly root: string, private readonly owner: Awaited<ReturnType<typeof open>>) {}
  static async acquire(directory: string): Promise<HostInventory> {
    const root = resolve(directory)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe host inventory directory')
    const owner = await open(join(root, 'owner.lock'), 'wx', 0o600)
    await owner.writeFile(JSON.stringify({ pid: process.pid })); await owner.sync()
    return new HostInventory(root, owner)
  }
  async transaction<T>(fn: (state: HostInventoryState) => T): Promise<T> {
    if (this.closed) throw new Error('Host inventory closed')
    const work = this.tail.then(async () => {
      let state: HostInventoryState
      try {
        const path = join(this.root, 'inventory.json'); const stat = await lstat(path)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid host inventory')
        state = inventorySchema.parse(JSON.parse(await readFile(path, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        state = { schemaVersion: 1, lastObservedAt: 0, records: {} }
      }
      const result = fn(state)
      const bytes = JSON.stringify(inventorySchema.parse(state))
      if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw new Error('Host inventory capacity')
      const temporary = join(this.root, `inventory-${randomUUID()}.tmp`)
      const file = await open(temporary, 'wx', 0o600)
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      await rename(temporary, join(this.root, 'inventory.json'))
      const directory = await open(this.root, 'r')
      try { await directory.sync() } finally { await directory.close() }
      return structuredClone(result)
    })
    this.tail = work.catch(() => undefined)
    return work
  }
  beginExternalOperation(): () => void {
    if (this.closed) throw new Error('Host inventory closed')
    this.activeOperations++; let released = false
    return () => { if (!released) { released = true; this.activeOperations-- } }
  }
  async close(): Promise<void> {
    if (this.activeOperations > 0) throw new Error('Cannot close host inventory with unsettled launch')
    this.closed = true; await this.tail; await this.owner.close(); await unlink(join(this.root, 'owner.lock'))
  }
}
