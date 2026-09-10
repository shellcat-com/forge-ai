import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HostInventory } from '../../runner/host/inventory.ts'
import { HostPreviewRuntime } from '../../engine/preview/host-runtime.ts'
import type { PreviewGrant } from '../../engine/preview/control.ts'
import { descriptor, id, hash, now } from './fixtures.ts'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-preview-host-fixture-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const inventory = await HostInventory.acquire(root)
  cleanup.push(() => inventory.close())
  const d = { ...descriptor, kind: 'preview' as const }
  await inventory.transaction((state) => {
    state.lastObservedAt = Date.parse(now)
    state.records[d.operationId] = {
      descriptor: d,
      bindingDigest: hash,
      launchAttemptId: id(90),
      state: 'running',
      createdAt: Date.parse(now),
      tombstone: false,
      launchUncertain: false,
      resourcesReserved: true,
      ingressRevoked: false,
      cleanupEvidenceDigest: null,
    }
  })
  const grant: PreviewGrant = {
    schemaVersion: 1,
    previewId: id(91),
    generation: id(92),
    snapshotId: id(93),
    workspaceId: d.workspaceId,
    projectId: d.projectId,
    jobId: d.jobId,
    userId: id(94),
    hostname: 'fixture.vercel.app',
    state: 'READY',
    authorized: true,
    authorizedAt: now,
    sessionExpiresAt: d.expiresAt,
    idleExpiresAt: d.expiresAt,
    absoluteExpiresAt: d.expiresAt,
    environmentId: d.environmentId,
    operationId: d.operationId,
    leaseEpoch: d.leaseEpoch,
    sourceManifestDigest: d.sourceManifestDigest,
    templateDigest: d.templateDigest,
  }
  let calls = 0,
    unhealthy = false,
    mutate = false
  const runtime = new HostPreviewRuntime(
    inventory,
    {
      async health(receipt) {
        expect(receipt).toEqual(d)
        calls++
        return { processReady: true, databaseReady: !unhealthy }
      },
      async requestApp(receipt, request) {
        expect(receipt).toEqual(d)
        calls++
        if (mutate && request.path !== '/api/health')
          await inventory.transaction((s) => {
            s.records[d.operationId].tombstone = true
          })
        return { status: unhealthy ? 503 : 200, headers: {}, body: new TextEncoder().encode('{}') }
      },
    },
    new Map([[d.templateDigest, d.imageDigest]]),
    () => Date.parse(now)
  )
  const request = () =>
    runtime.request(
      grant,
      { method: 'GET', path: '/', headers: {}, body: new Uint8Array() },
      new AbortController().signal
    )
  return {
    inventory,
    grant,
    d,
    request,
    calls: () => calls,
    unhealthy: () => {
      unhealthy = true
    },
    mutate: () => {
      mutate = true
    },
  }
}
it('routes only exact source/image/tenant/environment receipt and checks app readiness', async () => {
  const f = await fixture()
  expect((await f.request()).status).toBe(200)
  expect(f.calls()).toBe(2)
  f.grant.environmentId = id(99)
  await expect(f.request()).rejects.toThrow()
  expect(f.calls()).toBe(2)
})
it.each(['tombstone', 'ingress', 'epoch', 'source', 'image', 'expiry'])(
  'rejects %s before any guest request',
  async (fault) => {
    const f = await fixture()
    await f.inventory.transaction((s) => {
      const r = s.records[f.d.operationId]
      if (fault === 'tombstone') r.tombstone = true
      if (fault === 'ingress') r.ingressRevoked = true
      if (fault === 'epoch') r.descriptor.leaseEpoch++
      if (fault === 'source') r.descriptor.sourceManifestDigest = 'b'.repeat(64)
      if (fault === 'image') r.descriptor.imageDigest = `sha256:${'b'.repeat(64)}`
      if (fault === 'expiry') {
        r.descriptor.issuedAt = new Date(Date.parse(now) - 60_001).toISOString()
        r.descriptor.expiresAt = new Date(Date.parse(now) - 1).toISOString()
      }
    })
    await expect(f.request()).rejects.toThrow()
    expect(f.calls()).toBe(0)
  }
)
it('withholds output if tombstoned during request and denies unhealthy app', async () => {
  const f = await fixture()
  f.unhealthy()
  await expect(f.request()).rejects.toThrow('UNHEALTHY')
  expect(f.calls()).toBe(1)
  const g = await fixture()
  g.mutate()
  await expect(g.request()).rejects.toThrow('UNAVAILABLE')
})
