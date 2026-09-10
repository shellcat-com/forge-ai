import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('applies the control migration and checks SQL constraints/RLS in embedded PostgreSQL (not native deployment evidence)', async () => {
  const db = new PGlite()
  try {
    await db.exec(readFileSync(new URL('../../engine/migrations/0001_control.sql', import.meta.url), 'utf8'))
    await db.exec(readFileSync(new URL('./control-constraints.sql', import.meta.url), 'utf8'))
    const result = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM forge_control.projects')
    expect(result.rows[0].count).toBe(0)
  } finally { await db.close() }
}, 30000)
