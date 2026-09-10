import { DatabaseSync, backup } from "node:sqlite";
import { lstatSync, readFileSync, unlinkSync } from "node:fs";
const source = "/workspace/.data/app.sqlite";
try {
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8_000_000)
    throw new Error("Invalid database");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, "/tmp/forge-snapshot.sqlite");
  } finally {
    db.close();
  }
  const data = readFileSync("/tmp/forge-snapshot.sqlite");
  unlinkSync("/tmp/forge-snapshot.sqlite");
  if (data.length > 8_000_000) throw new Error("Snapshot exceeds limit");
  process.stdout.write(JSON.stringify({ database: data.toString("base64") }));
} catch (error) {
  if (error.code === "ENOENT") process.stdout.write('{"database":null}');
  else {
    process.stderr.write("Snapshot failed");
    process.exitCode = 1;
  }
}
