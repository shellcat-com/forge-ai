import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "../src/server/db";

if (process.env.DATABASE_DIRECT_URL) process.env.DATABASE_URL = process.env.DATABASE_DIRECT_URL;
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
  for (const name of (await readdir("drizzle"))
    .filter((n) => /^\d+_.*\.sql$/.test(n))
    .sort()) {
    const id = name.split("_")[0];
    const sql = await readFile(`drizzle/${name}`, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "SELECT hash FROM forge_migrations WHERE id=$1",
      [id],
    );
    if (existing.rowCount && existing.rows[0].hash !== hash)
      throw new Error(
        "Applied migration was changed. Add a new migration instead.",
      );
    if (!existing.rowCount) {
      await client.query(sql);
      await client.query("INSERT INTO forge_migrations VALUES ($1,$2)", [
        id,
        hash,
      ]);
    }
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
