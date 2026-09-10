import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { validateMigrationSql } from '../../engine/validation/migrations.ts'
import { hostileMigrations, hostileGeneratedPaths, hostileClaims } from '../../engine/validation/adversarial.ts'
import { isGeneratedPath } from '../../engine/contracts/paths.ts'
import { validatePassingVerification } from '../../engine/contracts/review.ts'
import { descriptor } from './fixtures.ts'
import { taskMigration, priorityMigration } from '../harness/synthetic-migrations.ts'
describe('narrow migration AST policy', () => {
  it('parses additive statements and emits canonical SQL without comments', () => {
    const result = validateMigrationSql(taskMigration)
    expect(result.ast.map(n => n.kind)).toEqual(['create-table', 'create-index'])
    expect(result.statements[0]).toContain('CREATE TABLE "app"."tasks"')
    expect(result.statements.join('')).not.toContain('--')
    expect(validateMigrationSql(priorityMigration).ast[0].kind).toBe('add-column')
  })
  it.each(hostileMigrations)('rejects unsupported or hostile SQL %s', sql => { expect(() => validateMigrationSql(sql)).toThrow() })
  it('does not interpret SQL-shaped string data as commands', () => {
    const result = validateMigrationSql("CREATE TABLE app.tasks (id uuid PRIMARY KEY, title text DEFAULT 'do; drop table ''x'';');")
    expect(result.statements).toHaveLength(1)
    expect(result.statements[0]).toContain("DEFAULT 'do; drop table ''x'';'")
  })
  it('bounds input, token count, columns, indexes, values and statements', () => {
    const rejected = ['', '-- only comment', ' '.repeat(262145), 'CREATE TABLE app.tasks (id uuid PRIMARY KEY)',
      `CREATE TABLE app.tasks (id uuid PRIMARY KEY, ${Array.from({ length: 51 }, (_, i) => `c${i} text`).join(',')});`,
      `CREATE INDEX idx ON app.tasks (${Array.from({ length: 6 }, (_, i) => `c${i}`).join(',')});`,
      `CREATE TABLE app.tasks (id uuid PRIMARY KEY, title text CHECK(title IN (${Array.from({ length: 31 }, () => "'x'").join(',')})));`,
      Array.from({ length: 101 }, (_, i) => `CREATE INDEX i${i} ON app.tasks (id);`).join('\n')]
    for (const sql of rejected) expect(() => validateMigrationSql(sql)).toThrow()
  })
  it('runs reviewed canonical migrations on fresh and seeded prior schemas in embedded PostgreSQL', async () => {
    for (const seeded of [false, true]) {
      const db = new PGlite()
      try {
        await db.exec('CREATE SCHEMA app;')
        for (const statement of validateMigrationSql(taskMigration).statements) await db.exec(statement)
        if (seeded) await db.query("INSERT INTO app.tasks(id,title) VALUES ($1,$2)", ['00000000-0000-4000-8000-000000000001', 'Prior synthetic task'])
        for (const statement of validateMigrationSql(priorityMigration).statements) await db.exec(statement)
        const rows = await db.query<{ title: string; priority: string }>('SELECT title,priority FROM app.tasks')
        expect(rows.rows).toEqual(seeded ? [{ title: 'Prior synthetic task', priority: 'medium' }] : [])
        await expect(db.exec("INSERT INTO app.tasks(id,title,priority) VALUES ('00000000-0000-4000-8000-000000000002','Bad','critical')")).rejects.toThrow()
      } finally { await db.close() }
    }
  }, 30000)
})
describe('adversarial path and check-spoof corpus', () => {
  it.each(hostileGeneratedPaths)('rejects generated path %s', path => { expect(isGeneratedPath(path)).toBe(false) })
  it.each(hostileClaims)('cannot manufacture passing verification from app/provider claims %s', claim => { expect(() => validatePassingVerification(claim, descriptor)).toThrow() })
})
