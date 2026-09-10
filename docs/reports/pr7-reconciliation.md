# PR #7 reconciliation

## Outcome

Merged `origin/master` into `codex/e1-control-checkpoint` in a separate clean checkout. Both parent histories are retained; the original user's checkout and uncommitted files were not changed. This updates the PR branch only, without merging the PR into `master`.

The current Next.js application, Better Auth integration, production `src/server` / `worker` workflow, Docker runtime and additive application migrations remain authoritative. The RFC checkpoint is retained as a default-off, loopback-only fixture laboratory. No production route or worker imports its control service or old Neon Auth browser prototype. This reconciliation does not implement hosted generation, select additional vendors, provision infrastructure or run live provider requests.

## Conflict decisions

- `.env.example`: retain the current production configuration. Fixture service settings remain separate `FORGE_CONTROL_*` process variables documented in `engine/control/README.md`; no inherited production DSN/session fallback exists.
- `.gitignore`: retain production exclusions and add `dist-engine/`.
- `DESIGN.md`: retain the current production design specification unchanged.
- `README.md`, architecture and provider docs: retain the current app description and explicitly separate historical RFC/prototype capabilities. Add historical notices to older setup/design-decision documents.
- `index.html`: preserve its deletion; remove the obsolete Vite `src/entry.ts`. Preserve the old prototype shell as `src/cloud/legacy-shell.css`, imported only by its unrouted prototype.
- `package.json`: retain Next.js lifecycle, current production migration command, browser tests and dependency security overrides. Add fixture validation/build commands and required dependencies. Do not restore the legacy cloud API/migration lifecycle commands.
- `package-lock.json`: regenerate from the reconciled manifest and verify with a clean install.
- TypeScript: retain strict Next.js checking and separately check the engine, runner, browser protocol client and harness with `tsconfig.engine.json`. This avoids Next.js ambient environment declarations leaking into standalone Node fixtures without dropping those files from verification.
- ESLint: retain current rules and generated-output exclusions; adapt checkpoint type-only imports and Node script globals.
- CI: retain current Node 24 validation and install native PostgreSQL tools for E0/E1 tests, SQL assertions and the standalone service build.

## Identity, schema and workflow boundaries

The production app uses Better Auth/local owner authorization and the application schema under `drizzle/`. `npm run db:migrate` still runs `scripts/migrate.ts`. The laboratory uses fixture identities, its own cookies and an explicitly supplied synthetic database with the separate `forge_control` schema. Production accounts, IDs, sessions and queues are never mapped automatically to fixture records. Both accepted engine SQL migrations and the production migrations remain unchanged. The earlier `server/cloud` migration/identity prototype remains historical test source, not an application setup path.

The production worker retains its existing queue/runtime behavior. The fixture worker only processes explicitly configured synthetic stages, with execution and preview startup rejected. Keeping these tested contracts does not adopt a second production control engine or claim that RFC E2–E5 live acceptance has passed.

## Validation

- Clean `npm ci` on Node 24.20.0: passed; **zero reported vulnerabilities**. [Log](evidence/pr7/install.log).

- `npm run verify` on Node 24.20.0: passed lint, both strict TypeScript configurations, **466 tests passed / 2 optional native database cases skipped**, and the Next.js production build. [Log](evidence/pr7/verify.log). The 45-case native E1 suite is included in the passing total.
- `npm run test:db:control`: **45 native PostgreSQL constraint/RLS assertions passed**, PostgreSQL 14.18, fresh temporary cluster. `npm run control:build`: passed. [Log](evidence/pr7/control.log).
- `npm run db:migrate`: passed all current application migrations on a fresh private-socket PostgreSQL cluster with no existing data or credentials. No fixture/cloud migrations were applied to it.
- `npm run test:e2e` against the reconciled production server and fresh database: **24 passed / 15 explicitly gated cases skipped**. Includes composer persistence, canonical navigation, provider availability UI and foreign-origin rejection, light/dark at 390/768/1440px (plus narrower checks), keyboard focus, reduced motion, clipboard behavior and 200% zoom reflow. [Log](evidence/pr7/browser.log).
- Visually inspected six production Home screenshots across light/dark and 390/768/1440px. No clipping or unexpected shell changes observed. Screenshots and the documentation zoom capture are saved beside the logs.
- Standalone control API and worker both exited with `Forge control disabled. No listener, database or worker started.` when no fixture flags were provided.
- Diff review confirms production UI, server, worker, design, environment example and application migrations are byte-for-byte unchanged from the merged master; engine migrations and old evidence are also unchanged. No unresolved conflict markers remain.

Limitations: the two optional native tests require additional opt-in/pinned PostgreSQL 18.6 setup. The 15 browser skips require existing imported/generated projects, live providers or a generated Pomodoro acceptance target; they are not passes. No live provider, hosted authentication, generated execution or deployment was exercised. The unrouted Neon prototype retains its existing jsdom and API regression coverage, not a new browser/TLS authentication verification. Dependency installation retains existing prototype auth peer/deprecation warnings. Original E0/E1/publication evidence remains historical and unchanged. The lint-only import updates mean old source manifests describe the original checkpoint rather than this merge.
