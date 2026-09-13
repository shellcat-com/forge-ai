import { sha256 } from '../contracts/canonical.ts'
import { utf8Bytes } from '../contracts/primitives.ts'

/** Deliberately smaller than PostgreSQL grammar. Unknown syntax is a policy error,
 * not a fallback to raw SQL. Only renderings of these AST nodes may execute. */
export type Literal = string | number | boolean | null
export type ColumnCheck = { kind: 'in'; column: string; values: Literal[] } | { kind: 'between'; column: string; min: number; max: number }
export interface ColumnDefinition {
  name: string; type: 'uuid' | 'text' | 'varchar' | 'integer' | 'bigint' | 'boolean' | 'timestamptz' | 'date' | 'jsonb'
  length: number | null; primaryKey: boolean; notNull: boolean; unique: boolean
  defaultValue: { kind: 'literal'; value: Literal } | { kind: 'current_timestamp' } | null
  check: ColumnCheck | null
}
export type MigrationStatement =
  | { kind: 'create-table'; table: string; columns: ColumnDefinition[] }
  | { kind: 'add-column'; table: string; column: ColumnDefinition }
  | { kind: 'create-index'; name: string; table: string; unique: boolean; columns: string[] }
export interface ValidatedMigration {
  schemaVersion: 1; policyVersion: 'forge-additive-sql-v1'; sourceDigest: string
  ast: MigrationStatement[]; statements: string[]
}
interface Token { kind: 'word' | 'string' | 'number' | 'punct'; value: string }
export class MigrationPolicyError extends Error {
  constructor() { super('Migration rejected by forge-additive-sql-v1'); this.name = 'MigrationPolicyError' }
}
function reject(): never { throw new MigrationPolicyError() }
function tokenize(sql: string): Token[] {
  if (typeof sql !== 'string' || utf8Bytes(sql) > 256 * 1024 || !sql.trim() || [...sql].some(c => { const n = c.charCodeAt(0); return ![9, 10, 13].includes(n) && (n < 32 || n > 126) })) reject()
  const tokens: Token[] = []
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (/\s/.test(c)) { i++; continue }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end + 1; continue }
    // Block comments, escaped/dollar strings and quoted identifiers deliberately unsupported.
    if (c === "'") {
      i++; let value = ''; let closed = false
      while (i < sql.length) {
        if (sql[i] === '\\' || /[\r\n]/.test(sql[i])) reject()
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { value += "'"; i += 2; continue }
          i++; closed = true; break
        }
        value += sql[i++]
        if (value.length > 2000) reject()
      }
      if (!closed) reject()
      tokens.push({ kind: 'string', value })
    } else if (/[a-zA-Z_]/.test(c)) {
      const start = i++; while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) i++
      tokens.push({ kind: 'word', value: sql.slice(start, i).toLowerCase() })
    } else if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const start = i++; while (i < sql.length && /[0-9]/.test(sql[i])) i++
      const value = sql.slice(start, i)
      if (!Number.isSafeInteger(Number(value)) || !/^-?(0|[1-9][0-9]*)$/.test(value)) reject()
      tokens.push({ kind: 'number', value })
    } else if ('(),.;'.includes(c)) { tokens.push({ kind: 'punct', value: c }); i++ }
    else reject()
    if (tokens.length > 20000) reject()
  }
  return tokens
}
const reserved = new Set('app select from where table index create alter add column primary key not null unique default check in between and or references constraint drop grant revoke copy do function trigger extension role schema current_timestamp true false'.split(' '))
class Parser {
  private at = 0
  constructor(private readonly tokens: Token[]) {}
  private take(value: string): boolean {
    const t = this.tokens[this.at]
    if (t && t.kind !== 'string' && t.value === value) { this.at++; return true }
    return false
  }
  private need(value: string): void { if (!this.take(value)) reject() }
  private identifier(): string {
    const token = this.tokens[this.at++]
    if (!token || token.kind !== 'word' || !/^[a-z][a-z0-9_]{0,62}$/.test(token.value) || reserved.has(token.value) || token.value.startsWith('pg_')) reject()
    return token.value
  }
  private table(): string { this.need('app'); this.need('.'); return this.identifier() }
  private literal(): Literal {
    const token = this.tokens[this.at++]
    if (!token) return reject()
    if (token.kind === 'string') return token.value
    if (token.kind === 'number') return Number(token.value)
    if (token.kind === 'word' && ['true', 'false', 'null'].includes(token.value)) return token.value === 'null' ? null : token.value === 'true'
    return reject()
  }
  private column(): ColumnDefinition {
    const name = this.identifier()
    const typeToken = this.tokens[this.at++]
    const types = ['uuid', 'text', 'varchar', 'integer', 'bigint', 'boolean', 'timestamptz', 'date', 'jsonb'] as const
    if (!typeToken || typeToken.kind !== 'word' || !types.some(t => t === typeToken.value)) reject()
    const type = typeToken.value as ColumnDefinition['type']
    let length: number | null = null
    if (type === 'varchar') { this.need('('); const value = this.literal(); if (typeof value !== 'number' || value < 1 || value > 2000) reject(); length = value; this.need(')') }
    const column: ColumnDefinition = { name, type, length, primaryKey: false, notNull: false, unique: false, defaultValue: null, check: null }
    const seen = new Set<string>()
    while (this.tokens[this.at] && ![',', ')', ';'].includes(this.tokens[this.at].value)) {
      const constraint = this.tokens[this.at++]
      if (constraint.kind !== 'word' || seen.has(constraint.value)) reject()
      seen.add(constraint.value)
      if (constraint.value === 'primary') { this.need('key'); column.primaryKey = true }
      else if (constraint.value === 'not') { this.need('null'); column.notNull = true }
      else if (constraint.value === 'unique') column.unique = true
      else if (constraint.value === 'default') {
        if (this.take('current_timestamp')) { if (type !== 'timestamptz') reject(); column.defaultValue = { kind: 'current_timestamp' } }
        else column.defaultValue = { kind: 'literal', value: this.literal() }
      } else if (constraint.value === 'check') {
        this.need('('); if (this.identifier() !== name) reject()
        if (this.take('in')) {
          this.need('('); const values = [this.literal()]
          while (this.take(',')) { values.push(this.literal()); if (values.length > 30) reject() }
          this.need(')'); column.check = { kind: 'in', column: name, values }
        } else if (this.take('between')) {
          const min = this.literal(); this.need('and'); const max = this.literal()
          if (typeof min !== 'number' || typeof max !== 'number' || min > max) reject()
          column.check = { kind: 'between', column: name, min, max }
        } else reject()
        this.need(')')
      } else reject()
    }
    return column
  }
  parse(): MigrationStatement[] {
    const ast: MigrationStatement[] = []
    while (this.at < this.tokens.length) {
      if (ast.length >= 100) reject()
      if (this.take('create')) {
        if (this.take('table')) {
          const table = this.table(); this.need('('); const columns = [this.column()]
          while (this.take(',')) { columns.push(this.column()); if (columns.length > 50) reject() }
          this.need(')')
          if (new Set(columns.map(c => c.name)).size !== columns.length || columns.filter(c => c.primaryKey).length !== 1) reject()
          ast.push({ kind: 'create-table', table, columns })
        } else {
          const unique = this.take('unique'); this.need('index'); const name = this.identifier(); this.need('on'); const table = this.table()
          this.need('('); const columns = [this.identifier()]
          while (this.take(',')) { columns.push(this.identifier()); if (columns.length > 5) reject() }
          this.need(')'); if (new Set(columns).size !== columns.length) reject()
          ast.push({ kind: 'create-index', name, table, unique, columns })
        }
      } else if (this.take('alter')) {
        this.need('table'); const table = this.table(); this.need('add'); this.need('column'); const column = this.column()
        if (column.primaryKey || (column.notNull && (!column.defaultValue || (column.defaultValue.kind === 'literal' && column.defaultValue.value === null)))) reject()
        ast.push({ kind: 'add-column', table, column })
      } else reject()
      this.need(';')
    }
    if (!ast.length) reject()
    return ast
  }
}
const ident = (value: string) => `"${value}"`
const literalSql = (value: Literal): string => typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : value === null ? 'NULL' : String(value).toUpperCase()
function columnSql(c: ColumnDefinition): string {
  let sql = `${ident(c.name)} ${c.type.toUpperCase()}${c.length === null ? '' : `(${c.length})`}`
  if (c.primaryKey) sql += ' PRIMARY KEY'
  if (c.notNull) sql += ' NOT NULL'
  if (c.unique) sql += ' UNIQUE'
  if (c.defaultValue) sql += ` DEFAULT ${c.defaultValue.kind === 'current_timestamp' ? 'CURRENT_TIMESTAMP' : literalSql(c.defaultValue.value)}`
  if (c.check) sql += c.check.kind === 'in' ? ` CHECK (${ident(c.name)} IN (${c.check.values.map(literalSql).join(', ')}))` : ` CHECK (${ident(c.name)} BETWEEN ${c.check.min} AND ${c.check.max})`
  return sql
}
function render(node: MigrationStatement): string {
  if (node.kind === 'create-table') return `CREATE TABLE "app".${ident(node.table)} (${node.columns.map(columnSql).join(', ')});`
  if (node.kind === 'add-column') return `ALTER TABLE "app".${ident(node.table)} ADD COLUMN ${columnSql(node.column)};`
  return `CREATE ${node.unique ? 'UNIQUE ' : ''}INDEX ${ident(node.name)} ON "app".${ident(node.table)} (${node.columns.map(ident).join(', ')});`
}
export function validateMigrationSql(sql: string): ValidatedMigration {
  const ast = new Parser(tokenize(sql)).parse()
  return { schemaVersion: 1, policyVersion: 'forge-additive-sql-v1', sourceDigest: sha256(sql), ast, statements: ast.map(render) }
}
