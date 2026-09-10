# Task 01 — Canonical baseline

Status: integration checks passed; clean remote reproduction and browser/CI verification follow publication. Not live release acceptance. Worker baseline commit `881e9ac2b11f8f168cb7849b77c4ee7439e55458`; branch `codex/demo-delivery-baseline`, draft PR base `master`. The [coordination board](../../operations/demo-delivery-coordination.md) records composition, assignments, contracts, migrations and unresolved infrastructure.

The canonical composition merges PR #7 at `a71519bdffd61b83d24413efc1a53327b4304160` with checkpoint `2c98c4f8ea6c2dd4feaef7eee561b373f545b0fe`. It preserves the merged Next.js app and completed E1/source-flow work. Neither the dirty shared checkout nor worker branches were rewritten. PR #7's newer reconciliation supersedes the old report's claim that it remains conflicting. All changes are isolated in `../forge-demo-delivery-task01`.

The scope amendment includes open-source BYOK, Vercel hosting for Forge and a real generated portfolio, and no purchased domain. Durable workers/storage, runtime isolation, private preview authorization and public multi-user generation remain distinct. Selection is not live acceptance; no paid call, infrastructure purchase or deployment was performed.

## Conflict reconciliation

Kept PR #7's Next.js manifests/lock, application code, CI, strict checks, stylesheet isolation and obsolete Vite entry deletion. Took the newer checkpoint's E1 source integration, runner TLS fix, immutable artifacts, full source-review client, SQL 0003, native repair/HTTP coverage and historical evidence. Restored current type-only imports with ESLint. Added DOM iterable types to the standalone engine check and made the historical design harness's optional Vite metadata explicit, preserving its fail-closed development guard and retained stylesheet path. The harness remains unrouted; no new UI route or fixture identity is exposed.

Initial integrated typecheck found missing DOM iterable types and undeclared `import.meta.env` in the newly retained harness. Both were corrected; final checks are recorded below after completion. Existing production UI/server/worker and application migrations remain byte-identical to PR #7. Engine migrations retain original hashes.

## Verification and reproduction

Node 24.20.0 / npm 11.11.0, PostgreSQL 14.18 (Homebrew):

- `npm ci`: passed, existing peer/deprecation/install-script warnings.
- `npm run verify`: passed lint, both strict TypeScript checks, **590 tests passed / 4 optional cases skipped**, Next.js production build. [Log](../evidence/task-01/integration-verify.log).
- `npm run test:db:control`: passed **45 native PostgreSQL constraints/RLS assertions** on disposable synthetic data. [Log](../evidence/task-01/integration-native.log).
- `npm run control:build`: passed; both `node dist-engine/control/index.js api` and `worker` exited disabled with no listener/database/worker. [Build log](../evidence/task-01/integration-control.log).
- Historical acceptance-ledger CLI: passed byte-hash validation; remains 21 blocked, E1 fixture-verified, no live release. [Summary](../evidence/task-01/historical-ledger-validation.json).
- Preservation diff: application UI/server/worker/manifests, accepted contracts/SQL/template unchanged from their selected parents. [Record](../evidence/task-01/preservation.json).
- `git diff --check` on the working edits passed; the full staged merge reports trailing whitespace/blank EOF in retained raw evidence logs and original RFC Markdown hard breaks. These bytes are preserved, not silently cleaned. Source/configuration whitespace checks pass. Gitleaks reviewed all added/changed content against master; one intentional synthetic secret-scanner negative-test fixture, zero real credentials identified. [Disposition](../evidence/task-01/secret-review.json).

The initial integrated typecheck failure was fixed before this passing run; type-import whitespace was normalized afterward and will be checked again in clean reproduction. No runtime behavior changed in that normalization. All synthetic/native tests and browser checks will be labeled separately from skipped/live acceptance. Native PostgreSQL tests use fresh disposable private-socket clusters, never user databases or `.env.local`. Browser configuration has no provider keys and performs no generation.

## Remaining dependencies

Tasks 02–09 have not delivered implementation PRs to this task. Follow the coordination board's integration order. Live identity, BYOK/accounting, real isolated runtime/image, durable hosted services, private preview, approved budget/access, public demo and independent release acceptance remain open. This PR is a tested integration baseline, not a claim of 100% product completion. Do not auto-merge.
