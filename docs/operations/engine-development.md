# Engine development and restart instructions

> Historical RFC/checkpoint document. The current application uses Next.js, Better Auth and `src/server` / `worker`. Old Vite/Neon Auth setup commands and pending architecture decisions below are historical context, not current setup instructions. See [PR #7 reconciliation](../reports/pr7-reconciliation.md).

The private-alpha release is blocked. D1–D8 remain OPEN; all live generation, execution and preview capabilities stay disabled. Existing NVIDIA planning access and Neon staging credentials are not engine authorization. Follow the current [implementation board](../reports/e2-e5-board.md) and [decision sheet](../reports/engine-decisions.md).

## Reproduce the independent implementation checks

From the repository root, with its existing dependencies installed:

```sh
npx vitest run tests/engine/e2-*.test.ts tests/engine/e3-runtime.test.ts tests/engine/e3-collector.test.ts tests/engine/e3-release.test.ts tests/engine/e3-host.test.ts tests/engine/validation-*.test.ts tests/engine/operations.test.ts tests/engine/preview-policy.test.ts src/engine/client.test.ts src/engine/flow.test.ts
npx tsc -p tsconfig.engine.json
```

The native migration drill is opt-in. It creates a private temporary PostgreSQL cluster over a Unix socket, runs only reviewed synthetic SQL, stops it and removes its data. It never accepts a caller database URL or generated SQL:

```sh
FORGE_NATIVE_MIGRATION_TEST=1 npx vitest run tests/engine/validation-native.test.ts
```

E1 owns its control database/worker lifecycle and report. Do not run shared integration verification while that task is changing its build; the coordinator will record the final stable `npm run verify` and database results. Control service commands must follow the E1 report and use separate API, worker and maintenance roles. Do not reuse a Neon prototype DSN, migration superuser or provider key.

## Pinned candidate compatibility

`templates/next-postgres-v1/` is the reviewed **platform-authored candidate scaffold**, not generated source or a verified release. Its package/lock pin the proposed toolchain. The local checks deliberately do not execute arbitrary provider output. To repeat its local scaffold check with exact Node24.20.0 on PATH:

```sh
cd templates/next-postgres-v1
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build
```

The worker recorded the official Node archive checksum and full six-theme/viewport candidate browser evidence in `runner/evidence/candidate/`. The optional browser script accepts only the fixed local scaffold URL: see the template README and E3 report. Stop any listener you start. Its health route reports process readiness, not database readiness.

PostgreSQL18.6 was separately compiled from the official checksum-verified source archive under a temporary private prefix, without optional ICU/readline. No global installation or service was created. The source archive/prefix are recorded in `docs/reports/evidence/e2-e5/postgres18-source.json`. With that exact installation's `bin` directory on PATH:

```sh
FORGE_POSTGRES18_CANDIDATE_TEST=1 npx vitest run tests/engine/e3-postgres-candidate.test.ts
```

This test requires `postgres --version` to report18.6, creates a fresh socket-only database, loads the actual template bootstrap, tests default privileges and reviewed fresh/prior-seeded additive migrations, restarts the database and removes the cluster. It does not test application-process persistence, the guest credential provisioner, Linux or sandbox containment. Never repurpose it for provider SQL.

## Source and runner integration boundaries

`ArtifactStore` verifies exact immutable version/hash/bytes; `LocalSyntheticObjectBackend` is restart-persistent local synthetic storage, not approved production object storage. Catalog validation, source assembly, complete manifests, diffs, scanner-bound ZIP preparation and restoration are implemented independently. E1 must authorize scoped reads and adopt exact object references under its lease/state fences.

`SandboxBroker` exposes signed, fixed actions only. `UnavailableFirecrackerDriver` remains the production default. The host inventory/watchdog controller has explicit OS-fake tests; no real LinuxExecutor, guest RPC, image builder or installed privileged supervisor is supplied. Do not substitute ordinary host or container execution. The uninstalled files under `runner/host/` are review candidates with missing real-host gates documented in their README.

`EngineClient` and `EngineFlow` are headless current-API clients; they do not create authentication from local state. The current fixture API cannot supply a working real preview/source-export endpoint. The existing local UI remains intact and samples remain labeled. Browser flow connection and immutable-artifact adoption must use the single E1 service after its documented handoff.

## Resume without losing concurrent work

1. Read AGENTS.md, RFC0001, E0, E1's final report if present, the board and E2–E5 reports.
2. Inspect `git status` and `git worktree list`. The shared checkout contains unrelated/concurrent changes. Do not reset, stash or commit them as this task's output.
3. Worker baseline/branches are recorded by the board and `../forge-e2-e5-worktrees/baseline.json`. Transfer only reviewed owned-file diffs; dependency-reference commits in worker branches must not be applied twice.
4. Keep control/contracts/migrations/manifests under one named owner. E1's handoff is required before editing its control files; a passing isolated worker suite does not prove E1 finished.
5. Validate A01–A22 evidence and preserve historical failed runs. Never convert fixture labels into live acceptance. Final release needs real-provider/runner/identity/storage/preview evidence and all owner decisions closed.
