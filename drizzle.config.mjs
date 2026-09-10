import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/cloud/schema.mjs',
  out: './server/cloud/generated',
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL || '' },
})
