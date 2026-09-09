import { cpSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (text.length > 12_000_000) throw new Error("Input exceeds limit");
}
const input = JSON.parse(text);
cpSync("/opt/template", "/workspace", {
  recursive: true,
  filter: (source) => !source.includes("node_modules"),
});
for (const [path, contents] of Object.entries(input.files)) {
  if (
    !/^(app\/(?:page\.tsx|globals\.css|(?:[a-zA-Z0-9_[\]-]+\/)+(?:page|layout|loading|error|not-found)\.tsx|components\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.tsx|api\/(?:[a-zA-Z0-9_[\]-]+\/)+route\.ts)|lib\/generated\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.ts)$/.test(
      path,
    ) ||
    path.includes("..") ||
    path.split("/").some((part) => !part) ||
    typeof contents !== "string" ||
    contents.length > 64000
  )
    throw new Error("Invalid generated path or content");
  mkdirSync(dirname("/workspace/" + path), { recursive: true });
  writeFileSync("/workspace/" + path, contents, { flag: "w" });
}
if (input.database) {
  mkdirSync("/workspace/.data", { recursive: true });
  const db = Buffer.from(input.database, "base64");
  if (db.length > 8_000_000) throw new Error("Database exceeds limit");
  writeFileSync("/workspace/.data/app.sqlite", db);
}
writeFileSync("/tmp/forge-ready", "ready", { flag: "wx" });
