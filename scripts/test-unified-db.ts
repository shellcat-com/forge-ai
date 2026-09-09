import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, pool } from '../src/server/db'
import { projects, jobs, messages, memberships } from '../src/server/db/schema'
import { createProject, queueJob } from '../src/server/projects/service'
import { projectAccess } from '../src/server/auth/access'
const owner = 'test-' + randomUUID(),
  stranger = 'test-' + randomUUID()
const who = { id: owner, email: '', local: true, canBuild: true }
try {
  const input = {
    prompt: 'Build a custom editorial portfolio for an architect',
    provider: 'ollama',
    model: 'test',
    idempotencyKey: randomUUID(),
  }
  const [a, b] = await Promise.all([createProject(input, owner), createProject(input, owner)])
  assert.equal(a.id, b.id)
  assert.equal(a.jobId, b.jobId)
  const saved = await projectAccess(who, a.id, 'owner')
  assert.equal(saved.ownerId, owner)
  await assert.rejects(projectAccess({ ...who, id: stranger }, a.id), { status: 404 })
  await assert.rejects(createProject({ ...input, idempotencyKey: randomUUID() }, owner), {
    status: 409,
  })
  await db().update(jobs).set({ status: 'complete' }).where(eq(jobs.id, a.jobId))
  await assert.rejects(
    queueJob(
      a.id,
      {
        kind: 'generate',
        prompt: 'Change typography',
        provider: 'ollama',
        model: 'test',
        baseRevision: randomUUID(),
      },
      owner
    ),
    { status: 409 }
  )
  await db()
    .insert(memberships)
    .values({ id: randomUUID(), projectId: a.id, userId: stranger, role: 'viewer' })
  await projectAccess({ ...who, id: stranger }, a.id)
  await assert.rejects(projectAccess({ ...who, id: stranger }, a.id, 'owner'), { status: 404 })
  await assert.rejects(projectAccess({ ...who, id: stranger }, a.id, 'comment'), { status: 404 })
  await db().delete(memberships).where(eq(memberships.projectId, a.id))
  await assert.rejects(projectAccess({ ...who, id: stranger }, a.id), { status: 404 })
  console.log(
    'PASS: real PostgreSQL idempotency, owner isolation, active-job limit, stale revisions, review permissions and revocation.'
  )
} finally {
  const own = await db().query.projects.findMany({ where: eq(projects.ownerId, owner) })
  for (const p of own) {
    await db().delete(memberships).where(eq(memberships.projectId, p.id))
    await db().delete(messages).where(eq(messages.projectId, p.id))
    await pool().query(
      'delete from forge_events where job_id in (select id from forge_jobs where project_id=$1)',
      [p.id]
    )
    await db().delete(jobs).where(eq(jobs.projectId, p.id))
    await db().delete(projects).where(eq(projects.id, p.id))
  }
  await pool().end()
}
