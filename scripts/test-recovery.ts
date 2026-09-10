import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, writeFile } from "node:fs/promises";
const state = JSON.parse(await readFile("test-results/workflow.json", "utf8"));
const base = process.env.FORGE_TEST_URL ?? "http://127.0.0.1:3000";
const projectUrl = `${base}/api/projects/${state.projectId}`;
const detail = async () => (await fetch(projectUrl)).json();
function worker() {
  return spawn(
    process.execPath,
    ["--env-file=.env.local", "--import", "tsx", "worker/index.ts"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}
async function waitFor(predicate: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 210; i++) {
    if (await predicate()) return;
    await delay(1000);
  }
  throw new Error(message);
}
let child = worker();
try {
  await waitFor(
    async () => !!(await detail()).previewReady,
    "Initial preview recovery failed",
  );
  const before = await detail();
  const itemsBefore = await (
    await fetch("http://127.0.0.1:3101/api/items")
  ).json();
  const queued = await fetch(projectUrl + "/jobs", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "edit",
      files: {
        ...before.files,
        "app/globals.css":
          before.files["app/globals.css"] +
          "\n/* interrupted test candidate */",
      },
    }),
  });
  assert.equal(queued.status, 202);
  const { jobId } = await queued.json();
  await waitFor(async () => {
    const d = await detail();
    return d.jobs[0].status === "running" && !d.previewReady;
  }, "Job did not start");
  // Give the worker time to persist the retained revision and enter the Docker build.
  await delay(4000);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  child = worker();
  await waitFor(async () => {
    const d = await detail();
    return !!d.previewReady && d.jobs[0].status === "failed";
  }, "Interrupted job or preview did not recover");
  const after = await detail();
  assert.equal(after.project.activeRevision, before.project.activeRevision);
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(
    await (await fetch("http://127.0.0.1:3101/api/items")).json(),
    itemsBefore,
  );
  const replay = await (await fetch(`${base}/api/jobs/${jobId}/events`)).text();
  assert.match(replay, /Worker interrupted/);
  state.workerRecoveryVerified = true;
  await writeFile("test-results/workflow.json", JSON.stringify(state));
  console.log(
    "PASS SIGKILL during revision: interrupted job failed, retained source/data/preview recovered and events replayed.",
  );
} finally {
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
}
