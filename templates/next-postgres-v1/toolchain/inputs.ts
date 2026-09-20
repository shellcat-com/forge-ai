import { canonicalHash, sha256 } from '../../../engine/contracts/canonical.ts'
import type { CatalogFile } from '../../../engine/generation/catalog.ts'
import { assertUniquePaths } from '../../../engine/contracts/paths.ts'

/** Independent source input identity. The final E2 catalog digest also binds the
 * image digest and MUST NOT occur in the image's own hash preimage. */
export function templateInputDigest(files: readonly CatalogFile[]): string {
  assertUniquePaths(files.map(file => file.path))
  return canonicalHash({ schemaVersion: 1, files: files.map(file => ({ path: file.path, mediaType: file.mediaType,
    sha256: sha256(file.bytes), bytes: file.bytes.byteLength })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) })
}
