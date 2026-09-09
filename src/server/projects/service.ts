import { randomUUID } from "node:crypto";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../db";
import { projects, jobs, revisions, runtimeState } from "../db/schema";
import { templateFiles } from "../generation/template";
import { validateFiles } from "../generation/files";
import type { FileMap } from "../generation/files";
export async function createProject(input: {
  prompt: string;
  provider: string;
  model: string;
}) {
  const id = randomUUID();
  const jobId = randomUUID();
  await db().transaction(async (tx) => {
    await tx
      .insert(projects)
      .values({ id, name: input.prompt.slice(0, 60).trim() });
    await tx.insert(jobs).values({
      id: jobId,
      projectId: id,
      kind: "generate",
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      payload: {},
    });
  });
  return { id, jobId };
}
export async function queueJob(
  projectId: string,
  input: {
    kind: "generate" | "edit" | "restore";
    prompt?: string;
    provider?: string;
    model?: string;
    revisionId?: string;
    files?: FileMap;
  },
) {
  if (
    !(await db().query.projects.findFirst({
      where: eq(projects.id, projectId),
    }))
  )
    throw new Error("Project not found");
  if (input.kind === "edit") validateFiles(input.files ?? {});
  if (
    input.kind === "restore" &&
    !(await db().query.revisions.findFirst({
      where: and(
        eq(revisions.id, input.revisionId ?? ""),
        eq(revisions.projectId, projectId),
      ),
    }))
  )
    throw new Error("Revision not found");
  const id = randomUUID();
  await db()
    .insert(jobs)
    .values({
      id,
      projectId,
      kind: input.kind,
      prompt: input.prompt ?? "",
      provider: input.provider ?? "ollama",
      model: input.model ?? "",
      payload: { revisionId: input.revisionId, files: input.files },
    });
  return { jobId: id };
}
export async function projectDetail(id: string) {
  const project = await db().query.projects.findFirst({
    where: eq(projects.id, id),
  });
  if (!project) return null;
  const history = await db()
    .select({
      id: revisions.id,
      summary: revisions.summary,
      createdAt: revisions.createdAt,
    })
    .from(revisions)
    .where(eq(revisions.projectId, id))
    .orderBy(desc(revisions.createdAt));
  const active = project.activeRevision
    ? await db().query.revisions.findFirst({
        where: eq(revisions.id, project.activeRevision),
      })
    : undefined;
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
  });
  const state = await db().query.runtimeState.findFirst({
    where: eq(runtimeState.id, 1),
  });
  const template = await templateFiles();
  return {
    project,
    history,
    files: active?.files ?? template.editable,
    protectedFiles: {
      ...template.protected,
      ...(active?.runtimeVersion
        ? { "package-lock.json": active.runtimeVersion.lockfile }
        : {}),
    },
    jobs: timeline,
    previewReady:
      state?.projectId === id &&
      !!state.handle &&
      Date.now() - state.heartbeat.getTime() < 12000,
    previewUrl: "http://127.0.0.1:3101",
  };
}
export async function readiness() {
  await db().execute(sql`select 1`);
  const state = await db().query.runtimeState.findFirst({
    where: eq(runtimeState.id, 1),
  });
  return {
    database: true,
    worker: !!state && Date.now() - state.heartbeat.getTime() < 12000,
    message:
      state?.error ??
      (state
        ? "Local runtime connected."
        : "Start npm run worker to enable generation."),
  };
}
