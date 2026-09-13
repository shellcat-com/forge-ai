import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { ControlWorker, SimulatedWorkerCrash } from '../../engine/control/worker.ts'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { LocalSyntheticObjectBackend } from '../../engine/artifacts/local-backend.ts'
import { computeSourceDiff } from '../../engine/generation/source.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { candidateImageDigest } from '../../engine/integration/candidate-stage.ts'
import type { StageAdapter, StageInput, StageResult } from '../../engine/control/stage-adapter.ts'
import { createE2ControlHarness } from '../harness/e2-control.ts'
type Harness = Awaited<ReturnType<typeof createE2ControlHarness>>
let harness: Harness
let db: Harness['db'],
  service: Harness['service'],
  worker: Harness['worker'],
  sources: Harness['sources'],
  adapter: Harness['adapter'],
  control: Harness['control'],
  artifactRoot: string,
  actor: Harness['actor'],
  job: Harness['job'],
  state: Harness['state'],
  approve: Harness['approve'],
  reach: Harness['reach'],
  projectBody: Harness['projectBody']
beforeAll(async () => {
  harness = await createE2ControlHarness()
  ;({
    db,
    service,
    worker,
    sources,
    adapter,
    control,
    artifactRoot,
    actor,
    job,
    state,
    approve,
    reach,
    projectBody,
  } = harness)
}, 30000)
afterAll(async () => {
  await harness?.close()
})
beforeEach(async () => {
  await harness.reset()
})
it('connects actual 20-file candidate bytes through reviews, promotion, history, immutable export and source restoration (all execution is fixture)', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  const plan = await service.plan(a.token, j.id)
  expect(plan.plan.templateDigest).toBe(control.templateDigest)
  expect(plan.plan.briefHash).toBe(sha256(projectBody.brief))
  await reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL')
  const changes = await service.changes(a.token, j.id)
  expect(changes.manifest.files).toHaveLength(20)
  expect(changes.diff.unified).toContain('Synthetic candidate source')
  expect(changes.verification).toBe(null)
  expect((await state(a, j.id)).review).toMatchObject({
    diffDigest: changes.diff.sha256,
    imageDigest: candidateImageDigest,
  })
  await reach(a, j.id, 'AWAITING_PROMOTION')
  const verified = await service.changes(a.token, j.id)
  expect(verified.verification?.origin).toBe('fixture')
  expect(verified.verificationDigest).toBe(canonicalHash(verified.verification))
  expect((await state(a, j.id)).review).toMatchObject({
    verificationDigest: verified.verificationDigest,
  })
  await reach(a, j.id, 'SUCCEEDED')
  const p = (await service.getProject(a.token, j.projectId)).project
  expect(p.headSnapshotId).toBe(changes.snapshotId)
  const file = await service.file(a.token, changes.snapshotId, 'app/page.tsx')
  expect(sha256(file.bytes)).toBe(file.sha256)
  const exportResult = await service.sourceExport(a.token, changes.snapshotId, a.csrf, randomUUID())
  expect(Object.keys(unzipSync(exportResult.bytes))).toHaveLength(20)
  const reopened = new ArtifactStore(
    await LocalSyntheticObjectBackend.open(join(artifactRoot, 'objects'))
  )
  const source = await db.worker.scoped(a.workspace, (c) =>
    sources.snapshot(
      c,
      { workspaceId: a.workspace, projectId: j.projectId, jobId: j.id },
      changes.snapshotId
    )
  )
  expect(
    await reopened.read(
      { workspaceId: a.workspace, projectId: j.projectId, jobId: j.id },
      source.manifestArtifact
    )
  ).toBeInstanceOf(Uint8Array)
  const second = await service.admit(a.token, j.projectId, a.csrf, randomUUID(), {
    schemaVersion: 1,
    kind: 'generate',
    baseSnapshotId: changes.snapshotId,
    baseRevision: 2,
    instruction: 'Revise the explicitly synthetic source candidate.',
    modelPolicyId: 'fixture-v1',
    maxCostMicros: 0,
  })
  const secondId = (second.body.job as { id: string }).id
  await reach(a, secondId, 'SUCCEEDED')
  const secondSnapshot = (await state(a, secondId)).candidateSnapshotId!
  expect((await service.file(a.token, secondSnapshot, 'app/page.tsx')).sha256).not.toBe(file.sha256)
  const restored = await service.restore(a.token, changes.snapshotId, a.csrf, randomUUID(), {
    schemaVersion: 1,
    expectedProjectRevision: 3,
    maxCostMicros: 0,
    resetPreviewDataAcknowledged: true,
  })
  const restoredId = (restored.body.job as { id: string }).id
  await reach(a, restoredId, 'AWAITING_EXECUTION_APPROVAL')
  expect((await service.changes(a.token, restoredId)).manifest.provenance.origin).toBe('restore')
  await reach(a, restoredId, 'SUCCEEDED')
  expect((await service.getProject(a.token, j.projectId)).project.revision).toBe(4)
  expect(
    (await service.file(a.token, (await state(a, restoredId)).candidateSnapshotId!, 'app/page.tsx'))
      .sha256
  ).toBe(file.sha256)
  expect((await service.snapshots(a.token, j.projectId)).items).toHaveLength(3)
  const usage = (
    await db.admin.query(
      'SELECT sum(amount_micros)::text AS amount,count(*)::int AS n FROM forge_control.usage_ledger'
    )
  ).rows[0]
  expect(usage).toEqual({ amount: '0', n: 4 })
}, 30000)
function wrapper(change: (input: StageInput, result: StageResult) => StageResult): StageAdapter {
  return {
    origin: 'fixture',
    run: async (input, signal) => change(input, await adapter.run(input, signal)),
  }
}
it.each(['scope', 'hash', 'version', 'key'] as const)(
  'rejects wrong immutable reference %s before adoption',
  async (mode) => {
    const a = await actor(),
      j = await job(a)
    const bad = new ControlWorker(
      db.worker,
      wrapper((_input, result) => {
        if (result.kind !== 'stored-candidate') return result
        const ref = result.source.manifestArtifact
        if (mode === 'scope') ref.projectId = randomUUID()
        if (mode === 'hash') ref.sha256 = sha256('wrong')
        if (mode === 'version') ref.storageVersion = randomUUID()
        if (mode === 'key') ref.storageKey += '/wrong'
        return result
      }),
      {},
      control,
      sources
    )
    await reach(a, j.id, 'AWAITING_PLAN_APPROVAL', bad)
    await approve(a, j.id)
    await bad.runOnce()
    const current = await state(a, j.id)
    expect(current.cleanupPending).toBe(true)
    expect(current.candidateSnapshotId).toBe(null)
  }
)
it('rejects an invented plan resource grant and keeps plan metadata unadopted', async () => {
  const a = await actor(),
    j = await job(a)
  const bad = new ControlWorker(
    db.worker,
    wrapper((_input, result) => {
      if (result.kind === 'stored-plan') result.plan.resources.memoryMiB = 2048
      return result
    }),
    {},
    control,
    sources
  )
  await bad.runOnce()
  await bad.runOnce()
  expect((await state(a, j.id)).cleanupPending).toBe(true)
  expect(
    (await db.admin.query('SELECT count(*)::int AS n FROM forge_control.artifacts')).rows[0].n
  ).toBe(0)
})
it('refuses tenant-crossed source reads and nonzero candidate admission', async () => {
  const a = await actor(),
    b = await actor(),
    j = await job(a)
  await reach(a, j.id, 'SUCCEEDED')
  const snapshot = (await state(a, j.id)).candidateSnapshotId!
  await expect(service.files(b.token, snapshot)).rejects.toThrow()
  await expect(service.file(b.token, snapshot, 'app/page.tsx')).rejects.toThrow()
  await expect(service.sourceExport(a.token, snapshot, 'wrong', randomUUID())).rejects.toThrow()
  expect(() => control.policy(1)).toThrow('zero')
})
it('rejects adoption after lease loss during object validation', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await approve(a, j.id)
  const stale = new ControlWorker(
    db.worker,
    adapter,
    {
      beforeCommit: async () => {
        await db.admin.query(
          "UPDATE forge_control.job_steps SET lease_epoch=lease_epoch+1 WHERE job_id=$1 AND status='running'",
          [j.id]
        )
      },
    },
    control,
    sources
  )
  await stale.runOnce()
  expect((await state(a, j.id)).candidateSnapshotId).toBe(null)
  expect(
    (await db.admin.query('SELECT count(*)::int AS n FROM forge_control.snapshots')).rows[0].n
  ).toBe(0)
})
it('replays saved candidate references after crash without repeating the stage product', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await approve(a, j.id)
  const crash = new ControlWorker(
    db.worker,
    adapter,
    {
      afterResult: async () => {
        throw new SimulatedWorkerCrash()
      },
    },
    control,
    sources
  )
  await expect(crash.runOnce()).rejects.toBeInstanceOf(SimulatedWorkerCrash)
  await db.admin.query(
    "UPDATE forge_control.job_steps SET status='queued',lease_owner=NULL,lease_expires_at=NULL WHERE job_id=$1 AND status='running'",
    [j.id]
  )
  const neverRun: StageAdapter = {
    origin: 'fixture',
    run: async () => {
      throw new Error('Unexpected second product')
    },
  }
  const replay = new ControlWorker(db.worker, neverRun, {}, control, sources)
  const writes = vi.spyOn(sources.store, 'put')
  try {
    await replay.runOnce()
    expect(writes).not.toHaveBeenCalled()
  } finally {
    writes.mockRestore()
  }
  expect((await state(a, j.id)).state).toBe('VALIDATING')
  expect(
    (
      await db.admin.query(
        'SELECT count(*)::int AS n FROM forge_control.provider_attempts WHERE job_id=$1',
        [j.id]
      )
    ).rows[0].n
  ).toBe(2)
  await worker.runOnce()
  expect((await service.changes(a.token, j.id)).manifest.files).toHaveLength(20)
})
it('coalesces concurrent export retries into one adopted immutable attachment', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'SUCCEEDED')
  const snapshot = (await state(a, j.id)).candidateSnapshotId!,
    key = randomUUID()
  const [left, right] = await Promise.all([
    service.sourceExport(a.token, snapshot, a.csrf, key),
    service.sourceExport(a.token, snapshot, a.csrf, key),
  ])
  expect(left.artifactId).toBe(right.artifactId)
  expect(left.sha256).toBe(right.sha256)
  expect(left.bytes).toEqual(right.bytes)
  const replay = await service.sourceExport(a.token, snapshot, a.csrf, key)
  expect(replay.artifactId).toBe(left.artifactId)
  expect(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM forge_control.artifacts WHERE kind='source-export'"
      )
    ).rows[0].n
  ).toBe(1)
  expect((await service.artifactAttachment(a.token, j.id, replay.artifactId)).bytes).toEqual(
    replay.bytes
  )
})
it.each(['verification', 'policy', 'session'] as const)(
  'blocks export replay after %s revocation/expiry',
  async (reason) => {
    const a = await actor(),
      j = await job(a)
    await reach(a, j.id, 'SUCCEEDED')
    const snapshot = (await state(a, j.id)).candidateSnapshotId!,
      key = randomUUID()
    const exported = await service.sourceExport(a.token, snapshot, a.csrf, key)
    if (reason === 'verification')
      await db.admin.query(
        "UPDATE forge_control.artifacts SET expires_at=clock_timestamp()-interval '1 second' WHERE kind='verification' AND job_id=$1",
        [j.id]
      )
    if (reason === 'policy')
      await db.admin.query(
        "INSERT INTO forge_control.revoked_policies(digest,reason) VALUES($1,'synthetic test revocation')",
        [sources.scanPolicyDigest]
      )
    if (reason === 'session')
      await db.admin.query(
        'UPDATE forge_control.users SET disabled_at=clock_timestamp() WHERE id=$1',
        [a.id]
      )
    await expect(service.sourceExport(a.token, snapshot, a.csrf, key)).rejects.toThrow()
    await expect(service.artifactAttachment(a.token, j.id, exported.artifactId)).rejects.toThrow()
  }
)
it('refuses cached reference tampering during crash replay', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await approve(a, j.id)
  const crash = new ControlWorker(
    db.worker,
    adapter,
    {
      afterResult: async () => {
        throw new SimulatedWorkerCrash()
      },
    },
    control,
    sources
  )
  await expect(crash.runOnce()).rejects.toBeInstanceOf(SimulatedWorkerCrash)
  await db.admin.query(
    "UPDATE forge_control.fixture_operations SET result_json=jsonb_set(result_json,'{diff,sha256}',to_jsonb($2::text)) WHERE job_id=$1 AND result_json->>'kind'='stored-candidate'",
    [j.id, sha256('tampered')]
  )
  await db.admin.query(
    "UPDATE forge_control.job_steps SET status='queued',lease_owner=NULL,lease_expires_at=NULL WHERE job_id=$1 AND status='running'",
    [j.id]
  )
  await worker.runOnce()
  expect((await state(a, j.id)).candidateSnapshotId).toBe(null)
  expect((await state(a, j.id)).cleanupPending).toBe(true)
})
it('rejects a secret-bearing immutable candidate before reference adoption', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await approve(a, j.id)
  const bad: StageAdapter = {
    origin: 'fixture',
    run: async (input, signal) => {
      const result = await adapter.run(input, signal)
      if (result.kind !== 'stored-candidate') return result
      const scope = {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        jobId: input.jobId,
      }
      const blob = await sources.store.put(
        scope,
        'source-blob',
        Buffer.from('// FORGE_NATIVE_SECRET_CANARY_123456789')
      )
      const file = result.source.manifest.files.find((f) => f.path === 'app/page.tsx')!
      result.source.blobs = result.source.blobs.filter((b) => b.id !== file.blobId).concat(blob)
      Object.assign(file, { blobId: blob.id, sha256: blob.sha256, bytes: blob.bytes })
      result.source.manifestArtifact = await sources.store.putJson(
        scope,
        'source-manifest',
        result.source.manifest
      )
      return result
    },
  }
  await new ControlWorker(db.worker, bad, {}, control, sources).runOnce()
  expect((await state(a, j.id)).cleanupPending).toBe(true)
  expect((await state(a, j.id)).candidateSnapshotId).toBe(null)
})

