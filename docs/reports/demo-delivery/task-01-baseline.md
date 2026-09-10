# Task 01 — Canonical baseline

**Current source handoff:** `88a5a39daeabe088a119f871166333975588c1b1`, branch `codex/demo-delivery-baseline`, [draft PR #8](https://github.com/shellcat-com/forge-ai/pull/8), base `master`. All Task02–08 reviewed foundations and Task09 harness are integrated with original authorship. Earlier baseline-only results below remain historical. Final combined clean reproduction and independent audit are recorded in the final section; live acceptance remains blocked.


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

The documentation-only coordination head `fe2deec03d9d5981754af84f4a5bfb6faecaaf9e` passed [Linux CI run 34436744450](https://github.com/shellcat-com/forge-ai/actions/runs/34436744450). Follow-up review corrected a proposed image/template hash cycle before implementation and identified an identity-operator/preview lock-order inversion for native concurrency validation. The board records these findings, the bounded provenance/preparation-script delegation and shared-dependency freeze. Worker-reported tests have not been substituted for Task 01's combined clean reproduction; no implementation delivery is integrated at this point.

## Early Task 09 harness integration

Task 09's independently reviewable acceptance tooling was integrated ahead of its final audit, as allowed by the dependency graph's harness-preparation path. Source commits `2437ec323a824658bbb6dee77bf5a2807e0184e3` and `4fa7dc2ea573564441fc305929ad72a916bdc189` from [PR #10](https://github.com/shellcat-com/forge-ai/pull/10) are preserved as ancestors of merge `d3244f7a300bba5d0351b36261b16d24d3474592`; ancestry and `git log --cherry-pick --right-only` showed two distinct new commits before integration. No cherry-pick or author rewrite occurred.

Local integration checks: `vitest run tests/engine/delivery-evidence.test.ts --maxWorkers=1` passed **13/13** using frozen baseline dependencies. A Python SHA-256 comparison verified **21 artifact hashes, 304 source hashes and the canonical source-inventory digest**. `git diff --cached --check` passed. Gitleaks on all added files reported two reviewed false positives in the acceptance report: a known baseline commit passed to `--log-opts`, and ordinary prose “signed/private”. No credential was identified; these are heuristic checks. README's reviewed bounded change uses `npm ci` and links the now-committed readiness guide. Task 09's own full/native/browser results and exact npm-version deviation remain in its report; they are not Task 01 combined reproduction.

Final implementation integration, clean combined checks and Task 09's final independent audit remain pending. No live evidence or acceptance gate is promoted by merging this reporting helper.

## Identity foundation integration

Task 05 source `c4236ba025fa53583db71b1c1e1b4c87de552664` ([PR #11](https://github.com/shellcat-com/forge-ai/pull/11)) is preserved in merge `417874d7174530d06ac42ceed733ecc6d9aedbb6`. Final source CI passed on Node 24.20.0: [run 34437628422](https://github.com/shellcat-com/forge-ai/actions/runs/34437628422). Local review verified all **15 source/evidence hashes**, then `vitest run tests/engine/oidc-identity.test.ts tests/engine/delivery-evidence.test.ts --maxWorkers=1` passed **38/38**. Diff whitespace checks passed. Added-file Gitleaks findings were three verified SHA-256 manifest values for the Better Auth proposal/schema/license, not credentials. Task 05's own native/browser and pre-fix full results remain explicitly classified in its report; current native combined reproduction is pending the shared test lock and completed implementation composition.

This integrates the OIDC adapter, bounded bootstrap/callback changes, owner credential-authorization transaction and reviewed NOWAIT operator retry foundation. The existing explicit fixture startup remains; no live issuer, privileged operator role, provider plugin, shared schema migration or public route is enabled. Better Auth lifecycle hooks and shared application/control composition remain dependencies.

Task 09 follow-up `10e19622b7e497f355d56be03b0e3e6df405c227` is preserved in `b6e268f4bd4487b32c046e9e9d60805f443d3aa1`. Its **23 artifact hashes** match; it records CI and independent reachability of Task 08's public availability page, explicitly not a generated portfolio. The historical source inventory is not relabeled as current. Pushing an authored merge into a worker PR's base causes GitHub to mark that source PR merged automatically; no PR merge/close command was used and `master` was not changed. Task 01 PR #8 remains draft.

## Template, BYOK and persistence foundation integration

Authored-history merges preserve Task03 `b3fb6f6` in `b40486b`, Task04 `fce0a18`/`641ad33` in `6c36784`, Task06 `aa1a8c1` in `ae0db48`, and their evidence follow-ups in `ab9fa7b`/`7b80108`. Task05 root-issuer fix `c20f3ae` is preserved in `46ff21c`; Task09 final handoff observations through `f36e9c8` are in `b6f8dfb`. Source PRs are #13, #15, #12, #11 and #10 respectively; no duplicate cherry-picks.

Focused local commands/results under verified Node24.20.0 and frozen dependencies:

- `vitest run tests/engine/template-toolchain.test.ts tests/engine/e3-release.test.ts --maxWorkers=1`: **19 passed**; `python3 -m unittest discover -s templates/next-postgres-v1/toolchain -p 'test_*.py'`: **5 passed**. Verified26 retained artifact/24 source hashes. Seven added-file Gitleaks findings were verified public npm verification keys or SHA-256 metadata, not secrets. Raw task03 log whitespace remains hash-bound and is the documented exception to full diff whitespace checking; source/config diff check passed.
- `vitest run tests/engine/byok.test.ts tests/engine/byok-transport.test.ts tests/engine/e2-generation.test.ts --maxWorkers=1`: **99 passed**. Verified15 source/final6 evidence hashes. Two scanner hits are the verified credential-module source hashes. Reviewed atomic per-call terms/settlement, destination pinning, transactional credential CAS and preservation of legacy E1 attempt uniqueness.
- `vitest run tests/engine/encrypted-objects.test.ts tests/engine/persistence-config.test.ts --maxWorkers=1`: **5 passed**. Verified17 initial and18 final source/evidence entries; added-file scanner found no leaks. Storage proposal preserves encrypted immutable identities and serialized adoption/retirement; hosted service, recovery and root0006 composition remain open.
- Root-issuer follow-up: **26 OIDC tests passed**,17 updated hashes verified. Task09 follow-up: **25 retained artifact hashes** verified without relabeling its historical source inventory.

Source CI passed: [03](https://github.com/shellcat-com/forge-ai/actions/runs/34437962419), [04](https://github.com/shellcat-com/forge-ai/actions/runs/34438040481), [05](https://github.com/shellcat-com/forge-ai/actions/runs/34437879134), [06](https://github.com/shellcat-com/forge-ai/actions/runs/34438059505). These PR merge-context counts include the advancing base and are not exclusive worker denominators. This stage still requires final combined clean verification. No root manifest/lock, canonical SQL migration or hosted configuration is changed/enabled by these merges.

Task02 review found privileged jail-directory path validation and guest expired-RPC handling gaps; the runtime owner is correcting them before integration. Task07/08 stable source/evidence deliveries remain next in dependency order.

## Runtime, preview and publication integration

Final authored-history merges: Task02 `f276d540ee111a47e0ab6ee8147b43caab914445` in `27191e8`, Task07 `edcd3c16bac857ea5c1cd40fdf8fbeba75f11c43` in `b2a3493`, Task08 `7bcc738a65fe6e54150ba0738196b57801d044e4` in `4dacd02`. Every worker source commit is an ancestor; no cherry-pick, author rewrite, branch deletion or merge to master occurred.

Task02 review found privileged jail-ancestor/symlink handling and expired guest RPC gaps. The owner fixed these in `b7d39d0` before integration. Verified17 source/7 evidence hashes; `vitest run tests/engine/task02-runtime.test.ts tests/engine/e3-runtime.test.ts --maxWorkers=1` passed27, Python runner discovery passed21 simulations; added-files Gitleaks found no leak. Real Linux/KVM confinement/image execution remains untested.

Task07 verified15 source/9 evidence hashes; `vitest run tests/engine/preview-host.test.ts tests/engine/preview-hostnames.test.ts tests/engine/preview-policy.test.ts --maxWorkers=1` passed15; added-files Gitleaks clear. The reviewed gateway remains unmounted and0007 is a proposal. Task08 verified20 retained hashes/lengths; `vitest run tests/engine/publishing.test.ts --maxWorkers=1` passed28; added-files Gitleaks clear. All artwork bytes are unchanged by the bounded public provenance edit. I inspected the retained light390/dark1440 screenshots; the page has clear availability limitations and no invented successful generation.

Task08's actual Vercel website and unauthenticated static-byte/browser observations are live **website-only** evidence. No real generated portfolio, billable model request, hosted control deployment or private preview was performed by Task01. The [coordination board](../../operations/demo-delivery-coordination.md#current-combined-handoff--supersedes-earlier-pending-delivery-observations) allocates the remaining root schema/auth/accounting/source/adoption/preview integration separately from external access and live acceptance. No root package/lock or canonical migration was enabled by these merges.

## Combined clean reproduction at 4dacd02

Fresh GitHub clone `/tmp/forge-task01-final-reproduction`, detached at `4dacd0255e4a04648424eb0b0044c6658b46a014`. Used exact Node24.20.0 and npm11.11.0 via `/tmp/forge-task01-final-toolchain` (Node archive plus existing npm11.11 CLI), independent real `node_modules`, no copied build or environment files. `npm ci` installed496 packages and reported zero known audit vulnerabilities, with existing peer/deprecation warnings. This is separate from worker shared-dependency evidence. [Environment](../evidence/task-01/combined/environment.json), [exact command results](../evidence/task-01/combined/results.json), [source bindings](../evidence/task-01/combined/combined-contracts.json).

| Command / check | Result | Evidence boundary |
| --- | --- | --- |
| `npm ci`; `npm run verify` | PASS; lint, strict app/engine TS, **794 passed / 5 optional skipped**, production Next build | [Install](../evidence/task-01/combined/npm-ci.log), [verify](../evidence/task-01/combined/verify.log); native synthetic identity/BYOK/storage/preview and retained E1/source regressions included |
| `npm run test:db:control`; `npm run control:build` | PASS45 native constraints; standalone build | [SQL](../evidence/task-01/combined/native-control.log), [build](../evidence/task-01/combined/control-build.log) |
| API and worker without flags | Both exit0 disabled before service/work | [API](../evidence/task-01/combined/disabled-api.log), [worker](../evidence/task-01/combined/disabled-worker.log) |
| `FORGE_NATIVE_MIGRATION_TEST=1 npx vitest run tests/engine/validation-native.test.ts --maxWorkers=1` | PASS1, no skips | [Migration](../evidence/task-01/combined/native-migration.log); disposable PostgreSQL14.18 |
| `FORGE_IDENTITY_BROWSER=true FORGE_IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx vitest run tests/engine/identity.native.test.ts --maxWorkers=1` | PASS11, no skips | [Identity](../evidence/task-01/combined/identity-browser.log); native DB/local TLS/actual Chrome, synthetic issuer/users |
| `npx tsc -p tests/preview/tsconfig.json`; `node --import tsx tests/preview/browser.ts` | PASS;21 browser assertions | [Browser](../evidence/task-01/combined/preview-browser.json); actual Chrome/local TLS/DB, fixture app/runtime and local routing |
| `node --import tsx tests/preview/identity-race.ts /absolute/clone/engine/control/identity-operator.ts` | PASS2 native concurrency cases against final operator | [Races](../evidence/task-01/combined/preview-identity-race.json); binds operator hash6e6c0612, revocation and exhausted-retry rollback |
| `python3 scripts/check-baseline-browser.py` | Fresh + repeat application migrations; **25 browser passes / 15 gated skips** | [Browser log](../evidence/task-01/combined/baseline-browser.log); loopback app, synthetic local owner; no provider/worker launched |
| Python unittest discovery in `tests/runner` and template `toolchain` | PASS21 +5 | [Runtime](../evidence/task-01/combined/runtime-python.log), [template](../evidence/task-01/combined/template-python.log); simulations/trusted packaging units, not KVM execution |
| `node --import tsx scripts/publishing/prepare-frontend.tsx NEW_STAGE`; `node scripts/publishing/check-public.mjs EVIDENCE --stage NEW_STAGE` | PASS34 static files and6 browser cases | [Prepare](../evidence/task-01/combined/publisher-prepare.log), [browser](../evidence/task-01/combined/hosting-local/browser.json); platform-authored availability page, not generated source |
| `node scripts/publishing/check-public.mjs EVIDENCE --url https://forge-ai-demo-omega.vercel.app` | PASS6 fresh anonymous browser cases | [Public browser](../evidence/task-01/combined/hosting-public/browser.json); live website only, no publish/write/bypass credentials used |
| GitHub CI at exact4dacd02 | PASS | [Run34439062868](https://github.com/shellcat-com/forge-ai/actions/runs/34439062868), [captured status](../evidence/task-01/combined/ci-source.json); separate Linux fresh installation/native/build |

All native checks ran under the acquired exclusive test lock and cleaned owned services/clusters. Regenerated worker07 browser/race JSON and application screenshots were copied into new Task01 evidence and restored **only in this clean reproduction**, preserving historical worker manifests. The clone was clean afterward. New logs remove ANSI terminal codes, CR progress and trailing whitespace; original raw logs remain in the temporary evidence directory. New [ancestry validation](../evidence/task-01/combined/ancestry.json) proves both competing original sources and every delivered worker head are preserved.

Default suite skips are the opt-in identity browser, native migration, PostgreSQL18 candidate, platform-scaffold export and candidate recovery. Identity/migration were explicitly run afterward; the latter three were **not rerun by Task01**. Task03's native18/offline platform-scaffold evidence and Task06's local separate-database recovery remain supporting evidence, never real guest or separate-host backup acceptance. Fifteen application browser skips still require workflow fixtures/live providers/generated targets.

The new canonical Next `/hosting` review initially failed **CSS zoom2 at390** because the shared body minimum width expands beyond the viewport. [Initial failure](../evidence/task-01/combined/hosting-canonical-initial-failure.log) is retained. The independently built static fallback and actual Vercel page passed all6 light/dark390/768/1440 cases; I visually inspected all6 local fallback captures. This triggered a scoped Task08 fix; the final delta and repeat verification are recorded below. CSS zoom and reduced-motion media are simulations/emulations; native browser zoom and OS motion settings remain NOT RUN.

Combined Gitleaks review scanned current contents of356 added/modified files versus master42a3763 and found15 reviewed matches: source/evidence SHA-256 values, public npm verification keys and report prose/Git arguments. [Dispositions](../evidence/task-01/combined/secret-review.json). No real credential was identified; this is not exhaustive proof. Historical raw-log whitespace is retained; source/config whitespace checks exclude hash-bound evidence logs. No root package/lock or existing canonical SQL was changed by the worker integrations.

## Final source and reflow verification

Final source **`88a5a39daeabe088a119f871166333975588c1b1`** preserves Task08 fix`595f560009d2a1f1ea697b89cbe00a3eb355562e` via authored merge. The only source delta from4dacd02 is5 scoped hosting CSS lines. `body:has(> .hosted-site)` removes the app body's minimum width solely for this standalone page. Ordinary `/` and `/docs` retain320px even when that stylesheet is loaded; [owner's negative controls](../evidence/task-01/final-delta/task08-reflow-negative-controls.json) are separate from Task01's rerun. No token, application schema/manifest, engine code or actual Vercel deployment changed.

Fetched88a5a39 from verified GitHub origin into the existing fresh reproduction clone, detached checkout, removed only its own `.next` and rebuilt with the unchanged independently installed Node24.20/npm11.11 dependency tree. **`npm run verify` again passes794 tests /5 optional skips and production build.** The migration/application browser harness again passes25 tests /15 gated skips. New canonical Next `/hosting` checks pass all6 light/dark390/768/1440 cases, keyboard skip-link/navigation, no overflow/errors, CSS200%zoom simulation and reduced-motion media emulation. I visually inspected all6 final canonical screenshots. Native browser zoom and OS accessibility controls remain untested.

Exact [results](../evidence/task-01/final-delta/results.json), [verify log](../evidence/task-01/final-delta/verify.log), [browser log](../evidence/task-01/final-delta/baseline-browser.log), [canonical cases](../evidence/task-01/final-delta/hosting-canonical/results.json), [invoked harness text](../evidence/task-01/final-delta/hosting-harness.mjs.txt), [environment](../evidence/task-01/final-delta/environment.json), [initial manifest](../evidence/task-01/combined/manifest.json) and [final-delta manifest](../evidence/task-01/final-delta/manifest.json) retain source bindings and hashes. Original failed canonical zoom evidence and earlier worker evidence are untouched. Only this reproduction's regenerated application screenshots were restored afterward; checkout is clean.

For final reproduction use the commands above with `git checkout 88a5a39daeabe088a119f871166333975588c1b1`. The hosted page is available at local `/hosting` after `npm run build` / `npm start`; the retained browser harness identifies the exact local launch and checks. No additional unchanged native protocol suite reruns were needed beyond native tests already included in the final794-test verification.
