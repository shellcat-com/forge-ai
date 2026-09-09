import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  serial,
} from "drizzle-orm/pg-core";
import type { FileMap } from "../generation/files";
import type { WorkspaceHandle } from "../workspaces/docker";
export const projects = pgTable("forge_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  activeRevision: text("active_revision"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const revisions = pgTable("forge_revisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  files: jsonb("files").$type<FileMap>().notNull(),
  database: text("database_snapshot"),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const jobs = pgTable("forge_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  kind: text("kind").notNull(),
  prompt: text("prompt").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  payload: jsonb("payload")
    .$type<{ revisionId?: string; files?: FileMap }>()
    .notNull(),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const events = pgTable("forge_events", {
  id: serial("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const runtimeState = pgTable("forge_runtime", {
  id: integer("id").primaryKey(),
  heartbeat: timestamp("heartbeat", { withTimezone: true })
    .defaultNow()
    .notNull(),
  projectId: text("project_id"),
  revisionId: text("revision_id"),
  handle: jsonb("handle").$type<WorkspaceHandle>(),
  error: text("error"),
});
