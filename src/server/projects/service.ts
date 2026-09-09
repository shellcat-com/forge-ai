import { AccessError } from '../auth/access'
import { projectName } from '../../shared/creation'
import { randomUUID } from 'node:crypto'
import { eq, desc, and, sql } from 'drizzle-orm'
import { db } from '../db'
import { projects, jobs, revisions, runtimeState, messages } from '../db/schema'
import { templateFiles } from '../generation/template'
import { validateFiles } from '../generation/files'
import type { FileMap } from '../generation/files'
export async function createProject(
  input: {
    prompt: string
    provider: string
    model: string
    mode?: string
    design?: { style: string; exampleId?: string; preserve: string }
    idempotencyKey?: string
  },
  ownerId = 'local-owner'
) {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`)
    if (input.idempotencyKey) {
      const existing = await tx.query.jobs.findFirst({
        where: and(eq(jobs.ownerId, ownerId), eq(jobs.idempotencyKey, input.idempotencyKey)),
      })
      if (existing) {
        if (existing.prompt !== input.prompt)
          throw new AccessError(409, 'Submission key was already used for another request.')
        return { id: existing.projectId, jobId: existing.id }
      }
    }
    const count = await tx.execute(
      sql`select count(*)::int as count from forge_projects where owner_id=${ownerId} and not archived`
    )
    if (Number(count.rows[0].count) >= 5)
      throw new AccessError(
        429,
        'Archive a project before creating another. Your limit is five active projects.'
      )
    await checkAllowance(tx, ownerId)
    const id = randomUUID(),
      jobId = randomUUID()
    await tx
      .insert(projects)
      .values({
        id,
        name: projectName(input.prompt),
        ownerId,
        brief: input.prompt,
        design: input.design ?? { style: '', preserve: '' },
      })
    const mode = input.mode ?? 'build'
    await tx
      .insert(jobs)
      .values({
        id: jobId,
        projectId: id,
        kind: mode === 'build' ? 'generate' : mode,
        prompt: input.prompt,
        provider: input.provider,
        model: input.model,
        payload: {},
        ownerId,
        idempotencyKey: input.idempotencyKey,
      })
    await tx
      .insert(messages)
      .values({ id: randomUUID(), projectId: id, role: 'user', mode, content: input.prompt, jobId })
    return { id, jobId }
  })
}
async function checkAllowance(
  tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0],
  ownerId: string,
  consumesRequest = true
) {
  const active = await tx.execute(
    sql`select count(*)::int as count from forge_jobs where owner_id=${ownerId} and status in ('queued','running')`
  )
  if (Number(active.rows[0].count) > 0)
    throw new AccessError(409, 'Wait for your current job to finish or stop it first.')
  const daily = await tx.execute(
    sql`select count(*)::int as count from forge_jobs where owner_id=${ownerId} and kind <> 'restore' and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`
  )
  if (consumesRequest && Number(daily.rows[0].count) >= 10)
    throw new AccessError(429, 'Your daily request limit is reached.')
  if (process.env.FORGE_AUTH_MODE === 'hosted')
    throw new AccessError(
      503,
      'Hosted generation is awaiting sandbox and monetary-budget verification.'
    )
}
export async function queueJob(
  projectId: string,
  input: {
    kind: 'generate' | 'edit' | 'restore' | 'idea' | 'brainstorm' | 'plan'
    prompt?: string
    provider?: string
    model?: string
    revisionId?: string
    files?: FileMap
    restoreData?: boolean
    baseRevision?: string | null
    idempotencyKey?: string
  },
  ownerId = 'local-owner'
) {
  if (input.kind === 'edit') validateFiles(input.files ?? {})
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`)
    const project = await tx.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)),
    })
    if (!project) throw new AccessError(404, 'Project not found.')
    if (input.idempotencyKey) {
      const prior = await tx.query.jobs.findFirst({
        where: and(eq(jobs.ownerId, ownerId), eq(jobs.idempotencyKey, input.idempotencyKey)),
      })
      if (prior) {
        if (prior.projectId !== projectId)
          throw new AccessError(409, 'Submission key belongs to another project.')
        return { jobId: prior.id }
      }
    }
    if (project.archived) throw new AccessError(409, 'Unarchive this project before editing.')
    if (input.baseRevision !== undefined && input.baseRevision !== project.activeRevision)
      throw new AccessError(
        409,
        'The project changed. Review the latest revision before applying this edit.'
      )
    if (
      input.kind === 'restore' &&
      !(await tx.query.revisions.findFirst({
        where: and(eq(revisions.id, input.revisionId ?? ''), eq(revisions.projectId, projectId)),
      }))
    )
      throw new AccessError(404, 'Revision not found.')
    await checkAllowance(tx, ownerId, input.kind!=='restore')
    const id = randomUUID()
    await tx
      .insert(jobs)
      .values({
        id,
        projectId,
        kind: input.kind,
        prompt: input.prompt ?? '',
        provider: input.provider ?? 'ollama',
        model: input.model ?? '',
        payload: {
          revisionId: input.revisionId,
          files: input.files,
          restoreData: input.restoreData,
        },
        ownerId,
        idempotencyKey: input.idempotencyKey,
        baseRevision: project.activeRevision,
      })
    if (input.prompt)
      await tx
        .insert(messages)
        .values({
          id: randomUUID(),
          projectId,
          role: 'user',
          mode: input.kind === 'generate' ? 'build' : input.kind,
          content: input.prompt,
          jobId: id,
        })
    return { jobId: id }
  })
}
export async function projectDetail(id: string) {
  const project = await db().query.projects.findFirst({
    where: eq(projects.id, id),
  })
  if (!project) return null
  const history = await db()
    .select({
      id: revisions.id,
      summary: revisions.summary,
      createdAt: revisions.createdAt,
    })
    .from(revisions)
    .where(eq(revisions.projectId, id))
    .orderBy(desc(revisions.createdAt))
  const active = project.activeRevision
    ? await db().query.revisions.findFirst({
        where: eq(revisions.id, project.activeRevision),
      })
    : undefined
  const timeline = await db().query.jobs.findMany({
    where: eq(jobs.projectId, id),
    orderBy: desc(jobs.createdAt),
    limit: 20,
    columns: {
      id: true,
      kind: true,
      prompt: true,
      status: true,
      error: true,
      provider: true,
      model: true,
    },
  })
  const state = await db().query.runtimeState.findFirst({
    where: eq(runtimeState.id, 1),
  })
  const template = await templateFiles()
  return {
    project,
    messages: await db().query.messages.findMany({
      where: eq(messages.projectId, id),
      orderBy: messages.createdAt,
      limit: 200,
    }),
    history,
    files: active?.files ?? template.editable,
    protectedFiles: {
      ...template.protected,
      ...(active?.runtimeVersion ? { 'package-lock.json': active.runtimeVersion.lockfile } : {}),
    },
    jobs: timeline,
    previewReady:
      state?.projectId === id && !!state.handle && Date.now() - state.heartbeat.getTime() < 12000,
    previewUrl: `http://127.0.0.1:${process.env.FORGE_PREVIEW_PORT || 3101}`,
  }
}
export async function readiness() {
  await db().execute(sql`select 1`)
  const state = await db().query.runtimeState.findFirst({
    where: eq(runtimeState.id, 1),
  })
  return {
    database: true,
    worker: !!state && Date.now() - state.heartbeat.getTime() < 12000,
    message:
      state?.error ??
      (state ? 'Local runtime connected.' : 'Start npm run worker to enable generation.'),
  }
}
