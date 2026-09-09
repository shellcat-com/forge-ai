import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
const globalDb = globalThis as unknown as { forgePool?: Pool };
export function pool(): Pool {
  if (!process.env.DATABASE_URL)
    throw new Error("Database is not configured. Run npm run setup:local.");
  return (globalDb.forgePool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
  }));
}
export function db() {
  return drizzle(pool(), { schema });
}
