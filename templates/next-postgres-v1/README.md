# Next.js + PostgreSQL template candidate

**Candidate, not a released template.** This is a platform-authored scaffold. `/api/health` reports process health only; there is no generated task-board UI, authentication or live-provider output. Next 16.3.4, React 19.3.0, Node 24.20.0, bundled npm 11.19.0 and PostgreSQL 18.6 remain explicit candidate pins. No approved Linux image exists.

## Use an exported source archive outside Forge

Verify the archive SHA256 against its authenticated download record, extract into a new directory, and inspect source before running it on your own computer. Install the exact Node version using its official archive and published checksum. These commands require no Forge server or API key:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
npm start
```

Serve the production application at `http://127.0.0.1:3000`. For offline installation, first acquire the reviewed bundle on a trusted networked machine using the separate toolchain instructions, import its pinned contents into a fresh npm cache, then use `npm ci --offline --ignore-scripts --no-audit --no-fund --cache /absolute/verified-cache`. Missing bytes must fail. Local export execution is outside Forge's sandbox guarantee. Never use these host commands to verify untrusted provider source on a Forge control host.

## Disposable PostgreSQL reference drill

Create an empty disposable database named `forge_app` on PostgreSQL 18.6. Run `app-database.sql` against it as the bootstrap administrator exactly once. The bootstrap is intentionally not repeatable against an existing role/schema set. It creates restricted NOLOGIN `forge_app` and `forge_migrator` roles, schema ownership and default CRUD privileges. Provision separate randomly generated passwords and LOGIN through a private administrator connection with `password_encryption=scram-sha-256`; never paste secrets in shell arguments or source files. Use the supplied `pg_hba.conf` and loopback configuration in the guest. An exported application may use its owner's reviewed database connection policy.

Provide the migrator connection through a private environment/secret injection as `APP_MIGRATION_DATABASE_URL`. Run:

```sh
node platform/reference-migrate.mjs initial
# Insert a synthetic task as forge_app, then apply the additive change:
node platform/reference-migrate.mjs all
node platform/reference-migrate.mjs all
```

The runner checks database/role, serializes migration transactions, records hashes and rejects changed applied files or unexpected prior history. The second `all` is a no-op. The reference schema/priority SQL is in `reference/migrations/`; these are deterministic fixtures, not generated migrations. In the real engine, the trusted external migration service validates candidate SQL and hash/order before execution; this reference helper cannot replace it. Do not expose its migration credential to the Next process. Only `APP_DATABASE_URL` for the five-connection runtime role belongs in that process; `.env.example` contains placeholders only. Test fresh schema, prior rows receiving `medium`, invalid priority rejection, CRUD, denied DDL/role/file access and app-process restart separately.

## Protected inputs

The release catalog protects package/lock, compiler, Next/Vitest/ESLint configs, next-env, platform tests/helpers, database bootstrap and reference files. Generated code may not replace them or supply root configuration/tests. Exact guest commands remain in the platform's `policy.ts`; they never execute model-controlled package scripts. Next's generated type files and build output stay in disposable scratch; source promotion reads immutable original source only.

The portfolio acceptance brief allows a read-only site with no database; it does not waive the full-stack task-board and additive migration gates. Static-only publication requires a separately approved export profile. Acquisition and macOS tests are supporting evidence. D7 requires actual Linux image/dependency/license/provenance, isolated offline build, database/browser/containment, clean generated export and live reference benchmark evidence before release.
