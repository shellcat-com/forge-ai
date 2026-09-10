import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DockerWorkspace, docker } from "../src/server/workspaces/docker";
import type { WorkspaceHandle } from "../src/server/workspaces/docker";
const runtime = new DockerWorkspace();
let handle: WorkspaceHandle | undefined;
try {
  const files = {
    "app/page.tsx": await readFile("templates/next-app/app/page.tsx", "utf8"),
    "app/globals.css": await readFile(
      "templates/next-app/app/globals.css",
      "utf8",
    ),
  };
  handle = await runtime.create(files, null, (text) =>
    process.stdout.write(text),
  );
  const root = `http://127.0.0.1:${handle.port}`;
  assert.equal((await fetch(root)).status, 200);
  const created = await fetch(root + "/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Snapshot evidence",
      body: "Synthetic integration data",
    }),
  });
  assert.equal(created.status, 201);
  const snapshot = await runtime.snapshot(handle);
  assert.ok(snapshot);
  const inspect = JSON.parse(await docker(["inspect", handle.name]))[0];
  assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspect.HostConfig.PidsLimit, 128);
  assert.equal(inspect.Config.User, "node");
  assert.equal(inspect.HostConfig.Memory, 2684354560);
  assert.ok(inspect.HostConfig.CapDrop.includes("ALL"));
  assert.equal(inspect.Mounts.length, 0); // only bounded tmpfs; no host or persistent mounts
  assert.ok(
    !inspect.Config.Env.some((v: string) =>
      /^(GEMINI_API_KEY|DATABASE_URL|GROQ_API_KEY|OPENROUTER_API_KEY)=/.test(v),
    ),
  );
  for (const target of [
    "https://example.com",
    "http://host.docker.internal:3100",
    "http://host.docker.internal:11434",
  ]) {
    const output = await docker([
      "exec",
      handle.name,
      "node",
      "-e",
      `fetch(${JSON.stringify(target)},{signal:AbortSignal.timeout(2000)}).then(()=>process.exit(1)).catch(()=>console.log('blocked'))`,
    ]);
    assert.match(output, /blocked/);
  }
  await runtime.destroy(handle);
  handle = undefined;
  handle = await runtime.create(files, snapshot, () => {});
  const items = await (
    await fetch(`http://127.0.0.1:${handle.port}/api/items`)
  ).json();
  assert.equal(items[0].title, "Snapshot evidence");
  console.log(
    "PASS: offline install, build, HTTP preview, SQLite CRUD, snapshot/restore, resource settings, no secrets, blocked egress/host access.",
  );
} finally {
  if (handle) await runtime.destroy(handle);
}
