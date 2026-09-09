import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import {
  projects,
  revisions,
  jobs,
  events,
  runtimeState,
} from "../src/server/db/schema";
import {
  DockerWorkspace,
  docker,
  runtimeInstance,
} from "../src/server/workspaces/docker";
import type { WorkspaceHandle } from "../src/server/workspaces/docker";
import { templateFiles } from "../src/server/generation/template";
import { generateFiles } from "../src/server/generation/generate";
import { validateFiles } from "../src/server/generation/files";
import { ProviderError } from "../src/server/providers/errors";
import { startPreview } from "../src/server/preview/server";
const runtime = new DockerWorkspace();
let active:
  | { handle: WorkspaceHandle; projectId: string; revisionId: string }
  | undefined;
let retained: { projectId: string; revisionId: string } | undefined;
let stopping = false;
let processing = false;
function safeText(text: string) {
  let result = text;
  for (const [name, value] of Object.entries(process.env))
    if (
      (/KEY|TOKEN|SECRET|PASSWORD/.test(name) || name === "DATABASE_URL") &&
      value &&
      value.length > 5
    )
      result = result.split(value).join("[redacted]");
  return result.slice(0, 4000);
}
let runtimeError: string | null = null;
async function heartbeat(error: string | null = runtimeError) {
  runtimeError = error;
  await db()
    .insert(runtimeState)
    .values({
      id: 1,
      heartbeat: new Date(),
      projectId: active?.projectId ?? retained?.projectId,
      revisionId: active?.revisionId ?? retained?.revisionId,
      handle: active?.handle,
      error,
    })
    .onConflictDoUpdate({
      target: runtimeState.id,
      set: {
        heartbeat: new Date(),
        projectId: active?.projectId ?? retained?.projectId ?? null,
        revisionId: active?.revisionId ?? retained?.revisionId ?? null,
        handle: active?.handle ?? null,
        error,
      },
    });
}
async function checkpoint() {
  if (!active) return;
  const database = await runtime.snapshot(active.handle);
  const runtimeVersion = await runtime.version(active.handle);
  await db()
    .update(revisions)
    .set({ database, runtimeVersion })
    .where(eq(revisions.id, active.revisionId));
}
async function rebuildPrevious(projectId?: string, revisionId?: string) {
  if (!projectId || !revisionId) return;
  const revision = await db().query.revisions.findFirst({
    where: eq(revisions.id, revisionId),
  });
  if (!revision || revision.projectId !== projectId) return;
  if (!revision.runtimeVersion)
    throw new Error("Saved revision is missing its runtime version.");
  const handle = await runtime.create(
    revision.files,
    revision.database,
    () => {},
    revision.runtimeVersion,
  );
  active = { handle, projectId, revisionId };
  await heartbeat();
}
async function processJob(job: typeof jobs.$inferSelect) {
  const previous = active ? { ...active } : undefined;
  const event = async (type: string, message: string) => {
    await db()
      .insert(events)
      .values({ jobId: job.id, type, message: safeText(message) });
  };
  let candidate: WorkspaceHandle | undefined;
  try {
    await event("status", "Preparing a separate revision.");
    if (active) {
      await event(
        "status",
        "Saving a consistent data snapshot and pausing the preview to free memory.",
      );
      await checkpoint();
      retained = { projectId: active.projectId, revisionId: active.revisionId };
      await runtime.destroy(active.handle);
      active = undefined;
      await heartbeat();
    }
    const project = await db().query.projects.findFirst({
      where: eq(projects.id, job.projectId),
    });
    if (!project) throw new Error("Project not found.");
    const baseline = project.activeRevision
      ? await db().query.revisions.findFirst({
          where: eq(revisions.id, project.activeRevision),
        })
      : undefined;
    let files = baseline?.files ?? (await templateFiles()).editable;
    let database = baseline?.database ?? null;
    let runtimeVersion = baseline?.runtimeVersion ?? null;
    let summary = "";
    if (job.kind === "restore") {
      const target = await db().query.revisions.findFirst({
        where: eq(revisions.id, job.payload.revisionId ?? ""),
      });
      if (!target || target.projectId !== job.projectId)
        throw new Error("Revision not found.");
      if (!target.runtimeVersion)
        throw new Error("Saved revision is missing its runtime version.");
      files = target.files;
      database = target.database;
      runtimeVersion = target.runtimeVersion;
      summary = `Restored: ${target.summary}`;
    } else if (job.kind === "edit") {
      files = validateFiles(job.payload.files ?? {});
      summary = "Saved code changes";
    } else {
      const generated = await generateFiles(job, files, event);
      files = generated.files;
      summary = generated.summary;
    }
    validateFiles(files);
    await db()
      .update(jobs)
      .set({ payload: { ...job.payload, files } })
      .where(eq(jobs.id, job.id));
    await event(
      "validated",
      "File operations validated. Installing locked dependencies offline, then building.",
    );
    let writes = Promise.resolve();
    try {
      candidate = await runtime.create(
        files,
        database,
        (text) => {
          writes = writes.then(() => event("log", text));
        },
        runtimeVersion,
      );
    } finally {
      await writes;
    }
    const snapshot = await runtime.snapshot(candidate);
    runtimeVersion = await runtime.version(candidate);
    const revisionId = randomUUID();
    await db().transaction(async (tx) => {
      await tx.insert(revisions).values({
        id: revisionId,
        projectId: job.projectId,
        files,
        database: snapshot,
        runtimeVersion,
        summary,
      });
      await tx
        .update(projects)
        .set({ activeRevision: revisionId })
        .where(eq(projects.id, job.projectId));
      await tx
        .update(jobs)
        .set({ status: "complete" })
        .where(eq(jobs.id, job.id));
      await tx.insert(events).values({
        jobId: job.id,
        type: "complete",
        message:
          "Application is running. The previous revision is available in History.",
      });
    });
    active = { handle: candidate, projectId: job.projectId, revisionId };
    candidate = undefined;
    retained = { projectId: job.projectId, revisionId };
    // Promotion is committed: a transient heartbeat failure must not mark it failed.
    await heartbeat(null).catch(() => {
      stopping = true;
    });
  } catch (error) {
    if (candidate) await runtime.destroy(candidate);
    const message =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error && !error.message.startsWith("Docker")
          ? safeText(error.message)
          : "The isolated runtime failed. Check the build logs; the previous revision is retained.";
    await event("error", message);
    if (previous && !active) {
      await event("status", "Restarting the previous working preview.");
      try {
        await rebuildPrevious(previous.projectId, previous.revisionId);
      } catch {
        await event(
          "error",
          "Previous source and data are retained. Preview restart failed; retry Restore after checking Docker.",
        );
      }
    }
    await db()
      .update(jobs)
      .set({ status: "failed", error: message })
      .where(eq(jobs.id, job.id));
    await heartbeat();
  }
}
async function main() {
  const lock = await pool().connect();
  lock.on("error", () => {
    console.error("Worker lock connection lost. Restart to recover.");
    process.exit(1);
  });
  const result = await lock.query(
    "SELECT pg_try_advisory_lock(714294) AS locked",
  );
  if (!result.rows[0].locked) {
    lock.release();
    throw new Error("A Forge worker is already running.");
  }
  const saved = await db().query.runtimeState.findFirst({
    where: eq(runtimeState.id, 1),
  });
  if (saved?.projectId && saved.revisionId)
    retained = { projectId: saved.projectId, revisionId: saved.revisionId };
  const preview = startPreview(() => active?.handle);
  const timer = setInterval(() => {
    void heartbeat().catch(() => {
      stopping = true;
    });
  }, 3000);
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      stopping = true;
    });
  try {
    const interrupted = await db()
      .update(jobs)
      .set({
        status: "failed",
        error:
          "Worker interrupted. Previous revision retained; submit again to retry.",
      })
      .where(eq(jobs.status, "running"))
      .returning();
    for (const job of interrupted)
      await db().insert(events).values({
        jobId: job.id,
        type: "error",
        message: "Worker interrupted. Previous revision retained.",
      });
    const names = (
      await docker([
        "ps",
        "-a",
        "--filter",
        "label=forge.managed=true",
        "--filter",
        `label=forge.instance=${runtimeInstance}`,
        "--format",
        "{{.Names}}",
      ])
    )
      .trim()
      .split("\n");
    for (const name of names)
      if (/^forge-run-[a-f0-9-]{36}$/.test(name))
        await runtime.destroy({ name, network: name + "-net", port: 0 });
    const networks = (
      await docker([
        "network",
        "ls",
        "--filter",
        "label=forge.managed=true",
        "--filter",
        `label=forge.instance=${runtimeInstance}`,
        "--format",
        "{{.Name}}",
      ])
    )
      .trim()
      .split("\n");
    for (const network of networks)
      if (/^forge-run-[a-f0-9-]{36}-net$/.test(network))
        await docker(["network", "rm", network]).catch(() => {});
    if (saved?.projectId && saved.revisionId) {
      try {
        await rebuildPrevious(saved.projectId, saved.revisionId);
      } catch {
        await heartbeat(
          "Previous preview could not restart. Restore its revision to retry.",
        );
      }
    }
    console.log("Forge worker ready. Preview listens on 127.0.0.1:3101.");
    let checkpointAt = Date.now();
    while (!stopping) {
      const claimed = await pool().query(
        "UPDATE forge_jobs SET status='running' WHERE id=(SELECT id FROM forge_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id",
      );
      if (claimed.rows[0]) {
        const job = await db().query.jobs.findFirst({
          where: eq(jobs.id, claimed.rows[0].id),
        });
        if (job) {
          processing = true;
          await processJob(job);
          processing = false;
        }
      } else if (active && Date.now() - checkpointAt > 10000) {
        try {
          await checkpoint();
        } catch {
          await heartbeat(
            "Data checkpoint failed. Keep the worker running and inspect the application.",
          );
        }
        checkpointAt = Date.now();
      }
      await delay(500);
    }
  } finally {
    clearInterval(timer);
    if (!processing) await checkpoint().catch(() => {});
    if (active) await runtime.destroy(active.handle);
    preview.close();
    lock.release();
    await pool().end();
  }
}
main().catch(() => {
  console.error(
    "Forge worker stopped. Check PostgreSQL, Docker, and preview port 3101.",
  );
  process.exitCode = 1;
});
