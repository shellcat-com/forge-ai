# Task 01 — Canonical baseline

**Delivered:** [draft PR #8](https://github.com/shellcat-com/forge-ai/pull/8), base `master`, branch `codex/demo-delivery-baseline`. Worker starting commit: **`881e9ac2b11f8f168cb7849b77c4ee7439e55458`**. Clean reproduction/code commit: **`591f87c7a2e9e8f8f18b356852e922f2d3c1bf19`**. Subsequent documentation/evidence commits do not change the tested implementation; the PR identifies the final branch head. No auto-merge.

The [coordination board](../../operations/demo-delivery-coordination.md) records assignments, ownership, contract signatures, migration reservations, integration order and decision status. BYOK, Vercel website hosting, no domain purchase and a real public generated portfolio are included in RFC 0001 §0. Runtime, persistent services, private preview and public multi-user generation remain separate decisions. Selected scope is not proven acceptance.

## Repository reconciliation

Read-only investigation covered the dirty shared checkout, all nine registered worktrees, refs, remote master, open/merged PRs and the separate PR #7 reproduction repository. The shared checkout stayed at `e8947bb`; its implementation bytes under engine/runner/templates/tests/source-client matched `2c98c4f` exactly. No shared working files/index or superseded branches were reset, stashed, deleted or committed as Task 01 output.

| Branch / worktree | Observed commit | Disposition |
| --- | --- | --- |
| Shared `master` | `e8947bb` | Dirty; preserved read-only |
| `codex/forge-ai-local` | `412d9af` | Clean local provider work, already represented in later application history; preserved |
| `codex/forge-unified` | `beccc76` | Clean; PR #4 merged to master at `6a8095e`; preserved |
| `codex/e1-control-checkpoint` local publish worktree | `09c193a` | Clean local worktree; remote had advanced to `a71519b`; preserved |
| `codex/e2-e5-checkpoint` | `2c98c4f` | Clean complete source-flow checkpoint, selected merge parent |
| `codex/e2-e5-generation` | `5cafb61` | Untracked dependency/client copies, preserved; no reapplication |
| `codex/e2-e5-integration` | `2ada580` | Untracked dependency link, preserved; work composed in checkpoint |
| `codex/e2-e5-runtime` | `08cf216` | Modified migration and untracked dependency copies, preserved; no overwrite |
| `codex/e2-e5-validation` | `5c973fc` | Modified/untracked browser dependency files, preserved; no overwrite |
| Separate `/tmp/forge-ai-pr7-resolution` | `a71519b` | Clean, inspected supporting reproduction repository |

Remote PR #7 had already reconciled master with the earlier fixture checkpoint; its CI was passing. Task 01 merged `a71519b` with `2c98c4f`, preserving both histories/authors instead of cherry-picking composed worker commits again. PR #7 was subsequently merged externally at `42a376387835c2d7140b6c484c3517fe466714eb` (2026-09-10 03:45:32 UTC). Task 01 did not merge/close it. An ancestry-only merge `591f87c` records the new master; its tree is identical to `d4f7b50`. PR #7 is now a satisfied dependency and PR #8's diff is against the reconciled application.

The current Next.js application, Better Auth/Neon application choices, provider registry, PostgreSQL application schema and local Docker source/data workflow are retained. The stronger E1 durable/source contracts are the basis for the future hosted engine integration. The RFC service remains default-off, synthetic and separately authorized until Tasks 02–07 deliver real adapters. No IDs, sessions, jobs or queues are silently mapped between compositions. Docker-only execution does not satisfy the RFC microVM boundary.

## Conflict decisions and shared changes

Kept PR #7's Next.js package manifest/lock, current UI/server/worker, CI, strict checking, prototype stylesheet isolation and removed Vite entry points. Took the newer checkpoint's E1 source adoption under lease/state fences, migration 0003, immutable artifact/diff handling, TLS fix, complete review client, native HTTP/repair tests, candidate export/recovery and historical evidence. Preserved E0 contracts and engine SQL 0001–0003 exactly; application SQL 0001–0003 also remains unchanged. [Preservation record](../evidence/task-01/preservation.json).

Initial integrated typecheck exposed missing DOM iterable declarations and untyped `import.meta.env` in the retained historical design harness. Added `DOM.Iterable` to the standalone engine tsconfig, typed optional development metadata explicitly, and pointed the harness at the retained legacy stylesheet. Its development-only guard remains fail-closed. Type-only imports were reconciled with current lint rules. The old browser modules retain their tests but are **unrouted in Next.js**; Task 08 must adapt that UI through Task 01's reviewed API seam. No fixture identity endpoint was exposed.

Added `scripts/check-baseline-browser.py` to reproduce existing application migrations/browser checks in a clean clone. It rejects local environment files, uses an environment allowlist, starts fresh private-socket PostgreSQL and a loopback app server, applies application migrations twice, runs the existing browser suite and cleans owned resources in `finally`. It starts no generation worker or live provider. No new packages or migrations were needed for this task.

RFC/architecture/working-agreement/README updates explain canonical scope and boundaries. Migration numbers 0004–0007 in the engine namespace and 0004 in the application namespace are reserved allocations, not created or applied schema. No Task 02–09 implementation deliveries or contract sign-offs were available; none are fabricated.

## Reproduction

Use Node **24.20.0**, npm **11.11.0**, Python 3, native `initdb`, `postgres`, `pg_ctl`, `psql`, and the Chrome browser expected by the existing Playwright configuration on PATH. Native tests must run as a non-root user. Allow enough disk space for a fresh dependency install/build. Do not copy `.env.local`, databases, node_modules or prior build output into the reproduction clone.

```sh
git clone --branch codex/demo-delivery-baseline https://github.com/shellcat-com/forge-ai.git forge-baseline
cd forge-baseline
git checkout 591f87c7a2e9e8f8f18b356852e922f2d3c1bf19
npm ci
npm run verify
npm run test:db:control
npm run control:build
node dist-engine/control/index.js api
node dist-engine/control/index.js worker
FORGE_NATIVE_MIGRATION_TEST=1 npx vitest run tests/engine/validation-native.test.ts
python3 scripts/check-baseline-browser.py
node --experimental-strip-types engine/validation/acceptance-ledger.ts docs/reports/evidence/e2-e5/acceptance.json
```

Actual clean clone: `/tmp/forge-task01-clean-reproduction`. Node was selected by prepending the existing reviewed `/tmp/forge-e3-node24.UZHrx7/node-v24.20.0-darwin-arm64/bin` to PATH. The normal suite and standalone checks used native PostgreSQL **14.18**; this is control-schema compatibility, not D7 PostgreSQL 18 runtime acceptance. Browser tests regenerate screenshots under `docs/evidence`; reviewed copies below were retained and only this reproduction's generated modifications restored.

## Exact results and evidence layers

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| First integrated `npm ci` + `npm run verify` | PASS; lint, both strict TS checks, 590 passed / 4 optional skipped, Next.js build | [Initial verification](../evidence/task-01/integration-verify.log) |
| Clean GitHub clone `npm ci`, then `npm run verify` at `591f87c` | PASS; 47 test files passed, 2 wholly skipped; 590 passed / 4 optional skipped; production build | [Clean verification](../evidence/task-01/clean-verify.log); no symlinked dependencies or copied builds |
| `npm run test:db:control` in clean clone | PASS; 45 native constraint/RLS assertions | [Native log](../evidence/task-01/clean-native.log); disposable synthetic database |
| E1/native source/repair HTTP integration | PASS as part of 590-test suite | Actual local PostgreSQL/HTTP/worker fault tests, synthetic identity/provider/execution; not live generation |
| `npm run control:build`; API/worker without flags | PASS; both disabled before listener/database/work | [Build](../evidence/task-01/clean-control.log), [disabled outputs](../evidence/task-01/disabled.log) |
| Opt-in native migration drill | PASS; 1 test, zero skips | [Log](../evidence/task-01/native-migrations.log); fresh/prior synthetic schema and least-privilege behavior |
| Application migration + repeated migration + browser suite | PASS; both migrations verified; 24 browser tests passed / 15 gated skips | [Browser log](../evidence/task-01/browser.log); real local app/Chrome, synthetic local owner |
| Visual/keyboard | PASS within supporting scope | Inspected light/dark at 390/768/1440; no new clipping; keyboard skip-link/navigation/disclosure assertions passed |
| Zoom/reduced motion | PASS **simulation/emulation only** | Existing test uses CSS `zoom=2` and Playwright `emulateMedia`; [capture](../evidence/task-01/documentation-css-zoom-200.png). Native browser zoom and OS accessibility setting changes NOT RUN |
| Historical acceptance ledger | PASS validation of 16 artifact hashes; still not release-ready | [Summary](../evidence/task-01/historical-ledger-validation.json); historical E1 fixture evidence/A21 compatibility, 21 release gates blocked |
| Source/configuration whitespace + local report links | PASS | `git diff origin/master --check -- . ':!docs' ':!tests/harness/evidence'`; local Markdown file targets resolve |
| Secret/diff review | One intentional negative-test fixture, no real credentials identified | [Disposition](../evidence/task-01/secret-review.json); exact [contract hashes](../evidence/task-01/contract-signatures.json). Heuristics are not absolute proof |
| GitHub Linux CI | PASS on published `90d841a` and `d4f7b50` | [Run 34435258742](https://github.com/shellcat-com/forge-ai/actions/runs/34435258742); Node 24.20.0 lint/typecheck/tests/build/native control/standalone build. Final evidence-only head is checked separately in the PR |

Reviewed screenshots: [light 390](../evidence/task-01/home-light-390.png), [light 768](../evidence/task-01/home-light-768.png), [light 1440](../evidence/task-01/home-light-1440.png), [dark 390](../evidence/task-01/home-dark-390.png), [dark 768](../evidence/task-01/home-dark-768.png), [dark 1440](../evidence/task-01/home-dark-1440.png).

The default suite's four skips are the opt-in native migration, PostgreSQL 18 candidate, scaffold export and recovery drills. The migration drill was then run separately and passed; the other three were not rerun. Fifteen browser skips require imported workflow fixtures, live provider credentials or a generated Pomodoro target. They are not passes. Existing peer/deprecation/install-script warnings remain. The first clean install hit `ENOSPC`; after deleting only Task 01's disposable build/dependency outputs, clean installation and all reproduction checks passed. During that disk-pressure interval, the shared Git database also reported an unreadable Codex-internal ref on fetch; no internal refs were edited, and integration/reproduction continued from the independent GitHub clone.

Full-merge `git diff --check` reports historical raw-log whitespace/blank EOF and original RFC Markdown hard breaks. Those evidence bytes are preserved. The initial typecheck failure and failed disk-limited install are recorded here rather than presented as successful runs. No generated-source execution, privileged runtime installation, live model request, hosted login, paid infrastructure, Vercel deployment or private-preview browser access was tested.

## Remaining inputs and dependencies

Task 01's current deliverable is complete as a tested reviewable baseline; **live demo and private-alpha release remain blocked**. Tasks 02–09 must deliver their owned implementations/reports/PRs, following the coordination graph. No second team was created and no scheduler was started.

- 02/03: approved runtime access, host/KVM or explicitly amended managed service, exact image/toolchain and containment/cleanup evidence. Existing local Docker and platform scaffold tests do not close D2/D7.
- 04: exact entitled provider/model/endpoint, protected secret reference, dated prices/token limits and an explicit job/workspace/global live-test budget. BYOK grants no spending authority; no applicable paid budget is supplied.
- 05: real owner/test identities and provider configuration, plus reviewed application-to-engine subject/membership/session bridge and revocation proof.
- 06: durable worker location, actual PostgreSQL/object/KMS configuration, regions/retention/backup ownership and separate-target restore evidence. Vercel website selection does not supply these.
- 07: no-purchase private-preview hostnames/TLS/protection, atomic tickets, exact environment routing and real browser cookie/site/revocation evidence.
- 08: identified Vercel account/projects and available capacity, actual generated source with provenance and reviewed public content, then unauthenticated production-URL verification. No purchased domain.
- 09: independent A01–A22 and BYOK/demo acceptance, measured live corpus, named operations/alerts/release owners. Portfolio success cannot replace PostgreSQL task-board/restart/additive migration acceptance.

Public multi-user generation remains unapproved and unnecessary for the owner demonstration. Missing external access blocks those integrations, not this baseline. Public website hosting and a completed portfolio are not claimed by this PR. Preserve existing branches, review the draft, and do not auto-merge.

## Coordination follow-up

After baseline publication, all user-started Tasks 02–09 checked in. The current coordination board records their session IDs, isolated branches, scoped template/auth/corpus/provenance delegations and shared contract requests. Task 01 reviewed the initial preview SQL proposal and requested lock-order/revocation/native-race fixes before canonical migration publication. Accounting, real identity, versioned storage and image-bundle contracts remain proposals pending implementation evidence. This follow-up changes coordination documents only; no worker implementation or live gate is claimed complete.
