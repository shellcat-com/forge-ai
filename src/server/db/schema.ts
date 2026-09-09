import { pgTable, text, timestamp, jsonb, integer, serial, boolean } from 'drizzle-orm/pg-core'
import type { FileMap } from '../generation/files'
import type { WorkspaceHandle, RuntimeVersion } from '../workspaces/docker'
export const projects = pgTable('forge_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull().default('local-owner'),
  brief: text('brief').notNull().default(''),
  design: jsonb('design')
    .$type<{ style: string; exampleId?: string; preserve: string }>()
    .notNull()
    .default({ style: '', preserve: '' }),
  archived: boolean('archived').notNull().default(false),
  starred: boolean('starred').notNull().default(false),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  activeRevision: text('active_revision'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
export const revisions = pgTable('forge_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  files: jsonb('files').$type<FileMap>().notNull(),
  database: text('database_snapshot'),
  runtimeVersion: jsonb('runtime_version').$type<RuntimeVersion>(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
export const jobs = pgTable('forge_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  kind: text('kind').notNull(),
  prompt: text('prompt').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  payload: jsonb('payload')
    .$type<{ revisionId?: string; files?: FileMap; restoreData?: boolean }>()
    .notNull(),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  ownerId: text('owner_id').notNull().default('local-owner'),
  idempotencyKey: text('idempotency_key'),
  baseRevision: text('base_revision'),
  cancelled: boolean('cancelled').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
export const events = pgTable('forge_events', {
  id: serial('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id),
  type: text('type').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
export const runtimeState = pgTable('forge_runtime', {
  id: integer('id').primaryKey(),
  heartbeat: timestamp('heartbeat', { withTimezone: true }).defaultNow().notNull(),
  projectId: text('project_id'),
  revisionId: text('revision_id'),
  handle: jsonb('handle').$type<WorkspaceHandle>(),
  error: text('error'),
})

export const messages = pgTable('forge_messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  role: text('role').notNull(),
  mode: text('mode').notNull(),
  content: text('content').notNull(),
  jobId: text('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
export const memberships = pgTable('forge_memberships', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
})
export const comments = pgTable('forge_comments', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  userId: text('user_id').notNull(),
  revisionId: text('revision_id').notNull(),
  page: text('page').notNull().default('/'),
  content: text('content').notNull(),
  resolved: boolean('resolved').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
export * from '../auth/schema'
