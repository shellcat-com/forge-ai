import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { prebuiltConfig } from '../../engine/publishing/prebuilt.ts'
import { publicTargetSchema, validateStaticFiles } from '../../engine/publishing/portfolio.ts'

// Offline operator check, NOT portfolio provenance authentication. Never takes a
// provider key or executes generated source. CLI deploy remains a separate action.
const [input] = process.argv.slice(2)
if (!input || process.argv.length !== 3)
  throw new Error('Usage: tsx scripts/publishing/audit-prebuilt.ts STAGE')
const root = resolve(input)
const stat = await lstat(root)
if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe staging root')
const receipt = JSON.parse(await readFile(join(root, 'publication-receipt.json'), 'utf8'))
if (receipt.receipt.sourceDirty !== false || !/^[a-f0-9]{40}$/.test(receipt.receipt.sourceCommit))
  throw new Error('A clean committed frontend build is required')
if (receipt.receipt.kind !== 'platform-authored-unavailable-frontend')
  throw new Error(
    'Portfolio requires the live trusted publication authority; this CLI accepts platform frontend only'
  )
const target = publicTargetSchema.parse(
  JSON.parse(await readFile(join(root, 'target.json'), 'utf8'))
)
const link = JSON.parse(await readFile(join(root, '.vercel/project.json'), 'utf8'))
if (link.projectId !== target.projectId || link.orgId !== target.teamId)
  throw new Error('Project link mismatch')
if (
  canonicalHash(JSON.parse(await readFile(join(root, '.vercel/output/config.json'), 'utf8'))) !==
    canonicalHash(prebuiltConfig) ||
  receipt.configurationDigest !== canonicalHash(prebuiltConfig)
)
  throw new Error('Config changed')
if (
  canonicalHash(JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'))) !==
  canonicalHash({ git: { deploymentEnabled: false } })
)
  throw new Error('Git deployment configuration changed')
const allowed = new Set([
  'publication-receipt.json',
  'target.json',
  'vercel.json',
  '.vercel/project.json',
  '.vercel/output/config.json',
  ...receipt.files.map((f: { path: string }) => '.vercel/output/static/' + f.path),
])
async function walk(path = '') {
  for (const name of await readdir(join(root, path))) {
    const next = path ? path + '/' + name : name
    const stat = await lstat(join(root, next))
    if (stat.isSymbolicLink()) throw new Error('Staged link rejected')
    if (stat.isDirectory()) {
      if (![...allowed].some((file) => file.startsWith(next + '/')))
        throw new Error('Unexpected directory')
      await walk(next)
    } else if (!stat.isFile() || !allowed.delete(next)) throw new Error('Unexpected artifact')
  }
}
await walk()
if (allowed.size) throw new Error('Missing staged file')
const files = await Promise.all(
  receipt.files.map(async (f: { path: string; sha256: string; bytes: number }) => {
    const bytes = await readFile(join(root, '.vercel/output/static', f.path))
    if (sha256(bytes) !== f.sha256 || bytes.length !== f.bytes)
      throw new Error('Staged bytes changed')
    return { path: f.path, bytes }
  })
)
if (canonicalHash(validateStaticFiles(files, [])) !== receipt.staticFilesDigest)
  throw new Error('Static manifest changed')
console.info(
  JSON.stringify({
    status: 'offline-byte-audit-passed',
    target,
    sourceCommit: receipt.receipt.sourceCommit,
    staticFilesDigest: receipt.staticFilesDigest,
    fileCount: files.length,
    liveTargetRecheckRequired: true,
    liveBuilder: false,
  })
)
