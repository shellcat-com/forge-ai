import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { CloudStore } from './store.mjs'

let db, store
const brief = {
  name: 'Portal',
  prompt: 'A customer portal with a searchable project list.',
  template: 'Next.js + Postgres',
  presetId: 'technical-mono',
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    'CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY, "emailVerified" boolean, banned boolean); INSERT INTO neon_auth."user" VALUES (\'11111111-1111-4111-8111-111111111111\',true,false),(\'22222222-2222-4222-8222-222222222222\',true,false),(\'33333333-3333-4333-8333-333333333333\',false,false);'
  )
  await db.exec(
    'CREATE TABLE neon_auth.session (id uuid,token text,"userId" uuid,"expiresAt" timestamptz)'
  )
  await db.exec(await readFile(new URL('./migrations/0001_workspace.sql', import.meta.url), 'utf8'))
  await db.exec('SET ROLE forge_app')
  store = new CloudStore({
    connect: async () => ({
      query: async (sql, params) => {
        const r = await db.query(sql, params)
        return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }
      },
      release: () => {},
    }),
  })
}, 30000)
afterAll(async () => {
  await db?.close()
})
describe('cloud persistence with real PostgreSQL RLS', () => {
  it('bootstraps idempotently and blocks unverified identities', async () => {
    expect((await store.onboarding('11111111-1111-4111-8111-111111111111')).revision).toBe(1)
    expect((await store.onboarding('11111111-1111-4111-8111-111111111111')).revision).toBe(1)
    await expect(store.onboarding('33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({
      status: 401,
    })
  })
  it('rejects cross-user access and cross-workspace SQL insertion', async () => {
    const a = await store.create('11111111-1111-4111-8111-111111111111', brief)
    expect((await store.list('22222222-2222-4222-8222-222222222222')).projects).toHaveLength(0)
    await expect(
      store.mutate('22222222-2222-4222-8222-222222222222', a.id, 'get', {})
    ).rejects.toMatchObject({ status: 404 })
    await db.exec('RESET ROLE')
    const wid = (
      await db.query(
        "SELECT id FROM forge.workspaces WHERE owner_id='11111111-1111-4111-8111-111111111111'"
      )
    ).rows[0].id
    await db.exec('SET ROLE forge_app')
    await expect(
      store.run('22222222-2222-4222-8222-222222222222', (c) =>
        c.query('INSERT INTO forge.projects(workspace_id,brief) VALUES($1,$2)', [wid, brief])
      )
    ).rejects.toThrow()
  })
  it('detects stale edits and supports delete, restore and duplication', async () => {
    const a = await store.create('11111111-1111-4111-8111-111111111111', brief)
    const b = await store.mutate('11111111-1111-4111-8111-111111111111', a.id, 'edit', {
      revision: a.revision,
      brief: { ...brief, name: 'Updated' },
    })
    await expect(
      store.mutate('11111111-1111-4111-8111-111111111111', a.id, 'delete', { revision: a.revision })
    ).rejects.toMatchObject({ status: 409 })
    const deleted = await store.mutate('11111111-1111-4111-8111-111111111111', a.id, 'delete', {
      revision: b.revision,
    })
    expect(deleted.deletedAt).toBeTruthy()
    const restored = await store.mutate('11111111-1111-4111-8111-111111111111', a.id, 'restore', {
      revision: deleted.revision,
    })
    expect(restored.deletedAt).toBeNull()
    const copy = await store.mutate('11111111-1111-4111-8111-111111111111', a.id, 'duplicate', {
      revision: restored.revision,
    })
    expect(copy.id).not.toBe(a.id)
  })
  it('imports idempotently and never overwrites changed content', async () => {
    const projects = [{ ...brief, id: 'local-one' }]
    expect(await store.import('22222222-2222-4222-8222-222222222222', projects)).toEqual({
      imported: 1,
      skipped: 0,
    })
    expect(await store.import('22222222-2222-4222-8222-222222222222', projects)).toEqual({
      imported: 0,
      skipped: 1,
    })
    expect(
      await store.import('22222222-2222-4222-8222-222222222222', [
        { ...projects[0], name: 'Changed' },
      ])
    ).toEqual({
      imported: 1,
      skipped: 0,
    })
  })
  it('resumes onboarding, rejects conflicting progress and creates one first project', async () => {
    const o = await store.onboarding('11111111-1111-4111-8111-111111111111')
    const next = {
      version: 1,
      stage: 2,
      revision: o.revision,
      draft: {
        name: 'First',
        audience: 'Teams',
        outcome: 'Manage customer requests',
        features: 'Search and edit requests',
        presetId: 'editorial-product',
      },
    }
    const saved = await store.onboarding('11111111-1111-4111-8111-111111111111', next)
    await expect(
      store.onboarding('11111111-1111-4111-8111-111111111111', next)
    ).rejects.toMatchObject({ status: 409 })
    const completed = await store.complete('11111111-1111-4111-8111-111111111111', saved.revision)
    expect(
      (await store.complete('11111111-1111-4111-8111-111111111111', saved.revision)).projectId
    ).toBe(completed.projectId)
    expect((await store.onboarding('11111111-1111-4111-8111-111111111111')).stage).toBe(3)
  })
  it('starts another guided brief without deleting projects and resumes unfinished guides', async () => {
    const previous = await store.onboarding('11111111-1111-4111-8111-111111111111')
    const before = (await store.list('11111111-1111-4111-8111-111111111111')).projects.length
    const next = await store.startGuided('11111111-1111-4111-8111-111111111111', previous.revision)
    expect(next.stage).toBe(0)
    expect(next.completedAt).toBeNull()
    expect(next.firstCompletedAt).toBeTruthy()
    expect((await store.list('11111111-1111-4111-8111-111111111111')).projects).toHaveLength(before)
    expect(await store.startGuided('11111111-1111-4111-8111-111111111111', next.revision)).toEqual(
      next
    )
    await expect(
      store.startGuided('11111111-1111-4111-8111-111111111111', previous.revision)
    ).rejects.toMatchObject({
      status: 409,
    })
  })
})
