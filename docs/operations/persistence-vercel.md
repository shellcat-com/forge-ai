# Vercel website and control persistence handoff

Vercel is selected for the Forge website and public generated portfolio, with platform HTTPS URLs and no purchased domain. Task 08 is the sole deployment writer. This task has made no external resource, DNS, environment or Vercel configuration writes and has authorized no paid run.

Task 08 reports a read-only account check of team `biswas07` with active Hobby billing. This task has not independently inspected account configuration, function quotas, Fluid settings, database connections or a deployed Forge project. Existing unrelated projects are not deployment targets.

## Handler suitability

The following assessment is based on the canonical source and official documentation reviewed 2026-09-10 UTC. Public limits are not account access, budget approval or live acceptance.

| Existing path | Vercel suitability and remaining integration |
| --- | --- |
| Next.js website/public portfolio | Website hosting direction selected; Task 08 owns exact project, platform URL, build/deploy and browser acceptance. A static portfolio grants no control authority. |
| `src/app/api/projects`, project metadata/sharing/comments/import/remix, usage and account handlers | Bounded Node request handlers can use the approved PostgreSQL direction after exact HTTPS identity, schema, restricted login, pool/network and body-size checks. Their application schema remains distinct from RFC control state. Do not claim RFC admission semantics from legacy app job insertion. |
| `src/app/api/auth/[...all]` | Next.js/Better Auth handler is structurally suitable for Node Functions. Exact public origin, server-only identity secrets, invite policy and real sessions require Task 05/01 integration and live checks. |
| `src/app/api/providers`, provider test | Listing is bounded. Credential probes need Task 04's protected destination/credential flow and explicit applicable budget before a provider request. No key or billing assumption is derived from BYOK. |
| `src/app/api/status` | Request handler can run; current application readiness is not the new persistence preflight. Task 01/08 must wire truthful unavailable controls. |
| `engine/control/http.ts` `/api/v1` commands and reads | Business operations use PostgreSQL transactions, jobs, reservations and idempotency. Current entry point creates a loopback Node server and enforces fixture mode; it is not an installed Vercel handler. Task 01 must supply thin request adapters and a real identity/source composition. Do not proxy a hosted browser to loopback or widen fixture flags. |
| Application and RFC SSE handlers | Persistent database replay is compatible with bounded Function streams. Rotate cleanly before invocation expiry; reconnect with Last-Event-ID, preserving E1 job/sequence format, retention-gap 410 and authorization on each poll. Add distributed per-session stream limits; the RFC counter is currently process-local. The application cursor format differs and cannot be silently mapped. |
| Application ZIP export / RFC source export | Existing in-memory ZIP and up-to-32-MiB artifact responses require a tested bounded streaming or authenticated external download path. Do not expose permanent public object URLs or assume every response fits the Function payload limit. |
| `engine/control/index.ts worker`, reconciler and object sweeper | Require a selected external persistent process with PostgreSQL leases/fencing and restart reconciliation. Infinite polling/heartbeat loops are not a Vercel Function workload. No durable workflow service is selected. |
| `worker/index.ts`, local Docker runtime and preview server | Existing local workflow uses Docker, process lifetime and retained preview handles. Keep self-hosted; do not run it in Vercel Functions or label it the RFC hardened runtime. Task 02 owns isolated execution. |

Official documentation currently lists Fluid Hobby invocation duration at 300 seconds, with streaming time included, and a 4.5 MB request/response payload limit. Task 06's configuration candidate uses a conservative 30-second handler/20-second SSE rotation; actual account settings must be verified. Higher tiers and Workflow do not constitute authorization to upgrade or adopt another service. [Vercel Function limits](https://vercel.com/docs/functions/limitations).

Use a small Node `pg` pool per instance plus an approved pooled endpoint and account-level connection envelope. Cached pools improve connection reuse only; transactions, jobs, SSE cursor state and objects must survive losing every Function instance. Vercel documents pool lifecycle handling for suspended instances; Task 01 owns any root dependency/lifecycle integration. [Connection pooling with Functions](https://vercel.com/kb/guide/connection-pooling-with-functions).

## Configuration contract

`engine/hosting/persistence-config.ts` is a **read-only integration seam**, not wired deployment configuration. It starts no service and makes no network call. `persistencePlan` returns safe readiness blockers; configuring adapter names alone cannot pass them. Trusted probes must separately establish role/schema, exact object versions, key recovery, identity, worker lease recovery, transactional artifact adoption, shared SSE limits, HTTPS routing and deployed restore. Caller-supplied JSON or boolean environment flags are not acceptance evidence.

Candidate server-only settings:

| Setting | Contract |
| --- | --- |
| `FORGE_HOSTED_ORIGIN` | Exact assigned HTTPS origin, without trailing slash/path, credentials, wildcard, IP address, loopback or custom port. Use Task 08's actual issued URL. |
| `FORGE_HOSTED_MODE` | Defaults to `website-only`; control remains unavailable. `control` alone enables nothing. |
| `FORGE_BROWSER_API_BASE` | Omit or use `/api`; same-origin browser requests only. |
| `BETTER_AUTH_URL` | Must match the exact origin. No wildcard trusted origins or preview-host trust from a request header. |
| `FORGE_DURABLE_WORKER` | `unavailable` by default; `external-process` only after a reviewed host/maintenance arrangement. No Function or workflow fallback. |
| `FORGE_OBJECT_BACKEND` | `unavailable` by default. `postgres-encrypted-v1` is an optional adapter selection that still needs role/schema/key/retention/capacity acceptance. |
| Database URLs / keys / credential references | Server-only injection. Never put them in `NEXT_PUBLIC_*`, `VITE_*`, source export, artifacts, model context or generated-app environment. Distinct application/control/object/API/worker/maintenance identities. |

`hostedPostgresConfig(dsn, expectedHost)` requires an administrator-selected exact host and produces a pool configuration with certificate/hostname verification enabled, including when the DSN says `sslmode=require`. It rejects `sslmode=disable`, arbitrary connection options, duplicate TLS options, alternate hosts and IP/loopback DSNs. It emits individual connection fields so DSN options cannot override `ssl`. The hostname validator is not a generic SSRF resolver: approved database DNS/network egress must be administered independently. There is no user-supplied database host API.

Keep HTTPS termination and host-only Secure/HttpOnly cookies at the actual platform origin. Route same-origin API requests to real Node handlers or an explicitly configured accessible HTTPS control service; a Function's `127.0.0.1` is not the developer's workstation. The current default-off RFC loopback server must remain local. Vercel temporary files may hold transient response/build scratch only, never job state, artifacts, keys, leases or backups.

For a website-only deployment, show storage/worker/control unavailable and do not configure private engine credentials. Task 08 may publish the static site while control access is blocked. A real generated portfolio still needs separately evidenced provider output and approved build/runtime handling; a static fixture does not satisfy it.

## Exact remaining access/decisions

Task 01 must accept/publish the object schema and wire same-transaction adoption and the app/control identity bridge. Task 04 owns encrypted provider credential storage and budgets; Task 05 owns real session/membership authorization. Task 06's local key resolver does not select a managed KMS. Specify approved Neon target/region, restricted-role capability and connection envelope; object backend/residency/retention/capacity; key escrow and restore operator; external worker host and maintenance schedule; off-site backup/PITR/deletion policy. Task 08 supplies exact Vercel target/origin and coordinates all deployment writes. No missing service has been bought or reported ready.
