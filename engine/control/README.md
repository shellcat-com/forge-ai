# Fixture control API (E1)

This is a separately configured, **default-off** control service. It stores synthetic projects and durable fixture jobs in `forge_control`. It has no live identity issuer, generation provider, executable runner, object-store connection, preview URL or deployment engine. The existing Vite app and loopback NVIDIA planning API are separate. See [the E1 report](../../docs/reports/e1-control.md) for coverage, gates and the E2 handoff.

## Local checks

- `npm run verify`: repository checks, including E1 integration tests.
- `npm run test:db:e1`: creates a fresh native PostgreSQL cluster on a private temporary Unix socket, explicitly applies 0001 and 0002, creates non-owner test login roles, seeds synthetic fixtures, tests the API/workers, then stops and removes the cluster. Requires local `postgres`, `initdb` and `pg_ctl`; absence is a failure, never a fixture success or silent skip. No existing database or `.env.local` is read.
- `npm run test:db:control`: accepted E0 SQL constraint/RLS regression corpus on another fresh native cluster.
- `npm run control:build`: emits the trusted control service under ignored `dist-engine/`; it does not build or execute generated projects.
- `npm run api:control` / `npm run worker:control`: exit without a listener, database connection or worker unless explicitly configured.

## Configuration and operator boundary

The entry point reads only process environment; it does not load `.env.local` or apply migrations. Enabling the API requires all of `FORGE_CONTROL_ENABLED=true`, `FORGE_CONTROL_MODE=fixture`, an exact loopback `FORGE_CONTROL_ORIGIN`, `FORGE_CONTROL_PORT`, loopback `FORGE_CONTROL_DATABASE_URL`, and a separately supplied random 32-byte lowercase hex `FORGE_CONTROL_SESSION_KEY`. No key/credential defaults exist. Use a synthetic database, never real user data. Cookies are Secure/HttpOnly/host-only; Node integration tests explicitly carry them. Browser/TLS login with a real issuer remains D1/D5 work.

Admission additionally requires `FORGE_CONTROL_ADMISSION=true`. The worker process additionally requires `FORGE_CONTROL_WORKERS=true` and distinct `FORGE_CONTROL_WORKER_DATABASE_URL` / `FORGE_CONTROL_MAINTENANCE_DATABASE_URL`. `FORGE_CONTROL_EXECUTION=true` and `FORGE_CONTROL_PREVIEW=true` fail startup. No provider endpoint or runner URL can be selected through configuration or HTTP in E1.

An operator explicitly applies `engine/migrations/0001_control.sql`, then `0002_durable_control.sql`, as a migration owner on an approved synthetic database. Bind separate non-owner, non-superuser, non-BYPASSRLS logins to exactly one NOLOGIN role: `forge_control_api`, `forge_control_worker`, or `forge_control_maintenance`. Never grant the internal NOLOGIN `forge_control_guard` to a runtime login. Startup rejects conflicting/privileged inherited roles and database ownership. Function owners have enumerated grants, fixed search paths and explicit RLS policies; PUBLIC has no function execution grant.

Migration 0002 intentionally inserts no `control_settings` row. Explicit synthetic setup must supply bounded job spend, queued/running caps and workspace quota rows, plus invited fixture users/memberships. The native harness is the executable setup example; it runs only on its newly created cluster. Financial values in these tests are synthetic microdollars; fake completed calls cost zero. They are not approved pricing or spend authority.

Durable maintenance controls are `control_settings.admission_enabled`, `worker_enabled`, and `security_shutdown`. Admission checks both its process flag and the database switch. Worker claim/heartbeat/commit check durable switches. Security shutdown fences work and reconciles resources; stopping admission alone drains existing work. Migration/operator authority can insert a digest into `revoked_policies`; API/worker cannot waive revocation. Changes serialize with admission/worker/promotion through the settings row. The approved operator identity, audited administration transport, real invites, pricing, backup/retention and production deployment remain D1/D4/D5/D8 gates.

`ControlReconciler.runOnce()` is a narrow internal maintenance operation. `resolveUncertain(workspace, job, operation, amount)` resolves only terminal fixture liabilities, bounds the amount by the recorded maximum, deduplicates the adjustment, appends service audit evidence and charges the original quota period. It is not exposed through HTTP. No uncertain outcome is silently treated as zero.

## Runtime behavior

Job admission, quota reservation, first queue step/event and idempotency response commit atomically. Membership is locked on each request; tenant GUCs are transaction-local and reset on pooled reuse. Mutation idempotency is scoped by workspace/actor/route/key for 24 hours. Source revisions, reviews and promotion use locked current records, E0 canonical hashes and the E0 reducer. Source restoration requires explicit preview-data-reset acknowledgment and new verification/approval.

Workers claim with SKIP LOCKED, 60-second leases and increasing epochs; heartbeat every 15 seconds. The fixture adapter call has a 120-second bound even if it ignores AbortSignal. Recorded fixture results can survive worker restart; an unknown provider outcome retains its maximum liability. Cleanup has its own generation: late confirmations cannot clean a newer lease. Access is revoked before pending teardown, and reservations/capacity remain until confirmation. Stored fixture previews expire after 15 minutes idle or two hours absolute; they are inventory records, never running apps or accessible URLs.

SSE authenticates same-origin reads, rechecks authorization on every poll (one second by default, no more than 30 seconds), uses job-scoped sequence cursors, replays in order and closes after terminal replay. Retention gaps return 410 with `earliestSeq`, `stateUrl` and `replayRequired`. Streams have a three-per-session cap and a 256 KiB output-buffer limit. Disconnect does not cancel work. Logout conservatively revokes all that fixture user's preview credentials because E0 has no parent platform-session FK on tickets.

E1 retains immutable source/audit/billing records and implements a logical 30-day event replay floor. Physical deletion/purge needs the separately reviewed D5 retention mechanism; existing append-only triggers are preserved. No raw SQL, arbitrary storage URL, session token in localStorage, or generic command execution route is exposed.
