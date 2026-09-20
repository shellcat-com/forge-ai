import { readFile, writeFile } from 'node:fs/promises'
import { sha256, canonicalHash } from '../../../engine/contracts/canonical.ts'
import { readReviewedCandidate } from '../../../tests/harness/candidate-export.ts'
import { templateInputDigest } from './inputs.ts'
import { candidateToolchain, protectedTemplatePaths } from '../release.ts'
const root = new URL('../', import.meta.url)
const evidence = new URL('../../../docs/reports/evidence/task-03/', import.meta.url)
const files = await readReviewedCandidate()
const archives = JSON.parse(await readFile(new URL('toolchain-archives.json', evidence), 'utf8'))
const cache = JSON.parse(await readFile(new URL('cache-archive.json', evidence), 'utf8'))
const input = { schemaVersion: 1, status: 'candidate', target: 'linux-x64', templateInputsDigest: templateInputDigest(files),
  toolchain: { ...candidateToolchain, npm: '11.19.0' },
  packageJsonSha256: sha256(await readFile(new URL('package.json', root))), lockfileSha256: sha256(await readFile(new URL('package-lock.json', root))),
  dependenciesManifestSha256: sha256(await readFile(new URL('dependencies.json', evidence))),
  registryKeysSha256: sha256(await readFile(new URL('registry-keys.json', evidence))),
  dependencyCacheArchiveSha256: cache.sha256, archives: archives.archives,
  protectedPaths: protectedTemplatePaths, hooksAllowed: [],
  policySourceSha256: sha256(await readFile(new URL('policy.ts', root))),
  // Resource limits are supplied at review time; commandPolicyDigest binds that exact policy instance.
  commandPolicyDigest: null, imageDigest: null, finalTemplateCatalogDigest: null,
  remainingImageInputs: ['Linux distribution/libc/compiler/configuration', 'kernel/rootfs/Firecracker/jailer/seccomp/supervisor/guest-agent digests', 'real isolated build/database/browser/export evidence'],
}
await writeFile(new URL('image-inputs.json', import.meta.url), JSON.stringify(input, null, 2) + '\n')
console.log(JSON.stringify({ imageInputsDigest: canonicalHash(input), templateInputsDigest: input.templateInputsDigest }))
