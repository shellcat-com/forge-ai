// Real short-lived process; only synthetic inputs from the native parent test.
import { readFileSync } from 'node:fs'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import {
  EncryptedObjectBackend,
  EnvironmentObjectKeys,
} from '../../engine/artifacts/encrypted-backend.ts'
import { PostgresCiphertextTransport } from '../../engine/artifacts/postgres-backend.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
const input = JSON.parse(readFileSync(0, 'utf8'))
const transport = new PostgresCiphertextTransport(
  input.config,
  input.mode === 'write' ? 'forge_object_writer' : 'forge_object_reader'
)
try {
  await transport.check()
  const keys = new EnvironmentObjectKeys(
    { v1: 'FORGE_OBJECT_KEY_V1' },
    { FORGE_OBJECT_KEY_V1: input.testKey }
  )
  const store = new ArtifactStore(new EncryptedObjectBackend(transport, keys, 'v1'))
  if (input.mode === 'write')
    process.stdout.write(
      JSON.stringify(await store.put(input.scope, 'source-blob', Buffer.from(input.synthetic)))
    )
  else {
    const bytes = await store.read(input.scope, input.ref)
    process.stdout.write(JSON.stringify({ sha256: sha256(bytes), bytes: bytes.length }))
  }
} catch {
  process.stderr.write('Synthetic child storage operation failed')
  process.exitCode = 1
} finally {
  await transport.close()
}
