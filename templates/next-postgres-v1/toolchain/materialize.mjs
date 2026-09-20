// Trusted offline cache importer. No package code or lifecycle hooks execute.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'

const [bundle, expectedDigest, expectedKeysDigest, npmRoot, cache, target] = process.argv.slice(2)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
if (!bundle || !/^[a-f0-9]{64}$/.test(expectedDigest ?? '') || !/^[a-f0-9]{64}$/.test(expectedKeysDigest ?? '') || !npmRoot || !cache || !['linux-x64', 'darwin-arm64'].includes(target)) throw Error('Usage: materialize.mjs BUNDLE MANIFEST_SHA256 KEYS_SHA256 NPM_ROOT EMPTY_CACHE linux-x64|darwin-arm64')
if (process.version !== 'v24.20.0') throw Error('Exact Node 24.20.0 required')
const npm = JSON.parse(await readFile(join(npmRoot, 'package.json'), 'utf8'))
if (npm.name !== 'npm' || npm.version !== '11.19.0') throw Error('Exact bundled npm 11.19.0 required')
const bytes = await readFile(join(bundle, 'dependencies.json'))
if (hash(bytes) !== expectedDigest) throw Error('Dependency manifest digest mismatch')
const report = JSON.parse(bytes)
if (report.schemaVersion !== 1 || report.status !== 'candidate' || report.hooksExecuted.length) throw Error('Invalid dependency manifest')
const require = createRequire(resolve(npmRoot, 'package.json'))
const cacache = require('cacache')
// The cache is new, task-owned, and populated only after the entire bundle verifies.
await mkdir(cache, { recursive: false, mode: 0o700 })
const keysBytes = await readFile(join(bundle, 'registry-keys.json'))
if (hash(keysBytes) !== expectedKeysDigest) throw Error('Registry key digest mismatch')
const keys = JSON.parse(keysBytes).keys
const signatures = []
for (const p of report.packages) {
  if (!/^[a-f0-9]{64}\.tgz$/.test(p.file) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(p.integrity)) throw Error('Invalid bundle entry')
  const data = await readFile(join(bundle, p.file))
  if (data.length !== p.bytes || hash(data) !== p.sha256 || `sha512-${createHash('sha512').update(data).digest('base64')}` !== p.integrity) throw Error(`Package integrity mismatch: ${p.path}`)
  let verified = false
  for (const signature of p.signatures) {
    const key = keys.find(k => k.keyid === signature.keyid)
    if (!key || key.expires && (!p.publishedAt || !Number.isFinite(Date.parse(p.publishedAt)) || Date.parse(key.expires) <= Date.parse(p.publishedAt))) continue
    if (verify('sha256', Buffer.from(`${p.name}@${p.version}:${p.integrity}`), createPublicKey({ key: Buffer.from(key.key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature.sig, 'base64'))) verified = true
  }
  if (!verified) throw Error(`Registry signature unavailable/invalid: ${p.path}`)
  signatures.push(p.path)
}
const [os, cpu] = target.split('-')
const compatible = (values, value) => !values.length || !values.includes(`!${value}`) && (values.every(v => v.startsWith('!')) || values.includes(value))
const materialized = report.packages.filter(p => compatible(p.os, os) && compatible(p.cpu, cpu))
for (const p of materialized) {
  await cacache.put(join(cache, '_cacache'), `forge:${p.integrity}`, await readFile(join(bundle, p.file)), { integrity: p.integrity })
}
console.log(JSON.stringify({ schemaVersion: 1, origin: 'offline-package-byte-verification', status: 'passed', dependenciesSha256: expectedDigest,
  registryKeysSha256: hash(keysBytes), registrySignaturesVerified: signatures.length, target, materializedPackageCount: materialized.length, provenanceAttestationsVerified: false, hooksExecuted: [],
  cacheIdentity: 'lockfile SRI content set; npm cache indexes are not reproducible image identity' }))
