# Publication checkpoint

This branch publishes the completed E0/E1 work and the independently implemented, disabled engine groundwork present in snapshot `b981ec6b1dfafdeacd32a3765479fd1613622c9a`. It excludes later shared-checkout E2 source-bridge, HTTP and Vite UI edits. The checkpoint was prepared in a separate worktree; the original checkout/index and concurrent implementation were not modified.

## Verification of the published checkpoint

- Clean `npm ci`: passed; zero reported vulnerabilities. Existing auth dependency peer/deprecation warnings remain.
- `npm run verify`: passed; lint, strict typecheck, 408 tests passed / two optional database cases skipped, and production build. [Log](evidence/publication/verify.log).
- `npm run test:db:control`: passed; native PostgreSQL 14.18 and 45 constraint/RLS assertions. [Log](evidence/publication/native-postgres.log).
- `npm run control:build`: passed. [Log](evidence/publication/control-build.log).
- Every file/hash in the frozen E1 manifest matched this snapshot. Historical E0/E1 logs were restored into the publication package; E1 log checksums were verified before copying.
- Source credential-pattern inspection found no credential matches. No `.env.local`, private key, live session, provider credential or generated build directory was included.

The native E1 suite runs inside the 408 tests and retains all 45 cases. Optional tests gated by `FORGE_NATIVE_MIGRATION_TEST` / `FORGE_POSTGRES18_CANDIDATE_TEST` were skipped; they are not counted as passes. The ancestor Expo configuration warning and Node localStorage warning did not fail verification. No live provider, generated-code execution, deployment or infrastructure provisioning was enabled. Existing disabled cloud/identity prototypes are not D1/D5 vendor decisions. Historical E2/E3 reports may reference local logs outside their original source snapshot; this publication does not fabricate those missing logs or upgrade their acceptance claims.

CI now installs native PostgreSQL tools before running the repository tests, and also checks the accepted E0 SQL corpus and standalone control build. Hosted CI remains subject to the merge conflict below; local checks are not represented as hosted checks.

## Merge blocker

While preparing this publication, `origin/master` advanced from the shared checkout's `e8947bb` baseline to `6a8095e`, through merged PR #4. That branch introduces a Next.js Forge frontend and another `src/server` / `worker` engine. The RFC checkpoint retains its Vite frontend and separately configured `engine/control` service.

A read-only three-way merge assessment reports conflicts in `.env.example`, `.gitignore`, `DESIGN.md`, `README.md`, `docs/architecture.md`, `docs/provider-integration.md`, `eslint.config.js`, `index.html` (modify/delete), `package.json`, `package-lock.json`, and `tsconfig.json`.

Resolving this requires an explicit architecture/identity/workflow reconciliation. Do not overwrite the merged work, silently adopt its rewrite/vendors, or retain two competing control engines merely to obtain a clean merge. The user authorized committing/pushing and merging where possible; this PR remains reviewable until that integration is resolved. It does not change `master` or enable automatic merging.
