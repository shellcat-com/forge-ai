import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalSyntheticObjectBackend } from '../../engine/artifacts/local-backend.ts'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { scope } from './fixtures.ts'
const parents: string[] = []
afterEach(async () => { for (const parent of parents.splice(0)) await rm(parent, { recursive: true, force: true }) })
async function setup() {
  const parent = await mkdtemp(join(await realpath(tmpdir()), 'forge-e2-artifacts-'))
  parents.push(parent)
  await chmod(parent, 0o700)
  const root = join(parent, 'blobs')
  await mkdir(root, { mode: 0o700 })
  return { parent, root, store: new ArtifactStore(await LocalSyntheticObjectBackend.open(root)) }
}
describe('E2 synthetic persistent local blobs (no generated code execution)', () => {
  it('survives backend restart with immutable scoped version references', async () => {
    const { root, store } = await setup()
    const ref = await store.put(scope, 'source-blob', new TextEncoder().encode('inert synthetic source'))
    expect(ref.backendEvidence).toBe('fixture')
    const restarted = new ArtifactStore(await LocalSyntheticObjectBackend.open(root))
    expect(new TextDecoder().decode(await restarted.read(scope, ref))).toBe('inert synthetic source')
    const backend = await LocalSyntheticObjectBackend.open(root)
    await expect(backend.createOnly(ref.storageKey, Uint8Array.of(1))).rejects.toThrow()
  })
  it('detects changed bytes and wrong immutable version', async () => {
    const { root, store } = await setup()
    const ref = await store.put(scope, 'source-blob', Uint8Array.of(1))
    const path = join(root, (await readdir(root))[0])
    const bytes = await readFile(path)
    bytes[37] = 2
    await writeFile(path, bytes)
    await expect(store.read(scope, ref)).rejects.toThrow('integrity')
    await expect(store.read(scope, { ...ref, storageVersion: '00000000-0000-4000-8000-000000000999' })).rejects.toThrow('version')
  })
  it('rejects symlinks, public directory modes and non-server keys', async () => {
    const { parent, root, store } = await setup()
    const ref = await store.put(scope, 'source-blob', Uint8Array.of(1))
    const name = (await readdir(root))[0]
    await rm(join(root, name))
    await symlink(join(parent, 'missing'), join(root, name))
    await expect(store.read(scope, ref)).rejects.toThrow()
    const backend = await LocalSyntheticObjectBackend.open(root)
    await expect(backend.createOnly('../../escape', Uint8Array.of(1))).rejects.toThrow('key')
    await chmod(root, 0o755)
    await expect(LocalSyntheticObjectBackend.open(root)).rejects.toThrow('0700')
  })
})
