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
    'CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY, "emailVerified" boolean, banned boolean); INSERT INTO neon_auth."user" VALUES (\'alice\',true,false),(\'bob\',true,false),(\'unverified\',false,false);'
  )
  await db.exec(
    'CREATE TABLE neon_auth.session (id text,token text,"userId" text,"expiresAt" timestamptz)'
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
    expect((await store.onboarding('alice')).revision).toBe(1)
    expect((await store.onboarding('alice')).revision).toBe(1)
    await expect(store.onboarding('unverified')).rejects.toMatchObject({ status: 401 })
  })
  it('rejects cross-user access and cross-workspace SQL insertion', async () => {
    const a = await store.create('alice', brief)
    expect((await store.list('bob')).projects).toHaveLength(0)
    await expect(store.mutate('bob', a.id, 'get', {})).rejects.toMatchObject({ status: 404 })
    await db.exec('RESET ROLE')
    const wid = (await db.query("SELECT id FROM forge.workspaces WHERE owner_id='alice'")).rows[0]
      .id
    await db.exec('SET ROLE forge_app')
    await expect(
      store.run('bob', (c) =>
        c.query('INSERT INTO forge.projects(workspace_id,brief) VALUES($1,$2)', [wid, brief])
      )
    ).rejects.toThrow()
  })
  it('detects stale edits and supports delete, restore and duplication', async () => {
    const a = await store.create('alice', brief)
    const b = await store.mutate('alice', a.id, 'edit', {
      revision: a.revision,
      brief: { ...brief, name: 'Updated' },
    })
    await expect(
      store.mutate('alice', a.id, 'delete', { revision: a.revision })
    ).rejects.toMatchObject({ status: 409 })
    const deleted = await store.mutate('alice', a.id, 'delete', { revision: b.revision })
    expect(deleted.deletedAt).toBeTruthy()
    const restored = await store.mutate('alice', a.id, 'restore', { revision: deleted.revision })
    expect(restored.deletedAt).toBeNull()
    const copy = await store.mutate('alice', a.id, 'duplicate', { revision: restored.revision })
    expect(copy.id).not.toBe(a.id)
  })
  it('imports idempotently and never overwrites changed content', async () => {
    const projects = [{ ...brief, id: 'local-one' }]
    expect(await store.import('bob', projects)).toEqual({ imported: 1, skipped: 0 })
    expect(await store.import('bob', projects)).toEqual({ imported: 0, skipped: 1 })
    expect(await store.import('bob', [{ ...projects[0], name: 'Changed' }])).toEqual({
      imported: 1,
      skipped: 0,
    })
  })
  it('resumes onboarding, rejects conflicting progress and creates one first project', async () => {
    const o = await store.onboarding('alice')
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
    const saved = await store.onboarding('alice', next)
    await expect(store.onboarding('alice', next)).rejects.toMatchObject({ status: 409 })
    const completed = await store.complete('alice', saved.revision)
    expect((await store.complete('alice', saved.revision)).projectId).toBe(completed.projectId)
    expect((await store.onboarding('alice')).stage).toBe(3)
  })
  it('starts another guided brief without deleting projects and resumes unfinished guides', async () => {
    const previous = await store.onboarding('alice')
    const before = (await store.list('alice')).projects.length
    const next = await store.startGuided('alice', previous.revision)
    expect(next.stage).toBe(0)
    expect(next.completedAt).toBeNull()
    expect(next.firstCompletedAt).toBeTruthy()
    expect((await store.list('alice')).projects).toHaveLength(before)
    expect(await store.startGuided('alice', next.revision)).toEqual(next)
    await expect(store.startGuided('alice', previous.revision)).rejects.toMatchObject({
      status: 409,
    })
  })
})
