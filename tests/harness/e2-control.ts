import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startNativePostgres } from '../engine/native-postgres.ts'
import { FixtureIdentityAdapter, SessionService } from '../../engine/control/identity.ts'
import { ControlService } from '../../engine/control/service.ts'
import { ControlWorker } from '../../engine/control/worker.ts'
import { ArtifactStore } from '../../engine/artifacts/store.ts'
import { LocalSyntheticObjectBackend } from '../../engine/artifacts/local-backend.ts'
import { TemplateCatalog, templateCatalogDigest } from '../../engine/generation/catalog.ts'
import type { CatalogFile } from '../../engine/generation/catalog.ts'
import type { TemplateManifestV1 } from '../../engine/contracts/source.ts'
import { canonicalHash, sha256 } from '../../engine/contracts/canonical.ts'
import { templateCommandPolicy } from '../../templates/next-postgres-v1/policy.ts'
import { fixturePolicy } from '../../engine/control/catalog.ts'
import { sourceExportScanner } from '../../engine/validation/secrets.ts'
import { SourceRepository } from '../../engine/integration/source-repository.ts'
import {
  CandidateStageAdapter,
  candidateControlCatalog,
  candidateImageDigest,
} from '../../engine/integration/candidate-stage.ts'
export interface E2Actor {
  id: string
  workspace: string
  subject: string
  token: string
  csrf: string
  cookie: string
}
/** Trusted local native-PostgreSQL + immutable filesystem fixture. No provider or app execution. */
export async function createE2ControlHarness(origin = 'http://127.0.0.1:0', preset = { id: 'fixture', version: 1 }) {
  const db = await startNativePostgres()
  let artifactRoot = ''
  try {
    await db.admin.query(
      await readFile(
        new URL('../../engine/migrations/0003_immutable_source_bridge.sql', import.meta.url),
        'utf8'
      )
    )
    const identity = await FixtureIdentityAdapter.create()
    const sessions = new SessionService(db.api, identity, randomBytes(32), origin)
    const paths = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'README.md',
      '.env.example',
      '.gitignore',
      'next.config.mjs',
      'next-env.d.ts',
      'eslint.config.mjs',
      'app-database.sql',
      'postgresql.conf',
      'pg_hba.conf',
      'app/layout.tsx',
      'app/page.tsx',
      'app/globals.css',
      'app/api/health/route.ts',
      'components/EmptyState.tsx',
      'lib/database.ts',
      'platform/environment.ts',
      'platform/environment.test.ts',
    ]
    const files: CatalogFile[] = await Promise.all(
      paths.map(async (path) => ({
        path,
        mediaType: path.endsWith('.json')
          ? 'application/json'
          : path.endsWith('.css')
            ? 'text/css'
            : path.endsWith('.sql')
              ? 'application/sql'
              : /\.(?:tsx?|mjs)$/.test(path)
                ? 'text/typescript'
                : 'text/plain',
        bytes: await readFile(new URL(`../../templates/next-postgres-v1/${path}`, import.meta.url)),
      }))
    )
    const policy = templateCommandPolicy(fixturePolicy(0).resources)
    const manifest: TemplateManifestV1 = {
      schemaVersion: 1,
      template: {
        id: 'next-postgres-v1',
        digest: sha256('pending'),
        imageDigest: candidateImageDigest,
      },
      stack: 'nextjs-strict-typescript-postgresql',
      releases: { next: '16.3.4', node: '24.20.0', postgres: '18.6' },
      lockfileDigest: sha256(files.find((f) => f.path === 'package-lock.json')!.bytes),
      commandPolicyDigest: canonicalHash(policy),
      requiredChecks: policy.requiredChecks,
      protectedPaths: paths.filter(
        (path) => !path.startsWith('app/') && !path.startsWith('components/')
      ),
    }
    manifest.template.digest = templateCatalogDigest(manifest, files)
    const catalog = new TemplateCatalog({ manifest, files, evidence: 'fixture' })
    artifactRoot = await realpath(await mkdtemp(join(tmpdir(), 'forge-e2-native-artifacts-')))
    await mkdir(join(artifactRoot, 'objects'), { mode: 0o700 })
    const store = new ArtifactStore(
      await LocalSyntheticObjectBackend.open(join(artifactRoot, 'objects'))
    )
    const sources = new SourceRepository(
      store,
      catalog,
      sourceExportScanner({
        policyDigest: canonicalHash(policy),
        forbiddenValues: ['FORGE_NATIVE_SECRET_CANARY_123456789'],
        placeholderExampleDigest: sha256(files.find((f) => f.path === '.env.example')!.bytes),
      })
    )
    const control = candidateControlCatalog(sources, policy, preset)
    const adapter = new CandidateStageAdapter(sources, control, preset)
    const service = new ControlService(db.api, sessions, true, control, sources)
    const worker = new ControlWorker(db.worker, adapter, {}, control, sources)
    async function actor(role = 'owner'): Promise<E2Actor> {
      const id = randomUUID(),
        workspace = randomUUID(),
        subject = `fixture-${id}`
      await db.admin.query(
        `INSERT INTO forge_control.users(id,oidc_issuer,oidc_subject) VALUES($1,$2,$3);`,
        [id, identity.issuer, subject]
      )
      await db.admin.query('INSERT INTO forge_control.workspaces(id,name) VALUES($1,$2)', [
        workspace,
        'Synthetic E1 workspace',
      ])
      await db.admin.query(
        'INSERT INTO forge_control.memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',
        [workspace, id, role]
      )
      await db.admin.query(
        `INSERT INTO forge_control.workspace_quotas(workspace_id,period_start,limit_micros,max_active_jobs,max_previews) VALUES($1,date_trunc('day',now()),1000,10,2)`,
        [workspace]
      )
      const b = sessions.bootstrap(),
        login = await sessions.login(b.cookie, randomUUID(), {
          schemaVersion: 1,
          returnPath: '/#/projects',
          bootstrapNonce: b.nonce,
        })
      const code = await identity.issueCode(login.authorizationUrl, subject),
        result = await sessions.callback(b.cookie, code.state, code.code)
      return {
        id,
        workspace,
        subject,
        token: result.token,
        csrf: result.csrfToken,
        cookie: `__Host-forge-control=${result.token}`,
      }
    }

    const projectBody = {
      schemaVersion: 1,
      name: 'Candidate source fixture',
      brief: 'Render an explicitly synthetic source candidate.',
      presetId: preset.id,
      presetVersion: preset.version,
      templateId: 'next-postgres-v1',
    }
    async function job(a: E2Actor) {
      const project = await service.createProject(
        a.token,
        a.workspace,
        a.csrf,
        randomUUID(),
        projectBody
      )
      const projectId = (project.body.project as { id: string }).id
      const result = await service.admit(a.token, projectId, a.csrf, randomUUID(), {
        schemaVersion: 1,
        kind: 'generate',
        baseSnapshotId: null,
        baseRevision: 1,
        instruction: projectBody.brief,
        modelPolicyId: 'fixture-v1',
        maxCostMicros: 0,
      })
      return { id: (result.body.job as { id: string }).id, projectId }
    }
    async function state(a: E2Actor, j: string) {
      return (await service.getJob(a.token, j)).job
    }
    async function approve(a: E2Actor, j: string) {
      const current = await state(a, j)
      const kind =
        current.state === 'AWAITING_PLAN_APPROVAL'
          ? 'plan'
          : current.state === 'AWAITING_EXECUTION_APPROVAL'
            ? 'execution'
            : 'promotion'
      return service.approve(a.token, j, a.csrf, randomUUID(), {
        schemaVersion: 1,
        kind,
        decision: 'approve',
        subjectDigest: current.reviewDigest,
        stateVersion: current.stateVersion,
      })
    }
    async function reach(a: E2Actor, j: string, target: string, w = worker) {
      for (let i = 0; i < 40; i++) {
        const current = await state(a, j)
        if (current.state === target) return current
        if (current.state.startsWith('AWAITING_')) await approve(a, j)
        else await w.runOnce()
      }
      throw new Error(`Did not reach ${target}: ${JSON.stringify(await state(a, j))}`)
    }

    async function reset() {
      await db.admin.query(`DO $$ DECLARE names text; BEGIN
      SELECT string_agg(format('forge_control.%I',tablename),',') INTO names FROM pg_tables WHERE schemaname='forge_control' AND tablename NOT IN('schema_migrations','control_settings');
      EXECUTE 'TRUNCATE TABLE '||names||' CASCADE'; END $$`)
    }
    async function close() {
      await db.close()
      await rm(artifactRoot, { recursive: true, force: true })
    }
    return {
      db,
      identity,
      sessions,
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
      reset,
      close,
      projectBody,
    }
  } catch (error) {
    await db.close()
    if (artifactRoot) await rm(artifactRoot, { recursive: true, force: true })
    throw error
  }
}
