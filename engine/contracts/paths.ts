import { z } from 'zod'
import { utf8Bytes } from './primitives.ts'

export function isSourcePath(path: string): boolean {
  if (!path || utf8Bytes(path) > 240 || !/^[A-Za-z0-9_./()[\]-]+$/.test(path)) return false
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'
    && !segment.endsWith('.') && !/^(\.git|node_modules|\.next|\.ssh)$/i.test(segment)
    && !/^(\.npmrc|\.netrc|\.pypirc|credentials\.json|service-account\.json|id_rsa|id_ed25519)$/i.test(segment)
    && !/^\.env(?!\.example$)/i.test(segment)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment)
    && !/\.(pem|key|p12|pfx)$/i.test(segment))
}
export const sourcePath = z.string().refine(isSourcePath, 'Forbidden source path')
export function isGeneratedPath(path: string): boolean {
  if (!isSourcePath(path) || (path.toLowerCase() !== path && /\.sql$/i.test(path))) return false
  if (/^migrations\/[0-9]{4}_[a-z0-9_]+\.sql$/.test(path)) return true
  if (!/^(app|components|lib)\/.+\.(ts|tsx|css|json)$/.test(path)) return false
  return !path.split('/').some(s => /^(?:__tests__|tests|instrumentation|middleware)(?:\.|$)/i.test(s))
    && !/(?:^|\/)(?:package|tsconfig)(?:\.[^/]*)?\.json$|\.(?:test|spec)\.[^/]+$/i.test(path)
}
export const generatedPath = sourcePath.refine(isGeneratedPath, 'Path is outside generated roots')
export function assertUniquePaths(paths: string[]): void {
  const normalized = paths.map(p => sourcePath.parse(p).toLowerCase())
  if (new Set(normalized).size !== paths.length) throw new Error('Duplicate case-folded path')
  const all = new Set(normalized)
  for (const path of all) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++)
      if (all.has(parts.slice(0, i).join('/'))) throw new Error('File/directory collision')
  }
}
