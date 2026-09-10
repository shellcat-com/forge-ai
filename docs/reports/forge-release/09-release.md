# Task 09 — Independent release verification and self-host readiness

**Demo-release sign-off: WITHHELD. Broader alpha readiness: BLOCKED.** Independent baseline regression and the reproducible keyless self-host guide are complete. Task 01 confirmed that no final release-staged commit containing the required production dependencies exists. None of the results below is final integration acceptance. Missing configuration is not the only blocker: live authority/composition, in-product publishing and lifecycle implementation remain unfinished.

## Identity, scope and dependencies

- Verified repository: `https://github.com/shellcat-com/forge-ai.git`.
- Branch: `codex/task-09-release-self-host`; draft PR base: `codex/demo-delivery-baseline`, which is Task 01 [PR #8](https://github.com/shellcat-com/forge-ai/pull/8) against `master`.
- Exact independent starting/tested baseline: `efa13a9de63457d0daccde1cc1cda645d332b6ff`; implementation: `88a5a39daeabe088a119f871166333975588c1b1`. No engine/UI/root dependency files changed in this task.
- Task 01 subsequently published documentation-only release coordination and RFC §0.1 at `2408d9f`; this does not rebind our baseline tests or supply missing production dependencies. The new scope requires connected public Forge and **separate authenticated in-product generated-app Publish/public URLs**, with rollback evidence. The availability page and a portfolio cannot substitute for Forge. No acceptance gate was relaxed.
- Existing Tasks 02–08 foundations and previous Task 09 audits were reused. No competing engine, new team, duplicate worker, shared-checkout mutation, paid call, service purchase or generated-code host execution occurred. Tests that write historical screenshot/evidence paths ran only in this isolated worktree; those files were copied to the owned evidence directory and restored unchanged.
- Owned deliverables: this report, [self-host guide](../../operations/forge-self-host-readiness.md), [names-only configuration inventory](../../examples/forge-release.env.names), and [evidence manifest](../evidence/forge-release/task-09/manifest.json). Task 01 owns shared coordination/documentation corrections; shared UI changes must go to its identified UI owner.

## Reproduction and observed results

Use the fresh checkout instructions in the guide. [Environment evidence](../evidence/forge-release/task-09/environment.json) records Node **24.20.0**, exact root npm **11.11.0**, PostgreSQL **14.18**, Python **3.14.6**, macOS arm64, 8 logical CPUs and 16 GiB RAM. A separate task-owned empty home and an allowlisted environment excluded developer keys, database URLs and npm configuration. Dependencies were installed afresh, not shared through symlinks. Initial registry downloads are a prerequisite; no provider request or worker service was started.

| Command / check | Status | Actual result and evidence |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | PASS | Fresh install using exact npm 11.11.0; peer/deprecation warnings retained in [install.txt](../evidence/forge-release/task-09/install.txt). No vulnerability-clearance claim. |
| `npm run verify` | PASS | Lint, both TypeScript builds, **794 passed / 5 skipped**, Next.js production build. [verify.txt](../evidence/forge-release/task-09/verify.txt). |
| `npm run test:db:control` | PASS | **45** native constraint/RLS checks; private socket, synthetic data, cluster cleanup. [native-control.txt](../evidence/forge-release/task-09/native-control.txt). |
| `npm run control:build`; `node dist-engine/control/index.js api`; `node dist-engine/control/index.js worker` | PASS | Trusted control compile; both default commands report disabled. No long-lived worker was launched. [Command results](../evidence/forge-release/task-09/commands.json). |
| `FORGE_NATIVE_MIGRATION_TEST=1 node_modules/.bin/vitest run tests/engine/validation-native.test.ts --maxWorkers=1` | PASS | **1** fresh/prior-seeded synthetic migration/privilege test. [native-migration.txt](../evidence/forge-release/task-09/native-migration.txt). |
| `FORGE_IDENTITY_BROWSER=true FORGE_IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node_modules/.bin/vitest run tests/engine/identity.native.test.ts --maxWorkers=1` | PASS | **11** native identity cases including browser CSRF/origin behavior; synthetic issuer/users. [identity-browser.txt](../evidence/forge-release/task-09/identity-browser.txt). |
| `node --import tsx tests/preview/browser.ts` | PASS | **21** actual Chromium/local TLS/native PostgreSQL checks, synthetic app/identity/runtime. Self-signed local TLS with verification bypass is explicitly not public TLS evidence. [Cases](../evidence/forge-release/task-09/preview-browser.json). |
| `node --import tsx tests/preview/identity-race.ts "$PWD/engine/control/identity-operator.ts"` | PASS | **2** operator revocation/consume/renew/retry scenarios bound to the operator hash. [Race record](../evidence/forge-release/task-09/preview-identity-race.json). |
| `python3 scripts/check-baseline-browser.py` | PASS | Fresh/repeated application migrations; **25 browser checks passed / 15 skipped**, synthetic local owner, no provider or generation worker. Cleanup confirmed. [baseline-browser.txt](../evidence/forge-release/task-09/baseline-browser.txt). |
| `python3 -m unittest discover -s tests/runner -p 'test_*.py'` | PASS | **21** trusted runtime/guest/image contract tests, no real microVM. [runtime-python.txt](../evidence/forge-release/task-09/runtime-python.txt). |
| Opt-in platform candidate export command below | PASS | **3** tests; hash-pinned platform source ZIP validation, clean extraction, offline install/lint/types/test/build, cleanup. [candidate-export.json](../evidence/forge-release/task-09/candidate-export.json). No generated app, app database or isolation acceptance. |
| `node scripts/publishing/check-public.mjs OUTPUT --url https://forge-ai-demo-omega.vercel.app` | PASS | **6** fresh cookie-free Chrome contexts, both themes at 390/768/1440, assets/navigation/keyboard, no backend requests. Availability page only. [Browser record](../evidence/forge-release/task-09/public-browser/browser.json). |
| Unauthenticated asset hash comparison | PASS | **34/34** files match on each of production alias and immutable deployment URL. [Public bytes](../evidence/forge-release/task-09/public-bytes.json). |
| Retained evidence and source inventory | PASS | **58/58** retained audit/coordinator artifact hashes; **351** source/config/test file hashes bound to the baseline. [Integrity record](../evidence/forge-release/task-09/baseline-integrity.json). Hashes verify bytes, not collector authenticity. |
| Names-only format, local links, owned diff and evidence secret scan | PASS | [Review record](../evidence/forge-release/task-09/review.json). No known credential found; heuristic scanning is not exhaustive privacy clearance. |

The original five unit skips were candidate export, PostgreSQL 18 candidate, candidate recovery, opt-in native migration and identity browser. Export, native migration and identity browser were subsequently run explicitly above. PostgreSQL 18 candidate/recovery were **NOT RUN in this campaign**; their historical Task 03/E3 evidence is not relabeled. The 15 browser skips require live provider/generated-app or explicitly imported older fixtures. No skipped test counts as passed.

The platform export harness uses the npm bundled alongside its reviewed Node archive, **11.19.0**, recorded by its `--version` command; it is distinct from the exact 11.11.0 root reproduction. It executes only the built-in hash-pinned platform scaffold. Prepare a new cache using the candidate's exact `package.json`/lock with `npm ci --ignore-scripts --no-audit --no-fund` in a disposable directory, then run:

```sh
FORGE_RUN_CANDIDATE_EXPORT=1 \
FORGE_CANDIDATE_NODE24=/absolute/path/to/reviewed/node24/bin/node \
FORGE_CANDIDATE_CACHE=/absolute/path/to/new/npm-cache \
FORGE_CANDIDATE_REPORT=/absolute/path/to/new/candidate-export.json \
node_modules/.bin/vitest run tests/engine/e3-candidate-export.test.ts --maxWorkers=1
```

Never substitute a downloaded/generated source archive into that host-side scaffold test. A genuine generated export must be exercised only in the approved isolated runtime. The clean Next.js build does not enable the release engine.

## Final gate checklist

Statuses describe the full release gate: **PASS** observed gate satisfied; **FAIL** an observed requirement violation; **BLOCKED** prerequisite absent; **NOT RUN** no current execution. Supporting fixtures/native tests do not override the full gate status. Every A gate remains blocked as final acceptance because the staged production target is absent. Historical A21 PASS and previous failures remain unchanged in their original ledger.

| Gate | Status | Supporting evidence / remaining requirement | Owner |
| --- | --- | --- | --- |
| A01 real task-board generation and restart persistence | BLOCKED | Source/HTTP fixtures pass in verify; real provider, runtime, CRUD and app-process restart absent | 01/02/03/04/08 |
| A02 additive priority change | BLOCKED | Native fresh/prior synthetic migrations pass; live generated diff/migration/UI absent | 03/04/08 |
| A03 immutable head and source restoration | BLOCKED | Native fixture head/restore tests pass; real failed execution, history and acknowledged preview-data reset absent | 01/02/06/08 |
| A04 generated source export | BLOCKED | Platform export passes; no real generated archive/isolated database install/build/run | 03/06/08 |
| A05 approval/digest/promotion/cancel | BLOCKED | Native exact-digest/stale/cancel races pass; real runtime/deployed authority absent | 01/02/05 |
| A06 two-user tenant isolation/revocation | BLOCKED | Native RLS/identity and local TLS preview cases pass; two real users and all deployed endpoints absent | 01/05/07 |
| A07 reload/disconnect/idempotency/SSE | BLOCKED | Native replay/revocation/idempotency passes; real owner browser and durable live worker absent | 01/08 |
| A08 crash recovery and unknown charges | BLOCKED | Native fixture crash/blob/adoption/settlement tests pass; real provider/runtime crash points and orphan cleanup absent | 01/02/04/06 |
| A09 stale worker/expired broker lease | BLOCKED | Epoch/watchdog contracts and preview fencing pass; real guest termination/quarantine absent | 02/07 |
| A10 cancellation and partitions | BLOCKED | Native fixture cancellation/teardown and browser route revocation pass; measured live compute cleanup absent | 01/02/07 |
| A11 provider failure modes | BLOCKED | Synthetic adapter auth/429/timeout/refusal/truncation/parser/redaction tests pass; exact live provider qualification absent | 04 |
| A12 adversarial source/archive/network inputs | BLOCKED | Validation and transport negatives pass; full corpus on approved runtime absent | 02/03/04 |
| A13 resource abuse/neighbor responsiveness | BLOCKED | Runtime/collector contract tests pass; real process/CPU/RAM/disk/hang campaign absent | 02 |
| A14 preview host/ticket/cookie/CSRF | BLOCKED | 21 local TLS/browser cases pass; actual ingress/runtime/TLS and deployed revocation absent | 01/05/07 |
| A15 external check spoof resistance | BLOCKED | Protected-source/check-origin negatives pass; actual isolated external checker absent | 02/03 |
| A16 repair/call/cost limits | BLOCKED | Native repaired review and synthetic caps pass; live accounting/stage integration absent | 01/02/04/08 |
| A17 parallel quotas/ambiguous charges | BLOCKED | Native fixture reservations/deduplication pass; production global dispatch and bounded real price policy absent | 01/04 |
| A18 expiry/deletion/backups/recovery | BLOCKED | Local encrypted-object/native restore tests pass; deployed PITR/retention/deletion and measured RPO/RTO absent | 02/06/07 |
| A19 generated app usability | BLOCKED | Existing platform/browser checks pass; actual generated preview CRUD/DB persistence and native settings absent | 02/03/08/09 |
| A20 load/fault/alerts/backpressure | BLOCKED | Bounded loopback documentation observation only; approved real infrastructure campaign absent | 01/02/06/09 |
| A21 existing Forge compatibility | BLOCKED | Current baseline verify and 25 browser checks pass; final staged target and skipped affected flows remain | 01/08/09 |
| A22 model/template release benchmark | BLOCKED | Offline corpus tests only; at least 30 live runs with full denominator and cost distribution absent | 03/04/09 |
| R01 connected public Forge | FAIL | Fresh public browser confirms availability page, no connected builder or sign-in | 01/UI owner/08 |
| R02 separate in-product Publish, public generated app and rollback | BLOCKED | Connector negatives pass; no live source/artifact/deployment receipt or connected Publish authority | 01/UI owner/08 |
| R03 genuine reproducible Task 08 recording | BLOCKED | Task 08 explicitly reports no live generated portfolio; no recording/source/job/runtime proof | 08/09 |
| R04 release-safe laptop onboarding | FAIL | `/app` helper says “Start npm run worker to enable generation.” It omits approved-runtime prerequisite; `/hosting` is truthful. [Screenshot](../evidence/forge-release/task-09/home-light-390.png) | 01 → shared UI owner |
| R05 existing license owner approval | BLOCKED | MIT unchanged; no explicit owner approval reference found or supplied | Maintainer |
| R06 dependency notices/distribution | BLOCKED | Four font notice byte matches; AGPL/LGPL/undeclared dependencies and historical media need usage/distribution review | 01/03/maintainer |
| R07 keyless self-host documentation | PASS | Fresh reproduction, guide, names-only inventory and truthful infrastructure boundaries delivered | 09 |
| R08 full engine self-host reproduction | BLOCKED | Real identity, canonical migrations, worker/storage/BYOK/runtime/gateway/publishing composition absent | 01–08 |
| R09 browser-native 200% zoom and OS reduced motion | NOT RUN | CSS zoom and media emulation only; no native-setting or generated-app pass claimed | UI owner/08/09 |
| R10 final exact staged commit sign-off | BLOCKED | Task 01 confirmed no qualifying staged release commit; independent baseline is not that target | 01/09 |

## Load, capacity and fault evidence

The existing bounded local regression envelope documented in `docs/operations/demo-readiness.md` is two clients, 20 loopback `/docs` GETs, 5-second request timeout, zero model/worker/cloud requests. This browser regression observed **20 HTTP 200 responses, zero errors, 45 ms total, p50 3.08 ms / p95 13.46 ms**. [All samples](../evidence/forge-release/task-09/task09-loopback-load.json). One browser worker ran on the shared 8-CPU/16-GiB Mac; dedicated CPU/RAM allocation and resource utilization were not measured. These are route timings, not generation throughput. No queue, provider, sandbox, alert delivery or production backpressure bottleneck was measured; those values are **null/unavailable**.

No new live load/fault campaign was run. Retain RFC §14's 100 authenticated sessions/10 active jobs/20 previews, 60-minute steady plus 10-minute twice-admission burst, unless the owner approves a recorded amendment. A modest exploratory envelope must also have explicit concurrency/resources/duration/total-cost approval; it cannot silently replace A20. Preserve API p95 ≤500 ms, event propagation ≤2 s, queue wait ≤30 s, generation ≤10 min, preview startup ≤60 s/30 samples, route cancellation ≤5 s and compute stop/quarantine ≤60 s, with complete failures and uncertainty. Actual bottlenecks and recovery require those systems and measurements.

A22 planned minimum is **30 live runs; attempted/admitted/dispatched here: 0**. Live latency/error/cost distributions are unavailable, not zero. Authorized new provider/infrastructure spend is $0; no billable call occurred. At least 90% complete-build quality within two repairs remains the original gate. No user-count, unlimited-model, completion percentage or production-scale claim is made.

## Deployment and open-source disposition

The public [Forge alias](https://forge-ai-demo-omega.vercel.app) and [immutable deployment](https://forge-ai-demo-kcmp4ynqr-biswas07.vercel.app) still match Task 08's **339fb8e44234cca9ec5cfe3590e62709458e40a4** static availability artifact, digest `9c32175e25d487270efc35b55864fc85e52cef2d47896c53b35f863d604d9098`. They are not deployments of the full tested Next.js application. The fresh browser used no cookies/bypass headers; no public backend calls or forms were present. There is no separate verified generated-app deployment to correlate. Task 08's retained receipt remains historical provenance; this campaign independently checked its public bytes and access, not the authenticated Vercel account metadata. No deployment was changed.

All six public theme/viewport cases passed automated layout/focus checks; all twelve retained public/local theme/viewport captures were visually inspected. No UI was changed. Native zoom/OS motion remain NOT RUN; CSS/media simulations are labeled as such.

[Notices inspection](../evidence/forge-release/task-09/notices.json) confirms MIT hash `e782f4b38a3cec40ba6029c8009fc7dc8d5fc5ba5b722ce5626415f4e80adfd5` unchanged, four font notices identical to installed licenses, and current lock declarations. `@triplit/client` and `ua-parser-js` declare AGPL variants; three Triplit packages have no lockfile license declaration; libvips variants declare LGPL. These observations require dependency-use/distribution review; they do not by themselves establish incompatibility. No license was changed. The requested owner approval reference remains missing.

The npm dry-run contained **802 entries** at the baseline plus the then-untracked guide/names-only additions; it excludes the root lockfile and includes historical evidence/media. [Exact inventory](../evidence/forge-release/task-09/package-inventory.json). This is a packaging observation, not the final PR archive or distribution approval. The previous positive allowlist remains stale and unapplied. Existing media rights/private metadata and nested archive review gaps remain; new normalized evidence does not rewrite or clear historical public files. The evidence scan before the manifest had zero findings. The final staged scan flagged one manifest SHA-256; it was verified against `disabled-api.txt` and classified as a hash false positive, with no credential identified. Scanning is heuristic, not proof against all leaks.

## Shared findings, handoff and remaining inputs

Task 01 accepted the stale self-host/provider-document findings, corrected shared docs in `9e07a0a`, and recorded the new scope/coordination in `2408d9f`. Those documentation-only updates were inspected independently while keeping this test baseline fixed. The local worker helper finding was sent for shared UI ownership; it remains unresolved at the tested baseline. No shared code was edited here.

The maintainer must provide an existing MIT approval reference and name the release/operations/alerts owners. Through approved access systems, provide real identity/client/test-user references, runtime/image/host configuration, database/object/KMS/backup/gateway/deployment references, exact provider entitlement/model/price/token limits and explicit numeric budgets. Use configuration/secret-reference names, never paste secrets in chat or PRs. Task 01 must first finish and freeze the required production composition; owners 02–08 must supply their live evidence. Task 09 can then repeat affected final integration and demo gates against that exact staged SHA, preserving this baseline evidence separately.

This task delivers a reviewed **draft PR**, not authorization to merge or release. No auto-merge, force-push, license change or public service enablement is requested.
