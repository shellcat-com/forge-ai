import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
export function database() {
  mkdirSync(".data", { recursive: true });
  const db = new DatabaseSync(".data/app.sqlite");
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '');",
  );
  return db;
}
