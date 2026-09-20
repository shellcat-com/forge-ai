import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import {
  preparePortfolioPublication,
  validateStaticFiles,
} from '../../engine/publishing/portfolio.ts'
import type {
  ApprovedPublication,
  PublicationAuthority,
} from '../../engine/publishing/portfolio.ts'
import { validateVercelTarget, writePrebuiltDirectory } from '../../engine/publishing/prebuilt.ts'
import { descriptor, manifest, id, hash, now } from './fixtures.ts'
import { checkIds } from '../../engine/contracts/primitives.ts'

// All credentials, authority and runner data here are explicit unit fixtures.
// Relabeling these synthetic inputs is NOT a live generation/runner receipt.
const bytes = Buffer.from(
  '<!doctype html><title>Demonstration portfolio</title><h1>Demonstration content</h1>'
)
const target = {
  teamId: 'team_UnitTest',
  projectId: 'prj_UnitTest',
  projectName: 'forge-test-portfolio',
}
function setup() {
  const source = {
    ...manifest,
    provenance: {
      ...manifest.provenance,
      origin: 'provider',
      provider: 'fixture-protocol',
      model: 'fixture-model',
    },
  }
  const metadata = [{ path: 'build/static/index.html', sha256: sha256(bytes), bytes: bytes.length }]
  const desc = {
    ...descriptor,
    sourceManifestDigest: canonicalHash(source),
    commandPolicyDigest: source.commandPolicyDigest,
  }
  const verification = {
    schemaVersion: 1,
    workspaceId: desc.workspaceId,
    projectId: desc.projectId,
    jobId: desc.jobId,
    origin: 'runner',
    candidateDigest: desc.sourceManifestDigest,
    templateDigest: desc.templateDigest,
    imageDigest: desc.imageDigest,
    policyDigest: desc.commandPolicyDigest,
    buildOutputDigest: canonicalHash(metadata),
    leaseEpoch: desc.leaseEpoch,
    checks: checkIds.map((checkId) => ({
      checkId,
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      timedOut: false,
      oom: false,
      evidenceDigest: hash,
    })),
  }
  const approved: ApprovedPublication = {
    publicationId: id(30),
    revision: 1,
    target,
    sourceCommit: 'a'.repeat(40),
    snapshotId: id(31),
    manifest: source,
    descriptor: desc,
    verification,
    files: metadata,
    expiresAt: '2026-09-09T13:00:00.000Z',
    approval: {
      candidateDigest: canonicalHash(source),
      buildOutputDigest: verification.buildOutputDigest,
      targetDigest: canonicalHash(target),
      contentReviewDigest: hash,
      providerUsageEvidenceDigest: hash,
      profile: 'next-postgres-portfolio-static-v1',
      fixture: false,
    },
    scannerPolicyDigest: hash,
  }
  const authority: PublicationAuthority = {
    loadApproved: vi.fn(async () => approved),
    revalidate: vi.fn(async () => {}),
    readBuildFile: vi.fn(async () => bytes),
    forbiddenValues: () => [],
  }
  const run = (signal = new AbortController().signal) =>
    preparePortfolioPublication(id(30), authority, signal, new Date(now))
  return { approved, authority, run, source, verification, metadata }
}
describe('static portfolio publication contract (synthetic authority only)', () => {
  it('preserves exact engine/build bindings and rechecks authorization after artifact reads', async () => {
    const { run, authority, verification } = setup()
    const result = await run()
    expect(result.files).toEqual([{ path: 'index.html', bytes }])
    expect(result.receipt.buildOutputDigest).toBe(verification.buildOutputDigest)
    expect(result.receipt.kind).toBe('provider-portfolio')
    expect(authority.revalidate).toHaveBeenCalledWith(id(30), 1, expect.any(AbortSignal))
    expect(JSON.stringify(result.receipt)).not.toContain('Demonstration content')
  })
  it.each(['fixture', 'restore'])('refuses %s source provenance', async (origin) => {
    const { source, run } = setup()
    source.provenance.origin = origin
    await expect(run()).rejects.toThrow()
  })
  it('refuses fixture verification even with successful check exit codes', async () => {
    const { verification, run } = setup()
    verification.origin = 'fixture'
    await expect(run()).rejects.toThrow()
  })
  it.each([
    'candidate',
    'target',
    'output',
    'commit',
    'expired',
    'future',
    'policy',
    'scope',
    'check',
    'stale',
  ])('refuses %s mismatch', async (field) => {
    const { approved, run, verification } = setup()
    if (field === 'candidate') approved.approval.candidateDigest = 'f'.repeat(64)
    if (field === 'target') approved.target = { ...target, projectId: 'prj_Other' }
    if (field === 'output')
      approved.files = [{ path: 'build/static/index.html', bytes: bytes.length, sha256: hash }]
    if (field === 'commit') approved.sourceCommit = 'main'
    if (field === 'expired') approved.expiresAt = now
    if (field === 'future') approved.expiresAt = '2027-09-09T13:00:00.000Z'
    if (field === 'policy') verification.policyDigest = 'f'.repeat(64)
    if (field === 'scope') verification.projectId = id(42)
    if (field === 'check') verification.checks[0].exitCode = 1
    if (field === 'stale') verification.checks[0].finishedAt = '2026-09-07T12:00:00.000Z'
    await expect(run()).rejects.toThrow()
  })
  it('rejects changed object bytes and permission revocation after read', async () => {
    const first = setup()
    first.authority.readBuildFile = async () => Buffer.from('tampered')
    await expect(first.run()).rejects.toThrow('integrity')
    const second = setup()
    second.authority.revalidate = async () => {
      throw new Error('revoked')
    }
    await expect(second.run()).rejects.toThrow('revoked')
  })
  it('does no artifact I/O for a cancelled request', async () => {
    const { run, authority } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(run(controller.signal)).rejects.toThrow()
    expect(authority.loadApproved).not.toHaveBeenCalled()
  })
  it('rejects a full collected artifact containing non-static server output', async () => {
    const { metadata, verification, approved, run } = setup()
    metadata[0].path = 'build/server/index.html'
    verification.buildOutputDigest = canonicalHash(metadata)
    approved.approval.buildOutputDigest = verification.buildOutputDigest
    await expect(run()).rejects.toThrow('profile')
  })
  it.each([
    '../index.html',
    'api/index.html',
    '.env',
    'vercel.json',
    'index.html.map',
    'sw.js',
    'server/app.js',
  ])('rejects unsafe upload path %s', (path) => {
    expect(() =>
      validateStaticFiles(
        [
          { path: 'index.html', bytes },
          { path, bytes },
        ],
        []
      )
    ).toThrow()
  })
  it('rejects known, escaped and encoded credential canaries in public bytes', () => {
    const canary = 'task08-secret-canary'
    for (const representation of [
      canary,
      Buffer.from(canary).toString('base64'),
      canary.replace('s', '\\u0073'),
    ]) {
      expect(() =>
        validateStaticFiles([{ path: 'index.html', bytes: Buffer.from(representation) }], [canary])
      ).toThrow()
    }
  })
  it('rejects duplicate/case-fold paths and oversized output', () => {
    expect(() =>
      validateStaticFiles(
        [
          { path: 'index.html', bytes },
          { path: 'INDEX.html', bytes },
        ],
        []
      )
    ).toThrow()
    expect(() =>
      validateStaticFiles([{ path: 'index.html', bytes: new Uint8Array(11 * 1024 * 1024) }], [])
    ).toThrow()
  })
})
describe('prebuilt staging and Vercel target preflight', () => {
  const observed = {
    id: target.projectId,
    accountId: target.teamId,
    name: target.projectName,
    link: null,
    env: [],
    framework: null,
  }
  it('requires exact dedicated project/account and no Git-triggered builds or environment', () => {
    expect(validateVercelTarget(target, observed)).toEqual(target)
    for (const delta of [
      { id: 'prj_Other' },
      { accountId: 'team_Other' },
      { name: 'unrelated' },
      { link: { type: 'github' } },
      { env: [{}] },
      { env: undefined },
      { framework: 'nextjs' },
      { installCommand: 'npm ci' },
    ]) {
      expect(() => validateVercelTarget(target, { ...observed, ...delta })).toThrow()
    }
  })
  it('writes only static bytes and platform-owned configuration without executing app scripts', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'forge-publisher-unit-'))
    try {
      const dir = join(parent, 'stage')
      await writePrebuiltDirectory(
        dir,
        [{ path: 'index.html', bytes }],
        { origin: 'unit-fixture' },
        target
      )
      expect(await readFile(join(dir, '.vercel/output/static/index.html'))).toEqual(bytes)
      expect(
        JSON.parse(await readFile(join(dir, 'vercel.json'), 'utf8')).git.deploymentEnabled
      ).toBe(false)
      expect(
        JSON.parse(await readFile(join(dir, '.vercel/output/config.json'), 'utf8')).routes[0]
          .headers['Content-Security-Policy']
      ).toContain("connect-src 'none'")
      await expect(
        writePrebuiltDirectory(dir, [{ path: 'index.html', bytes }], {})
      ).rejects.toThrow()
      await symlink(dir, join(parent, 'alias'))
      await expect(
        writePrebuiltDirectory(join(parent, 'alias'), [{ path: 'index.html', bytes }], {})
      ).rejects.toThrow()
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
