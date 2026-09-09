import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "../src/server/db";
const sql = await readFile("drizzle/0001_initial.sql", "utf8");
const hash = createHash("sha256").update(sql).digest("hex");
const client = await pool()
  .connect()
  .catch(() => {
    console.error(
      "Database is unavailable. Run npm run setup:local and retry.",
    );
    process.exit(1);
  });
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(714293)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS forge_migrations (id text PRIMARY KEY, hash text NOT NULL)",
  );
  const existing = await client.query(
    "SELECT hash FROM forge_migrations WHERE id=$1",
    ["0001"],
  );
  if (existing.rowCount && existing.rows[0].hash !== hash)
    throw new Error(
      "Applied migration was changed. Add a new migration instead.",
    );
  if (!existing.rowCount) {
    await client.query(sql);
    await client.query("INSERT INTO forge_migrations VALUES ($1,$2)", [
      "0001",
      hash,
    ]);
  }
  await client.query("COMMIT");
  console.log("Database migration verified.");
} catch {
  await client.query("ROLLBACK");
  console.error("Migration failed; no schema changes committed.");
  process.exitCode = 1;
} finally {
  client.release();
  await pool().end();
}
