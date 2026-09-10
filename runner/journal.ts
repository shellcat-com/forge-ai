import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brokerDescriptorSchema } from '../engine/contracts/review.ts'
import { digest } from '../engine/contracts/primitives.ts'
import { BrokerError } from './auth.ts'

const checkRecord = z.strictObject({ inputDigest: digest, status: z.enum(['pending', 'done']), result: z.unknown().optional() })
export const leaseRecordSchema = z.strictObject({ descriptor: brokerDescriptorSchema, identityDigest: digest,
  status: z.enum(['creating', 'ready', 'stopping', 'destroyed', 'quarantined']), createdAt: z.number().int(),
  checks: z.record(z.string(), checkRecord), verificationStartedAt: z.number().int().nullable(),
  buildOutputDigest: digest.nullable(), pendingHost: z.enum(['create', 'renew', 'collect', 'destroy']).nullable(),
  cleanupConfirmed: z.boolean(), origin: z.enum(['fixture', 'runner']) })
export type LeaseRecord = z.infer<typeof leaseRecordSchema>
const stateSchema = z.strictObject({ schemaVersion: z.literal(1), leases: z.record(z.string(), leaseRecordSchema) })
export type JournalState = z.infer<typeof stateSchema>

/** Dedicated local broker disk, single transactional writer. Lock is never stolen:
 * after process death an operator must fence the old broker before removing it.
 * No generated files or guest-controlled paths enter this journal. */
export class FileJournal {
  private readonly root: string
  constructor(directory: string) { this.root = resolve(directory) }
  async transaction<T>(fn: (state: JournalState, checkpoint: () => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const stat = await lstat(this.root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new BrokerError('INVALID')
    let lock
    try { lock = await open(join(this.root, 'writer.lock'), 'wx', 0o600) } catch { throw new BrokerError('UNAVAILABLE') }
    try {
      await lock.writeFile(String(process.pid)); await lock.sync()
      let state: JournalState
      try { state = stateSchema.parse(JSON.parse(await readFile(join(this.root, 'state.json'), 'utf8'))) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new BrokerError('UNAVAILABLE')
        state = { schemaVersion: 1, leases: {} }
      }
      const checkpoint = async () => {
        const bytes = JSON.stringify(stateSchema.parse(state))
        if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw new BrokerError('CAPACITY')
        const temporary = join(this.root, `state-${randomUUID()}.tmp`)
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
        await rename(temporary, join(this.root, 'state.json'))
        const directory = await open(this.root, 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
      return await fn(state, checkpoint)
    } finally { await lock.close(); await unlink(join(this.root, 'writer.lock')) }
  }
}