it('uses the guarded artifact locator for available bytes without revealing foreign/missing metadata', async () => {
  const a = await actor(),
    b = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_EXECUTION_APPROVAL')
  const changes = await service.changes(a.token, j.id),
    id = changes.diff.artifactId
  const attachment = await service.artifactAttachmentById(a.token, id)
  expect(Buffer.from(attachment.bytes).toString('utf8')).toBe(changes.diff.unified)
  expect(attachment).not.toHaveProperty('storageKey')
  await expect(service.artifactAttachmentById(b.token, id)).rejects.toMatchObject({ code: 'P0404' })
  await expect(service.artifactAttachmentById(a.token, randomUUID())).rejects.toMatchObject({
    code: 'P0404',
  })
  await db.admin.query(
    "UPDATE forge_control.memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
    [a.workspace, a.id]
  )
  expect((await service.artifactAttachmentById(a.token, id)).sha256).toBe(changes.diff.sha256)
  await db.admin.query(
    "UPDATE forge_control.artifacts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id]
  )
  await expect(service.artifactAttachmentById(a.token, id)).rejects.toMatchObject({ code: 'P0404' })
})
it('reauthorizes a source read after object I/O and refuses revoked sessions', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'SUCCEEDED')
  const snapshot = (await state(a, j.id)).candidateSnapshotId!
  const original = sources.store.read.bind(sources.store)
  let revoked = false
  const spy = vi.spyOn(sources.store, 'read').mockImplementation(async (scope, ref) => {
    const bytes = await original(scope, ref)
    if (!revoked) {
      revoked = true
      await db.admin.query(
        'UPDATE forge_control.users SET disabled_at=clock_timestamp() WHERE id=$1',
        [a.id]
      )
    }
    return bytes
  })
  try {
    await expect(service.file(a.token, snapshot, 'app/page.tsx')).rejects.toThrow()
  } finally {
    spy.mockRestore()
  }
})

