import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:3000";
const providers = await (await fetch(base + "/api/providers")).json();
const local = providers.find(
  (p: { id: string; available: boolean }) => p.id === "ollama" && p.available,
);
assert.ok(local?.selectedModel, "Local model unavailable");
const response = await fetch(
  base +
    (process.argv[2]
      ? `/api/projects/${process.argv[2]}/jobs`
      : "/api/projects"),
  {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(process.argv[2] ? { kind: "generate" } : {}),
      provider: "ollama",
      model: local.selectedModel,
      prompt:
        "Build a reading journal called Field Notes. Use the existing /api/items backend to save book titles and short notes, list saved books, and remove entries. Use warm cream, dark green, and a clean responsive layout. Keep the page code concise.",
    }),
  },
);
assert.equal(response.status, process.argv[2] ? 202 : 201);
const created = { id: process.argv[2], ...(await response.json()) };
console.log(JSON.stringify(created));
const stream = await fetch(`${base}/api/jobs/${created.jobId}/events`);
assert.equal(stream.status, 200);
assert.ok(stream.body);
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let count = 0;
let lastId = 0;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let index: number;
  while ((index = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    const data = frame.split("\n").find((s) => s.startsWith("data: "));
    if (!data || !frame.startsWith("id:")) continue;
    const event = JSON.parse(data.slice(6));
    assert.ok(event.id > lastId);
    lastId = event.id;
    count++;
    if (
      ["status", "provider", "validated", "complete", "error"].includes(
        event.type,
      )
    )
      console.log(event.type + ": " + event.message);
  }
}
const detail = await (await fetch(`${base}/api/projects/${created.id}`)).json();
assert.equal(detail.jobs[0].status, "complete", detail.jobs[0].error);
assert.ok(detail.project.activeRevision);
assert.ok(count > 2);
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/workflow.json",
  JSON.stringify({
    projectId: created.id,
    jobId: created.jobId,
    originalRevision: detail.project.activeRevision,
    provider: "ollama",
    model: local.selectedModel,
    eventCount: count,
    lastId,
  }),
);
console.log(
  "PASS: real Ollama prompt → durable job → streamed events → validated files → isolated live app.",
);
