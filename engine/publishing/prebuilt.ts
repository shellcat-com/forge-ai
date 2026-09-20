import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalHash, canonicalJson } from '../contracts/canonical.ts'
import { publicTargetSchema, validateStaticFiles } from './portfolio.ts'
import type { PublicTarget, StaticFile } from './portfolio.ts'

export const publicHeaders = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'public, max-age=0, must-revalidate',
} as const
export const prebuiltConfig = {
  version: 3,
  routes: [
    { src: '/.*', headers: publicHeaders, continue: true },
    { src: '/api(?:/.*)?', status: 404 },
    { handle: 'filesystem' },
    { src: '/', dest: '/index.html' },
    { src: '/.*', status: 404 },
  ],
}
export interface ObservedTarget {
  id: string
  accountId: string
  name: string
  link?: unknown
  env?: readonly unknown[]
  framework?: string | null
  buildCommand?: string | null
  installCommand?: string | null
}
/** API responses must come from authenticated Vercel GETs, not from user JSON.
 * For this narrow deployment path, project reuse is intentionally restrictive. */
export function validateVercelTarget(targetInput: PublicTarget, observed: ObservedTarget) {
  const target = publicTargetSchema.parse(targetInput)
  if (
    target.projectId !== observed.id ||
    target.teamId !== observed.accountId ||
    target.projectName !== observed.name ||
    observed.link != null ||
    !Array.isArray(observed.env) ||
    observed.env.length !== 0 ||
    observed.framework != null ||
    observed.buildCommand ||
    observed.installCommand
  ) {
    throw new Error('Vercel target is not a dedicated empty static project')
  }
  return target
}

/** Writes only a new private staging directory. No generated code is imported,
 * installed, built, or executed. Caller must own the parent; no existing path is
 * followed or overwritten. Receipt lives outside public static assets. */
export async function writePrebuiltDirectory(
  directory: string,
  filesInput: readonly StaticFile[],
  receipt: object,
  targetInput?: PublicTarget
) {
  const files = filesInput.map((f) => ({ path: f.path, bytes: f.bytes.slice() }))
  const metadata = validateStaticFiles(files, [])
  const target = targetInput ? publicTargetSchema.parse(targetInput) : undefined
  await mkdir(directory, { mode: 0o700 })
  await mkdir(join(directory, '.vercel', 'output', 'static'), { recursive: true, mode: 0o700 })
  for (const f of files) {
    const parts = f.path.split('/')
    parts.pop()
    await mkdir(join(directory, '.vercel', 'output', 'static', ...parts), {
      recursive: true,
      mode: 0o700,
    })
    await writeFile(join(directory, '.vercel', 'output', 'static', f.path), f.bytes, {
      flag: 'wx',
      mode: 0o644,
    })
  }
  await writeFile(
    join(directory, '.vercel', 'output', 'config.json'),
    JSON.stringify(prebuiltConfig),
    { flag: 'wx' }
  )
  await writeFile(
    join(directory, 'vercel.json'),
    JSON.stringify({ git: { deploymentEnabled: false } }),
    { flag: 'wx' }
  )
  if (target)
    await writeFile(
      join(directory, '.vercel', 'project.json'),
      JSON.stringify({
        projectId: target.projectId,
        orgId: target.teamId,
      }),
      { flag: 'wx', mode: 0o600 }
    )
  const record = {
    schemaVersion: 1,
    receipt,
    files: metadata,
    staticFilesDigest: canonicalHash(metadata),
    configurationDigest: canonicalHash(prebuiltConfig),
    target: target ?? null,
  }
  await writeFile(join(directory, 'publication-receipt.json'), canonicalJson(record), {
    flag: 'wx',
    mode: 0o600,
  })
  return record
}