it('refuses exported attachment bytes after role downgrade to viewer', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'SUCCEEDED')
  const result = await service.sourceExport(
    a.token,
    (await state(a, j.id)).candidateSnapshotId!,
    a.csrf,
    randomUUID()
  )
  await db.admin.query(
    "UPDATE forge_control.memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
    [a.workspace, a.id]
  )
  await expect(service.artifactAttachmentById(a.token, result.artifactId)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })
})

it('revalidates stored candidates with identical diff bytes and zero object writes', async () => {
  const a = await actor(),
    j = await job(a)
  await reach(a, j.id, 'AWAITING_PLAN_APPROVAL')
  await approve(a, j.id)
  const step = (await worker.claim())!,
    prepared = await worker.prepare(step)
  const candidate = await adapter.run(prepared.input, new AbortController().signal)
  if (candidate.kind !== 'stored-candidate') throw new Error('Expected stored candidate')
  const scope = { workspaceId: a.workspace, projectId: j.projectId, jobId: j.id }
  const originalBytes = await sources.store.read(scope, candidate.diff)
  const writes = vi.spyOn(sources.store, 'put')
  try {
    const computed = await computeSourceDiff(
      sources.store,
      scope,
      prepared.input.baseSource!,
      candidate.source
    )
    expect(Buffer.from(computed.unified)).toEqual(Buffer.from(originalBytes))
    await sources.validateResult(prepared.input, candidate, control)
    await sources.validateResult(prepared.input, candidate, control)
    expect(writes).not.toHaveBeenCalled()
    expect(sha256(computed.unified)).toBe(candidate.diff.sha256)
  } finally {
    writes.mockRestore()
  }
})
