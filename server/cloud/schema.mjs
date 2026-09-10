import {
  pgSchema,
  text,
  uuid,
  jsonb,
  integer,
  timestamp,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const forge = pgSchema('forge')
export const profiles = forge.table('profiles', {
  userId: text('user_id').primaryKey(),
  onboarding: jsonb('onboarding').notNull(),
  revision: integer('revision').notNull().default(1),
})
export const workspaces = forge.table('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().unique(),
})
export const memberships = forge.table(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').notNull().default('owner'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
)
export const projects = forge.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brief: jsonb('brief').notNull(),
    revision: integer('revision').notNull().default(1),
    importKey: text('import_key'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('projects_import_key').on(t.workspaceId, t.importKey)]
)
