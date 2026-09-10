import { artifactRefSchema } from '../artifacts/store.ts'
import type { ArtifactRef, ArtifactScope, ArtifactStore } from '../artifacts/store.ts'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { manifestSchema, planSchema, validateProposal } from '../contracts/source.ts'
import type { TemplateCatalog } from '../generation/catalog.ts'
import {
  prepareDiff,
  computeSourceDiff,
  readSourceFile,
  restoreSource,
  validateStoredSource,
} from '../generation/source.ts'
import type { StoredSource } from '../generation/source.ts'
import { one } from '../control/database.ts'
import type { Tx } from '../control/database.ts'
import type { JobRow } from '../control/state.ts'
import { scopeOf } from '../control/state.ts'
import type { StageInput, StageResult } from '../control/stage-adapter.ts'
import type { ControlCatalog } from '../control/catalog.ts'
import { storedSourceSchema } from './contracts.ts'
import type { StoredCandidate } from './contracts.ts'
import { validateMigrationSql } from '../validation/migrations.ts'

/** DB metadata operations never fetch objects. read/validate/restore must run
 * outside control transactions; adopt is called only by the worker lease CAS. */
export class SourceRepository {
  constructor(
    readonly store: ArtifactStore,
    readonly catalog: TemplateCatalog,
    readonly scan: (
      files: readonly { path: string; bytes: Uint8Array }[],
      digest: string
    ) => Promise<void>,
    readonly scanPolicyDigest: string = catalog.manifest.commandPolicyDigest
  ) {}
  async ref(c: Tx, scope: ArtifactScope, id: string): Promise<ArtifactRef> {
    const row = await one<Record<string, unknown>>(
      c,
      "SELECT * FROM artifacts WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND status='available' AND (expires_at IS NULL OR expires_at>clock_timestamp())",
      [id, scope.workspaceId, scope.projectId]
    )
    return artifactRefSchema.parse({
      schemaVersion: 1,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      jobId: row.job_id,
      id: row.id,
      kind: row.kind,
      sha256: row.sha256,
      bytes: Number(row.bytes),
      storageKey: row.object_key,
      storageVersion: row.object_version,
      state: 'available',
      backendEvidence: 'fixture',
    })
  }
  async source(c: Tx, scope: ArtifactScope, manifestId: string): Promise<StoredSource> {
    const manifestArtifact = await this.ref(c, scope, manifestId)
    const { payload_json } = await one<{ payload_json: unknown }>(
      c,
      'SELECT payload_json FROM fixture_artifact_payloads WHERE artifact_id=$1',
      [manifestId]
    )
    const manifest = manifestSchema.parse(payload_json)
    const blobs: ArtifactRef[] = []
    for (const f of manifest.files) blobs.push(await this.ref(c, scope, f.blobId))
    return storedSourceSchema.parse({ manifest, manifestArtifact, blobs })
  }
  async snapshot(c: Tx, scope: ArtifactScope, id: string, verified = false) {
    const row = await one<{ manifest_artifact_id: string }>(
      c,
      `SELECT manifest_artifact_id FROM snapshots WHERE id=$1 AND workspace_id=$2 AND project_id=$3 ${verified ? "AND status='verified'" : ''}`,
      [id, scope.workspaceId, scope.projectId]
    )
    return this.source(c, scope, row.manifest_artifact_id)
  }
  async input(c: Tx, j: JobRow): Promise<Pick<StageInput, 'baseSource' | 'selectedSource'>> {
    const scope = scopeOf(j)
    const row = (
      await c.query<{ base_manifest_artifact_id: string }>(
        'SELECT base_manifest_artifact_id FROM job_source_contexts WHERE job_id=$1',
        [j.id]
      )
    ).rows[0]
    const baseSource = row
      ? await this.source(c, scope, row.base_manifest_artifact_id)
      : j.base_snapshot_id
        ? await this.snapshot(c, scope, j.base_snapshot_id, true)
        : undefined
    const selectedSource =
      j.kind === 'restore'
        ? await this.snapshot(c, scope, String(j.request_json.restoreSnapshotId), true)
        : undefined
    return { ...(baseSource ? { baseSource } : {}), ...(selectedSource ? { selectedSource } : {}) }
  }
  async validate(scope: ArtifactScope, source: StoredSource) {
    const parsed = storedSourceSchema.parse(source)
    if (
      parsed.blobs.length !== parsed.manifest.files.length ||
      new Set(parsed.blobs.map((b) => b.id)).size !== parsed.blobs.length ||
      new Set(parsed.manifest.files.map((f) => f.blobId)).size !== parsed.manifest.files.length ||
      parsed.blobs.some(
        (b) => b.kind !== 'source-blob' || !parsed.manifest.files.some((f) => f.blobId === b.id)
      ) ||
      [parsed.manifestArtifact, ...parsed.blobs].some((ref) => ref.backendEvidence !== 'fixture')
    )
      throw new Error('Fixture source reference set')
    await validateStoredSource(this.store, scope, parsed, this.catalog)
    // Verify actual manifest object content, not only caller-provided metadata.
    const bytes = await this.store.read(scope, parsed.manifestArtifact)
    if (
      canonicalHash(JSON.parse(Buffer.from(bytes).toString('utf8'))) !==
      canonicalHash(parsed.manifest)
    )
      throw new Error('Manifest bytes mismatch')
    const files = await Promise.all(
      parsed.manifest.files.map(async (f) => ({
        path: f.path,
        bytes: await readSourceFile(this.store, scope, parsed, f.path),
      }))
    )
    for (const file of files.filter((f) => f.path.startsWith('migrations/')))
      validateMigrationSql(Buffer.from(file.bytes).toString('utf8'))
    await this.scan(files, canonicalHash(parsed.manifest))
    return parsed
  }
  async validateResult(
    input: StageInput,
    result: StageResult,
    control: ControlCatalog
  ): Promise<void> {
    const scope = { workspaceId: input.workspaceId, projectId: input.projectId, jobId: input.jobId }
    const policy = control.policy(input.maxCostMicros)
    if (result.kind === 'stored-plan') {
      const plan = planSchema.parse(result.plan)
      const base = await this.validate(scope, result.base)
      if (
        input.baseSource
          ? canonicalHash(input.baseSource) !== canonicalHash(base)
          : base.manifest.provenance.jobId !== input.jobId ||
            base.manifest.provenance.promptVersion !== 'template-seed-v1' ||
            base.manifest.files.length !== this.catalog.files().length ||
            base.manifest.files.some(
              (f) =>
                !this.catalog.files().some((t) => t.path === f.path && sha256(t.bytes) === f.sha256)
            )
      )
        throw new Error('Plan base mismatch')
      if (
        plan.briefHash !== sha256(input.instruction) ||
        plan.templateDigest !== control.templateDigest ||
        plan.presetDigest !== control.presetDigest ||
        plan.presetDigest !== base.manifest.presetDigest ||
        canonicalHash(plan.resources) !== canonicalHash(policy.resources) ||
        canonicalHash(plan.network) !== canonicalHash(policy.network) ||
        canonicalHash(plan.requiredChecks) !== canonicalHash(policy.requiredChecks) ||
        plan.unsupportedRequirements.length
      )
        throw new Error('Plan binding')
      if (
        result.planArtifact.kind !== 'plan' ||
        result.planArtifact.jobId !== input.jobId ||
        result.planArtifact.sha256 !== canonicalHash(plan)
      )
        throw new Error('Plan artifact binding')
      await this.store.read(scope, result.planArtifact)
    } else if (result.kind === 'stored-candidate') {
      if (!input.baseSource) throw new Error('Candidate base unavailable')
      const base = await this.validate(scope, input.baseSource)
      const source = await this.validate(scope, result.source)
      const m = source.manifest
      if (
        m.provenance.jobId !== input.jobId ||
        m.baseSnapshotId !== input.baseSnapshotId ||
        m.presetDigest !== control.presetDigest ||
        m.template.digest !== control.templateDigest ||
        m.commandPolicyDigest !== canonicalHash(policy) ||
        source.manifestArtifact.jobId !== input.jobId ||
        result.diff.jobId !== input.jobId ||
        result.diff.kind !== 'diff'
      )
        throw new Error('Candidate binding')
      const expected = await computeSourceDiff(this.store, scope, base, source)
      if (input.selectedSource) {
        const selected = await this.validate(scope, input.selectedSource)
        if (
          m.provenance.origin !== 'restore' ||
          canonicalHash(m.files) !== canonicalHash(selected.manifest.files) ||
          canonicalHash(m.migrations) !== canonicalHash(selected.manifest.migrations) ||
          m.planDigest !== selected.manifest.planDigest ||
          m.presetDigest !== selected.manifest.presetDigest
        )
          throw new Error('Restore source mismatch')
      } else {
        if (
          !input.plan ||
          m.provenance.origin !== 'fixture' ||
          m.planDigest !== canonicalHash(input.plan)
        )
          throw new Error('Candidate plan mismatch')
        const changes = expected.files.map((f) =>
          f.op === 'create'
            ? { op: f.op, path: f.path, content: f.after! }
            : f.op === 'replace'
              ? { op: f.op, path: f.path, expectedSha256: sha256(f.before!), content: f.after! }
              : { op: f.op, path: f.path, expectedSha256: sha256(f.before!) }
        )
        if (
          input.plan.fileTasks.some((task) => !changes.some((change) => change.path === task.path))
        )
          throw new Error('Incomplete candidate file tasks')
        validateProposal(
          input.plan,
          base.manifest,
          [
            {
              schemaVersion: 1,
              planDigest: m.planDigest,
              baseManifestDigest: canonicalHash(base.manifest),
              batchIndex: 0,
              finalBatch: true,
              changes,
            },
          ],
          this.catalog.manifest.protectedPaths
        )
        if (
          base.manifest.migrations.some(
            (v, i) => canonicalHash(v) !== canonicalHash(m.migrations[i] ?? null)
          )
        )
          throw new Error('Migration history changed')
      }
      if (
        sha256(expected.unified) !== result.diff.sha256 ||
        Buffer.byteLength(expected.unified) !== result.diff.bytes
      )
        throw new Error('Diff binding')
      await this.store.read(scope, result.diff)
    } else if (['PLANNING', 'GENERATING', 'REPAIRING'].includes(input.stage))
      throw new Error('Stored source result required')
  }
  async restoration(input: StageInput): Promise<StoredCandidate> {
    if (!input.selectedSource || !input.baseSource) throw new Error('Restore context unavailable')
    const scope = { workspaceId: input.workspaceId, projectId: input.projectId, jobId: input.jobId }
    const source = await restoreSource(
      this.store,
      scope,
      this.catalog,
      input.selectedSource,
      input.baseSnapshotId
    )
    const diff = await prepareDiff(this.store, scope, input.baseSource, source)
    return {
      schemaVersion: 1,
      origin: 'fixture',
      kind: 'stored-candidate',
      source,
      diff: diff.artifact,
    }
  }
  async adoptRef(c: Tx, j: JobRow, input: ArtifactRef, payload?: unknown) {
    const ref = artifactRefSchema.parse(input)
    if (
      ref.workspaceId !== j.workspace_id ||
      ref.projectId !== j.project_id ||
      ref.backendEvidence !== 'fixture'
    )
      throw new Error('Artifact scope mismatch')
    const prior = (await c.query('SELECT id FROM artifacts WHERE id=$1', [ref.id])).rows[0]
    if (prior) {
      if (canonicalHash(await this.ref(c, scopeOf(j), ref.id)) !== canonicalHash(ref))
        throw new Error('Artifact metadata changed')
    } else {
      if (ref.jobId !== j.id) throw new Error('Unadopted prior-job artifact')
      await c.query(
        "INSERT INTO artifacts(id,workspace_id,project_id,job_id,kind,object_key,object_version,sha256,bytes,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'available')",
        [
          ref.id,
          ref.workspaceId,
          ref.projectId,
          ref.jobId,
          ref.kind,
          ref.storageKey,
          ref.storageVersion,
          ref.sha256,
          ref.bytes,
        ]
      )
      if (payload !== undefined)
        await c.query(
          'INSERT INTO fixture_artifact_payloads(workspace_id,project_id,artifact_id,payload_json) VALUES($1,$2,$3,$4)',
          [j.workspace_id, j.project_id, ref.id, payload]
        )
    }
    return ref.id
  }
  async adoptSource(c: Tx, j: JobRow, source: StoredSource) {
    for (const ref of source.blobs) await this.adoptRef(c, j, ref)
    return this.adoptRef(c, j, source.manifestArtifact, source.manifest)
  }
  async bindBase(c: Tx, j: JobRow, source: StoredSource) {
    const id = await this.adoptSource(c, j, source)
    await c.query(
      'INSERT INTO job_source_contexts(workspace_id,project_id,job_id,base_manifest_artifact_id) VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO NOTHING',
      [j.workspace_id, j.project_id, j.id, id]
    )
    const row = await one<{ base_manifest_artifact_id: string }>(
      c,
      'SELECT base_manifest_artifact_id FROM job_source_contexts WHERE job_id=$1',
      [j.id]
    )
    if (row.base_manifest_artifact_id !== id) throw new Error('Immutable base changed')
  }
}
