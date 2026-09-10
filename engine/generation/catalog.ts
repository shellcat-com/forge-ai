import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { assertUniquePaths, isGeneratedPath, sourcePath } from '../contracts/paths.ts'
import { limits, textContent } from '../contracts/primitives.ts'
import { templateManifestSchema } from '../contracts/source.ts'
import type { ManifestV1, TemplateManifestV1 } from '../contracts/source.ts'

export interface CatalogFile { path: string; mediaType: ManifestV1['files'][number]['mediaType']; bytes: Uint8Array }
export interface TemplateCatalogInput { manifest: TemplateManifestV1; files: CatalogFile[]; evidence: 'fixture' | 'release' }
const requiredFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', '.env.example']
/** The catalog digest excludes its own digest field and includes every byte hash.
 * This closes the previously structural template ref without a self-hash cycle. */
export function templateCatalogDigest(manifest: TemplateManifestV1, files: readonly CatalogFile[]): string {
  return canonicalHash({ schemaVersion: 1, manifest: { ...manifest, template: { id: manifest.template.id, imageDigest: manifest.template.imageDigest } },
    files: files.map(f => ({ path: f.path, mediaType: f.mediaType, sha256: sha256(f.bytes), bytes: f.bytes.length })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) })
}
export class TemplateCatalog {
  private readonly data: TemplateCatalogInput
  constructor(input: TemplateCatalogInput) {
    const manifest = templateManifestSchema.parse(input.manifest)
    const files = input.files.map(f => ({ ...f, path: sourcePath.parse(f.path), bytes: f.bytes.slice() }))
    assertUniquePaths(files.map(f => f.path))
    assertUniquePaths(manifest.protectedPaths)
    if (files.length > limits.files || files.reduce((n, f) => n + f.bytes.length, 0) > limits.sourceBytes)
      throw new Error('Template source cap')
    if (templateCatalogDigest(manifest, files) !== manifest.template.digest) throw new Error('Template catalog digest mismatch')
    if (requiredFiles.some(path => !files.some(f => f.path === path))
      || manifest.protectedPaths.some(path => !files.some(f => f.path === path))
      || files.some(f => !isGeneratedPath(f.path) && !manifest.protectedPaths.includes(f.path))) throw new Error('Incomplete template ownership')
    if (requiredFiles.some(path => !manifest.protectedPaths.includes(path))) throw new Error('Unprotected template configuration')
    const assets = files.filter(f => /^(image|font)\//.test(f.mediaType))
    const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'font/woff2': '.woff2' }
    if (assets.length > limits.assets || assets.reduce((n, f) => n + f.bytes.length, 0) > limits.assetBytes
      || assets.some(f => !f.path.startsWith('public/assets/') || !f.path.endsWith(extensions[f.mediaType]))) throw new Error('Invalid template asset catalog')
    for (const file of files) {
      if (assets.includes(file)) continue
      textContent.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes))
    }
    const getText = (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(files.find(f => f.path === path)!.bytes)
    if (sha256(files.find(f => f.path === 'package-lock.json')!.bytes) !== manifest.lockfileDigest) throw new Error('Lockfile digest mismatch')
    const pkg = JSON.parse(getText('package.json')) as { dependencies?: Record<string, string> }
    const lock = JSON.parse(getText('package-lock.json')) as { lockfileVersion?: number; packages?: Record<string, { version?: string; resolved?: string; integrity?: string }> }
    const compiler = JSON.parse(getText('tsconfig.json')) as { compilerOptions?: { strict?: boolean } }
    if (pkg.dependencies?.next !== manifest.releases.next || compiler.compilerOptions?.strict !== true
      || lock.lockfileVersion !== 3 || !lock.packages || lock.packages['node_modules/next']?.version !== manifest.releases.next)
      throw new Error('Template release/strict compiler mismatch')
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue
      if (!entry.version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(entry.version)
        || !entry.resolved?.startsWith('https://') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity ?? ''))
        throw new Error('Unpinned dependency entry')
    }
    this.data = { manifest, files, evidence: input.evidence }
  }
  get manifest(): TemplateManifestV1 { return structuredClone(this.data.manifest) }
  get evidence(): TemplateCatalogInput['evidence'] { return this.data.evidence }
  files(): CatalogFile[] { return this.data.files.map(f => ({ ...f, bytes: f.bytes.slice() })) }
  /** Every template-owned byte and approved asset must survive unchanged. */
  validateSource(manifest: ManifestV1): void {
    if (canonicalHash(manifest.template) !== canonicalHash(this.data.manifest.template)
      || manifest.commandPolicyDigest !== this.data.manifest.commandPolicyDigest) throw new Error('Source template/policy mismatch')
    for (const path of this.data.manifest.protectedPaths) {
      const file = manifest.files.find(f => f.path === path)
      const original = this.data.files.find(f => f.path === path)!
      if (!file || file.sha256 !== sha256(original.bytes) || file.bytes !== original.bytes.length || file.mediaType !== original.mediaType)
        throw new Error('Template-owned content mismatch')
    }
    for (const file of manifest.files) {
      if (isGeneratedPath(file.path)) continue
      const original = this.data.files.find(f => f.path === file.path)
      if (!original || file.sha256 !== sha256(original.bytes) || file.bytes !== original.bytes.length || file.mediaType !== original.mediaType)
        throw new Error('Source outside immutable catalog')
    }
  }
}
