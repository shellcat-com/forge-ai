# Read-only hosted foundation preflight

The existing `scripts/check-cloud-readiness.mjs` now checks the current Better Auth
and E1 installer, not the historical Neon Auth service. Run it in a fresh Node 24
CLI process after installing the locked dependencies. Never import it into the
application server. It does not run migrations, modify flags, read real user/key
records, contact model/OAuth/email services, create sandboxes or deploy anything.

```sh
npm ci
node --env-file-if-exists=.env.local scripts/check-cloud-readiness.mjs
```

Supply secrets only through protected server configuration. Do not paste values
into chat, command arguments, committed examples or recordings. Required inputs:

- `FORGE_AUTH_MODE=hosted` and exact HTTPS `BETTER_AUTH_URL`.
- `BETTER_AUTH_SECRET`, `FORGE_IDENTITY_BRIDGE_KEY`,
  `FORGE_CREDENTIAL_KEYS_JSON` and optionally `FORGE_CREDENTIAL_KEY_ID` (default `v1`).
- Four separate installer-created runtime connections:
  `FORGE_AUTH_DATABASE_URL`, `FORGE_CONTROL_API_DATABASE_URL`,
  `FORGE_CONTROL_WORKER_DATABASE_URL`, `FORGE_CONTROL_MAINTENANCE_DATABASE_URL`.
- Exact `FORGE_AUTH_DATABASE_HOST` and `FORGE_CONTROL_DATABASE_HOST`. All four
  connections must identify the same dedicated database/host/port with distinct
  login names. This matches the current installer; mixed pooler/direct hostnames
  must be deliberately reconciled, not accepted by weakening host checks.

No migration-owner credential, `DATABASE_MIGRATION_URL`, legacy
`NEON_AUTH_BASE_URL`, or JWKS URL is required or contacted. The script reuses
`hostedPostgresConfig`, `assertAuthDatabase` and `ControlDatabase.check()`.
Certificate/hostname verification stays enabled. Each pool is limited to one
connection, read-only transactions and five-second connection/query bounds; the
CLI has a sixty-second absolute deadline. The CLI injects its own read-only auth
pool through the existing runtime seam and closes/removes it on completion. It
refuses to reuse an existing application auth pool.

Checks cover restricted runtime role membership, excessive database/file/schema
privileges, current Better Auth table/column access, the migration versions in
the canonical `engine/migrations` directory (not proposal/app SQL directories),
forced RLS for the tenant/source/credential tables, hosted settings and the exact
identity issuer. It queries authentication columns with `LIMIT 0`, not actual
accounts or sessions. It does not read privileged installer hash receipts, so
`migrationHashReceipts` remains `unverified`; use the separately authorized
installer schema-only review for those receipts. Never add privileged credentials
to this preflight to make it pass.

## Results and exit codes

- `foundationPassed` concerns database/configuration checks only.
- `gates` reports actual disabled/unconfigured enrollment, admission and worker
  settings, plus hosted connection/public signup and social configuration presence.
- `releaseReady` is always **false** and `liveAcceptance` is **not-evaluated**.
- Exit **1**: invalid/missing configuration, failed database check or cleanup, or
  timeout. Raw errors and connection strings are not printed.
- Exit **2**: database foundation checks passed, but this command cannot establish
  live release acceptance. Disabled flags and outstanding gates remain visible.
- Exit **0 is never emitted** by this preflight. Do not treat exit 2 as permission
  to promote the builder or enable admission. These exit semantics intentionally
  replace the historical configuration-only success code.

Do **not** enable worker/admission/enrollment flags merely to change this report.
An installed, intentionally disabled foundation is a valid milestone, not a beta
release. Presence of Google/GitHub settings is not OAuth callback acceptance;
missing social configuration remains visible without requiring a paid mail sender.
Sender-specific email validation stays in its own adapter/tests. No provider key
is requested by this command and no remaining free allowance is inferred from a
plan name or configured flag.

Real model generation, sandbox containment, preview authorization, publication,
restore/key recovery, self-host reproduction and the deployed multi-user rehearsal
must still be verified separately. `max_running`/`max_previews` are inspected only
as configuration; this is not evidence of atomic per-user/sandbox capacity or
measured throughput. A public availability page is not a successful beta rehearsal.

Focused reproduction:

```sh
npx vitest run tests/engine/hosted-readiness.test.ts --maxWorkers=1
npx vitest run tests/engine/hosted-readiness.native.test.ts --maxWorkers=1
```

The first suite uses explicit database ports/fixtures; the second uses a disposable
native PostgreSQL cluster and synthetic identities with an explicit Unix-socket
transport override. Neither test is live Neon/TLS or public beta acceptance.
Serialize native campaigns with other Forge tasks; do not relax timing assertions
to hide machine contention. See the scoped verification report for exact outcomes.

Rollback: reverting this preflight changes no database or deployment state. The
old checker is obsolete and must not be used as an alternative release gate.
