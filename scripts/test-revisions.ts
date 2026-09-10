import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const base = process.env.FORGE_TEST_URL ?? "http://127.0.0.1:3000";
const state = JSON.parse(await readFile("test-results/workflow.json", "utf8"));
const url = `${base}/api/projects/${state.projectId}`;
async function detail() {
  return (await fetch(url)).json();
}
async function ready() {
  for (let i = 0; i < 180; i++) {
    if ((await detail()).previewReady) return;
    await delay(1000);
  }
  throw new Error("Preview did not become ready");
}
async function job(body: unknown, expected = "complete") {
  const response = await fetch(url + "/jobs", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 202, await response.clone().text());
  const { jobId } = await response.json();
  const stream = await fetch(`${base}/api/jobs/${jobId}/events`, {
    signal: AbortSignal.timeout(600000),
  });
  const text = await stream.text();
  const events = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)))
    .filter((e) => e.id);
  for (let i = 1; i < events.length; i++)
    assert.ok(events[i].id > events[i - 1].id);
  const current = await detail();
  assert.equal(
    current.jobs[0].status,
    expected,
    current.jobs[0].error +
      "\n" +
      events
        .filter((e) => e.type === "log")
        .map((e) => e.message)
        .join("\n"),
  );
  const cursor = events[Math.floor(events.length / 2)].id;
  const replay = await (
    await fetch(`${base}/api/jobs/${jobId}/events`, {
      headers: { "Last-Event-ID": String(cursor) },
    })
  ).text();
  const ids = replay
    .split("\n")
    .filter((l) => l.startsWith("id: "))
    .map((l) => Number(l.slice(4)));
  assert.deepEqual(
    ids,
    events.filter((e) => e.id > cursor).map((e) => e.id),
  );
  console.log(
    `PASS ${body && typeof body === "object" && "kind" in body ? body.kind : "job"}: ${expected}; ${events.length} durable events and exact cursor replay`,
  );
  return current;
}
await ready();
const original = await detail();
const beforeTitle = "Snapshot before follow-up";
const inserted = await fetch("http://127.0.0.1:3101/api/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: beforeTitle, body: "Must survive revision" }),
});
assert.equal(inserted.status, 201);
const beforeItem = await inserted.json();
console.log("Starting real-provider follow-up.");
const changed = await job({
  kind: "generate",
  provider: "ollama",
  model: state.model,
  prompt:
    "Change the main heading text from Make room for ideas. to Field Notes. Change the subtitle to A reading journal, built just for you. Preserve all existing functionality and all other code. Return the updated app/page.tsx file.",
});
assert.notEqual(
  changed.project.activeRevision,
  original.project.activeRevision,
);
assert.match(changed.files["app/page.tsx"], /Field Notes/);
await ready();
assert.match(
  await (await fetch("http://127.0.0.1:3101")).text(),
  /Field Notes/,
);
assert.ok(
  (await (await fetch("http://127.0.0.1:3101/api/items")).json()).some(
    (i: { id: number }) => i.id === beforeItem.id,
  ),
);
state.followUpRevision = changed.project.activeRevision;
await writeFile("test-results/workflow.json", JSON.stringify(state));
const late = await fetch("http://127.0.0.1:3101/api/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Only in newer revision" }),
});
assert.equal(late.status, 201);
const lateItem = await late.json();
const restored = await job({
  kind: "restore",
  revisionId: original.project.activeRevision,
});
assert.deepEqual(restored.files, original.files);
await ready();
const items = await (await fetch("http://127.0.0.1:3101/api/items")).json();
assert.ok(items.some((i: { id: number }) => i.id === beforeItem.id));
assert.ok(!items.some((i: { id: number }) => i.id === lateItem.id));
console.log(
  "PASS restoration: exact source and consistent SQLite snapshot, excluding newer data.",
);
await job(
  {
    kind: "edit",
    files: {
      ...restored.files,
      "app/page.tsx":
        "export default function Page() { return <div>broken syntax; }",
    },
  },
  "failed",
);
const recovered = await detail();
assert.equal(recovered.project.activeRevision, restored.project.activeRevision);
assert.deepEqual(recovered.files, restored.files);
await ready();
assert.equal((await fetch("http://127.0.0.1:3101")).status, 200);
console.log(
  "PASS failed build: no promotion, working preview recovered, source retained.",
);
await job({ kind: "restore", revisionId: state.followUpRevision });
await ready();
state.restorationVerified = true;
state.failedBuildRecoveryVerified = true;
state.replayVerified = true;
await writeFile("test-results/workflow.json", JSON.stringify(state));
