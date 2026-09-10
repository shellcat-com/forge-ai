# Architecture

The integration combines the approved Forge interface with the existing Next.js engine. Next.js App Router is the sole web runtime. The original Vite rendering helpers are preserved as escaped public markup under `src/public-renderers`; they are not a second router.

```mermaid
flowchart LR
 Browser --> Next[Next.js interface and API]
 Next --> Auth[Better Auth and server authorization]
 Auth --> PG[(Forge PostgreSQL)]
 Next --> PG
 PG --> Worker[Local worker]
 Worker --> Providers[Configured model adapters]
 Worker --> Docker[Isolated Docker candidate]
 Docker --> Preview[Separate loopback preview origin]
 Worker --> Revisions[Saved source, runtime version and development snapshot]
 Revisions --> PG
```

## Implemented boundaries

- `src/components/workspace.tsx`: prompt-first Home, project library, connections and settings.
- `src/components/project-workspace.tsx`: persistent conversation, progress, preview, Monaco, history and review controls.
- `src/app/api`: authenticated project/job/event/file-export/sharing/comment interfaces. Local mode has a configured owner and loopback request checks; hosted mode uses Better Auth sessions and server permissions.
- `src/server/auth`: Better Auth/Drizzle configuration, conditional OAuth/email/dashboard integrations, invitation gate and project access checks.
- `src/server/projects/service.ts`: additive persistence, owner-level submission locks, explicit base revisions, idempotency, project/request caps.
- `worker/index.ts`: durable queue consumption, cancellation, model generation, up to two targeted build repairs, saved revisions and recovery. Idea/Brainstorm/Plan use no build sandbox.
- `src/server/generation`: bounded file batches, protected path validation and relevant source selection. Nested pages, reusable components and server routes are supported. Locked dependencies and trusted runtime configuration remain controlled by Forge.
- `src/server/workspaces`: restricted local Docker execution and preview relay. Generated code does not execute in the Forge web/worker process or receive Forge credentials.
- `server/`: retained separate loopback NVIDIA text-planning service. It is not yet a verified code-generation adapter.

## Current limitations

The worker still uses a global process lock and one active local preview. It pauses that preview during rebuilding and recovers the last working revision after failure. Hosted per-project leases, fencing, independent candidates, E2B execution, R2 artifacts, monetary reservations and deployment adapters remain unimplemented. Hosted generation is gated accordingly.

Legacy SQLite applications and their data snapshots remain local. The starter still includes the historical generic items helper; general application-specific server data modules need further implementation. A successful build and HTTP response are not a complete functional or security verification of generated software.

Source restoration creates a revision and preserves current development data by default. Explicit development-data recovery is separate. Production rollback is not implemented and must never be inferred from source restoration.

## Migration

Migrations 0001–0003 are additive. `scripts/import-engine.mjs` copies explicitly selected local engine projects with an explicit owner, verifies source contents and creates an ignored private recovery file. It preserves project, job and revision IDs; event cursors are destination-local. It does not copy runtime handles or modify the source database. Browser JSON import retains original files and creates archived drafts without generating source.

See [implementation status](implementation-status.md), [cloud status](cloud-setup-status.md), and the [approved plan](implementation-plan.md). Earlier numbered milestone reports describe the original engine at their capture time, not this integration's release status.

## Retained RFC fixture laboratory

`engine/`, `runner/`, `src/engine/` and `tests/engine/` preserve the E0/E1 checkpoint and later synthetic generation/runner groundwork. Next.js remains the sole application runtime, and `src/server` with `worker/index.ts` remains the production workflow. No Next route or production worker imports the fixture service. `api:control` and `worker:control` are explicit laboratory commands, disabled unless separately configured for loopback fixture mode. They cannot enable execution or previews.

The fixture service uses a separate synthetic PostgreSQL database, `forge_control` schema and `FORGE_CONTROL_*` settings. Its fixture users, cookies, memberships, revisions and quotas do not grant Better Auth or production project access. Application `db:migrate` continues to run `scripts/migrate.ts`; it never applies `engine/migrations/` or `server/cloud/migrations/`. The E0/E1 migrations are unchanged and are applied only by isolated tests or explicit fixture setup. There is no automatic schema/identity conversion or second production queue.

`src/cloud/` and `server/cloud/` retain the earlier Neon Auth prototype for regression tests only. The Vite `index.html` and `src/entry.ts` are removed, no application route imports this prototype, and its old API/migration scripts are not package lifecycle commands. Its standalone CSS is imported only by the prototype. This preserves historical work without replacing the application's Better Auth identity or exposing another browser router. [Reconciliation details](reports/pr7-reconciliation.md).
