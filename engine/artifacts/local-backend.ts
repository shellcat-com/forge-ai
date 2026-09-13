import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sha256 } from '../contracts/canonical.ts'
import { uuid } from '../contracts/primitives.ts'
import type { ImmutableObjectBackend } from './store.ts'

const maxBytes = 32 * 1024 * 1024
const keyPattern = /^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/
/** Restart-persistent SYNTHETIC local storage. No cloud durability, encryption,
 * retention or backup claim. The flat private directory and its immediate parent
 * must be owned by this process UID, mode 0700, and managed by a trusted operator.
 * Node path APIs cannot guarantee openat-style containment against an adversarial
 * same-UID process replacing ancestors. This backend is explicitly unsuitable for
 * that threat model. It stores inert blobs; never creates generated path trees. */
export class LocalSyntheticObjectBackend implements ImmutableObjectBackend {
  readonly evidence = 'fixture' as const
  private constructor(private readonly root: string) {}
  static async open(rootInput: string): Promise<LocalSyntheticObjectBackend> {
    const root = resolve(rootInput)
    if (await realpath(root) !== root) throw new Error('Local artifact path must be canonical without symlinks')
    await assertPrivateDirectory(dirname(root))
    await assertPrivateDirectory(root)
    return new LocalSyntheticObjectBackend(root)
  }
  private path(key: string) {
    if (!keyPattern.test(key)) throw new Error('Invalid server artifact key')
    for (const value of key.split('/').slice(1)) uuid.parse(value)
    return join(this.root, sha256(key) + '.blob')
  }
  async createOnly(key: string, input: Uint8Array): Promise<{ version: string }> {
    const path = this.path(key)
    if (input.length > maxBytes) throw new Error('Local artifact byte cap')
    const bytes = input.slice()
    await assertPrivateDirectory(this.root)
    const version = randomUUID()
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) throw new Error('Unsafe local artifact file')
      await handle.writeFile(Buffer.concat([Buffer.from(version + '\n', 'ascii'), bytes]))
      await handle.sync()
    } finally { await handle.close() }
    const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
    return { version }
  }
  async readVersion(key: string, version: string): Promise<Uint8Array> {
    uuid.parse(version)
    await assertPrivateDirectory(this.root)
    const handle = await open(this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600
        || stat.size < 37 || stat.size > maxBytes + 37) throw new Error('Unsafe local artifact file')
      // Explicit length bound prevents append races allocating an unbounded read.
      const bytes = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < bytes.length) {
        const part = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!part.bytesRead) throw new Error('Truncated local artifact')
        offset += part.bytesRead
      }
      if (bytes.subarray(0, 37).toString('ascii') !== version + '\n') throw new Error('Artifact version unavailable')
      const after = await handle.stat()
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Artifact changed during read')
      return Uint8Array.from(bytes.subarray(37))
    } finally { await handle.close() }
  }
}
async function assertPrivateDirectory(path: string) {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid === undefined
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error('Local artifact directory must be trusted, owner-only mode 0700')
}
