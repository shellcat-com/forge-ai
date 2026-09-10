# Task 09 — Independent acceptance and demo readiness

Status: **independent validation code/tests and baseline audit complete; final integrated acceptance, first live demonstration, private alpha and production readiness remain blocked.** This was published as a draft validation PR, not release sign-off; its later feature-branch integration is recorded below. No live provider call, generated-code host execution, public deployment, purchase or domain change occurred.

## Scope and identities

Worker branch: `codex/task-09-acceptance`; PR base: `codex/demo-delivery-baseline` (Task 01 [draft PR #8](https://github.com/shellcat-com/forge-ai/pull/8), whose base is `master`). The isolated worktree was created at published canonical `881e9ac2b11f8f168cb7849b77c4ee7439e55458`, then fast-forwarded to Task 01's published metadata/evidence head `e533afe7ffce770d9e1326874956139ea55deb75`. Its implementation is Task 01's tested `591f87c7a2e9e8f8f18b356852e922f2d3c1bf19`. The shared Documents checkout and other tasks' code were not changed.

Task 01 had no final integrated Tasks 02–08 commit to supply during this audit. Accordingly this report audits that **baseline plus Task 09's scoped additions**, not hypothetical future fixes. Tasks 02–08 remain implementation/integration dependencies; their new deliverables have not been imported or certified here. Task 08 separately reported no live portfolio artifact. No user access or budget was inferred from installed tools or BYOK direction.

The [source inventory](../evidence/task-09/source-inventory.json) binds 304 implementation/configuration/test files with per-file SHA-256 and an aggregate source digest. It excludes historical evidence directories and uses the stated stable JSON encoding. [Evidence manifest](../evidence/task-09/manifest.json) records the audited source commit, tool versions, artifact hashes and absent release identities. Source code hashes and template candidate file hashes are not a released source manifest, signed Linux image or authenticated execution receipt. Live source/template/policy/runtime/deployment identities remain null until actual approved collectors supply them.

Read: current AGENTS.md, RFC 0001 (including Task 01's scope amendment), E0/E1 reports, E2–E5 checkpoint/validation/readiness/decision reports, current coordination board, application/provider/runtime/validation code, README/setup/contributing/license and public evidence inventories. Required Next.js + strict TypeScript + PostgreSQL work is preserved. No application, runtime, identity, provider, shared manifest, migration, README or existing license implementation was modified.

## Owned changes

- `engine/validation/delivery-evidence.ts`: independent strict reporting envelope for canonical commit/source/template/policy/runtime/deployment equality, local artifact byte hashes and path confinement. Retains failed attempts even when stale. Rejects duplicate attempts, absent live runtime identities, CSS/media simulations as native controls and signed-in-only portfolio observations. Hashes and self-declared origins never authenticate producers: `provenanceVerified`, `dispatchAuthorized` and `releaseReady` remain false. Trusted receipts and complete RFC acceptance remain separate.
- `tests/engine/delivery-evidence.test.ts`: **13 passing synthetic tests**, including all six stale identity fields, fixture/scaffold exclusion, uncertain provenance, native-control simulation, anonymous/deployment binding, failure retention, duplicate attempts, tampered/missing artifacts and symlink/traversal escapes. Test records labeled live are intentionally fake inputs, never release evidence.
- `tests/browser/demo-readiness.spec.ts`: a bounded loopback-only public documentation request test, 20 requests at concurrency 2, no provider endpoint or worker, with all request results/latencies retained. This is not the A20 campaign.
- [Demo-readiness guide](../../operations/demo-readiness.md): clean setup, provider matrix, BYOK security/limits, Vercel boundaries, owner workflow, generated-export reproduction prerequisites, campaign envelope, contribution and public-distribution guidance. README edits and the package allowlist are proposals routed through Task 01.

## Reproduction and results

Use the exact source commit in the evidence manifest in a clean clone, with no `.env` or `.env.local`. This run used macOS arm64, Node **24.20.0**, npm **11.19.0** bundled in the reviewed Node archive, and native PostgreSQL **14.18**. The root manifest declares npm 11.11.0; that precise npm version was not reproduced here. Task 03 separately owns pinned generated-template release acceptance. No shared node_modules symlink was used: this worktree ran its own `npm ci` before the coordinator's disk-space notice.

| Exact command | Result and evidence |
| --- | --- |
| `npm ci` | PASS, 494 packages installed, zero known advisories reported at retrieval; existing peer/deprecation/install-script warnings retained in [install.txt](../evidence/task-09/install.txt). This is not license or vulnerability clearance. |
| `npm run verify` | PASS lint, application and engine strict TypeScript, **603 passed / 4 skipped**, Next.js production build; [verify.txt](../evidence/task-09/verify.txt). Earlier 602-test pass retained separately as [verify-initial.txt](../evidence/task-09/verify-initial.txt). |
| `npm run test:db:control` | PASS **45 native PostgreSQL constraints/RLS assertions**, disposable private-socket cluster, synthetic rows, cleanup; [native-control.txt](../evidence/task-09/native-control.txt). |
| `FORGE_NATIVE_MIGRATION_TEST=1 npx vitest run tests/engine/validation-native.test.ts` | PASS **1 native synthetic migration/privilege drill**, fresh/prior-seeded schema and cleanup; [native-migrations.txt](../evidence/task-09/native-migrations.txt). |
| `npm run control:build` | PASS standalone control compile; [control-build.txt](../evidence/task-09/control-build.txt). |
| `python3 scripts/check-baseline-browser.py` | PASS **25 / 15 skipped**, fresh and repeated application migrations, synthetic local owner, no provider/worker. [browser.txt](../evidence/task-09/browser.txt). Six existing-app theme/viewport captures retained under this task; historical screenshot paths restored unchanged after the harness. |
| `node --experimental-strip-types engine/validation/acceptance-ledger.ts docs/reports/evidence/e2-e5/acceptance.json` | PASS verification of **16 historical artifact hashes**; original ledger still reports A21 passed/21 blocked and E1 fixture-verified. [historical-ledger.json](../evidence/task-09/historical-ledger.json). This does not promote historical evidence to the current integration. |
| `npm pack --dry-run --ignore-scripts --json` | Audited inventory only, no publication. Existing package: **579 entries, 27,071,548 compressed bytes**, includes historical/research evidence. Staged positive-allowlist proposal: **266 entries**, excludes the listed sensitive/unnecessary categories; root lockfile excluded by npm. [package-proposal.json](../evidence/task-09/package-proposal.json). |
| `gitleaks git --redact=100 --no-banner --report-format json --report-path /tmp/forge-task09-history-secrets.json --log-opts=e533afe7ffce770d9e1326874956139ea55deb75` | Scanned baseline ancestry (27 reachable commits); 3 findings, reviewed as one SHA-256 false positive plus the same intentional scanner fixture in two commits. No real credential identified. Raw scanner output is not published. [Public audit summary](../evidence/task-09/public-audit.json). |

The first browser launch happened before the final build produced its standalone output. The harness refused its missing build prerequisite; [browser-prerequisite-failure.txt](../evidence/task-09/browser-prerequisite-failure.txt) retains this failed attempt. A separate keyless local start also failed with `MODULE_NOT_FOUND` for that absent standalone entry, then succeeded after build completion. These are orchestration/prerequisite failures, not discarded successful browser samples. The subsequent complete browser run passed and cleaned up its temporary server/database.

Four optional unit-suite cases remain unrun: platform scaffold clean export, candidate PostgreSQL 18 check, candidate recovery and the default opt-in native migration case (the latter subsequently ran explicitly above). Fifteen browser cases require real local project/provider/generated-app or explicitly imported historical integration fixtures; they remain skipped. No new candidate export/recovery or generated app was run. Historical candidate clean export/recovery evidence remains supporting evidence only.

## A01–A22 disposition at this audit

Every row below remains **blocked as final integrated acceptance**. Supporting checks are identified separately; they cannot fill missing live runtime/access evidence. The old checkpoint A21 pass remains preserved; current baseline compatibility support passes, but the final integrated commit and complete affected legacy import/sample/export browser flow have not been audited here.

| ID | Supporting evidence inspected/reproduced | Exact remaining gate / owner |
| --- | --- | --- |
| A01 | Structured source/control HTTP fixtures | Real provider task-board generation, approval, isolated checks, PostgreSQL CRUD and app-process restart; 02/03/04/08. |
| A02 | Native fresh/prior synthetic migration checks, source-diff tests | Generated priority edit, exact approved diff, live migration and browser regression; 03/04/08. |
| A03 | Native fixture head/restore-history and acknowledgment tests | Real failed execution preserves head, restored source and acknowledged preview-data reset; 01/02/06/08. |
| A04 | Secret-scanned immutable export/ZIP tests; historical scaffold export only | New generated archive in clean approved runtime, lock install/migrate/build/run, license/secret/internal-artifact exclusion; 03/06/08. |
| A05 | Native stale review, cancel/promotion and exact-digest tests | Exact real runtime approved bytes, deployed authorization and races; 01/02/05. |
| A06 | Native two-tenant/RLS/SSE revocation fixtures | Real identities and every deployed file/event/export/preview endpoint, target revocation timing; 01/05/07. |
| A07 | Native idempotency and SSE replay/disconnect tests | Actual owner browser reload/disconnect with durable live worker; 01/08. |
| A08 | Native crash/retry/uncertain-charge and fixture broker faults | All five real crash points across provider/blob/DB/runtime/ack, no double settlement or orphans; 01/02/04/06. |
| A09 | Lease/epoch, authenticated transport and watchdog contract tests | Real expired lease/partition stops or quarantines guest and stale upstream; 02/07. |
| A10 | Every-state native fixture cancellation and partitioned teardown | Real route revocation, fenced commands, measured resource baseline/quarantine; 01/02/07. |
| A11 | Auth/429/timeout/refusal/malformed/truncated adapter tests | Qualified exact live provider behavior, redaction, no partial execution, uncertain liability; 04. |
| A12 | Adversarial path/archive/SQL/package/check-spoof validation | Full corpus inside approved isolated runtime, no control access/network expansion; 02/03/04. |
| A13 | Resource/collector/host contract fakes | Actual CPU/RAM/disk/process/hang abuse, neighbor responsiveness, bounded logs and cleanup; 02. |
| A14 | Preview policy helpers and signed boundary tests | Live atomic gateway/ticket/cookie/session/CSRF/revocation and never-reused host; 01/05/07. |
| A15 | Protected template/check-origin/hash negatives | Real external checks reject spoofed stdout/assertion deletion; 02/03. |
| A16 | Native fixture repaired source/review and limit tests | Each live changed manifest reapproved, ≤2 repairs/12 calls, durable spend cap; 01/02/04/08. |
| A17 | Native reservation races, deduplicated fixture ledgers | Integrated per-call accounting with real bounded model price/token/unknown-charge behavior; 01/04. |
| A18 | Local synthetic recovery evaluators; prior scaffold drill | Deployed control DB/object-version backup recovery/PITR and measured RPO/RTO, deletion/expiry cleanup; 02/06/07. |
| A19 | Current application responsive/keyboard browser suite | Actual generated Next.js preview, keyboard CRUD, native 200% zoom/OS reduced motion and PostgreSQL persistence; 02/03/08/09. |
| A20 | 20 loopback page requests with full retained outcomes | Budgeted real steady/burst/fault campaign, hardware and caps, target measurements; 01/02/06/09. |
| A21 | Current npm verification, application browser/native support | Final integrated commit plus complete affected compatibility/import/sample/export browser evidence; 01/08/09. |
| A22 | Frozen corpus and offline evaluator/negative tests | ≥30 live runs, all attempts, ≥90% build target, exact model/template/runtime/price, latency/cost distribution; 03/04/09. |

## New requirements and measured limits

**Live corpus:** planned required minimum 30; attempted **0**, dispatched **0**, measured costs **0 samples**, latency **0 samples**, failures **0 live attempts**, unknown charges **0 initiated calls**. p50/p95 latency and cost distributions are **null/unavailable**, not zero. Authorized new provider and infrastructure spend is **$0**; actual new billable runs were zero. No account keys were inspected or used.

**Local load envelope:** two loopback request clients, 20 public `/docs` requests, 5-second per-request timeout, no model/worker/cloud traffic. All **20 returned HTTP 200**, no dropped failures, 62ms observed campaign time, p50 **4.18ms**, p95 **17.47ms**. [All samples](../evidence/task-09/loopback-load.json). This measures a warm local documentation route while other tasks were using the same Mac; CPU/RAM isolation and production capacity were not measured. It proves no concurrent-build capacity and does not pass A20.

**Owner/public portfolio:** Task 08 reported no live generated portfolio/source/runtime artifact. At the baseline audit no published URL was supplied. The later public availability-page check below supersedes that reachability gap only. Neither signed-in Vercel access nor a website build would satisfy this gate. New generated-app clean setup/export reproduction remains blocked. The public deployment must bind immutable deployment identity and generated source, with a separate cookie-free browser visit requiring neither Forge nor Vercel login.

**Native settings:** Chrome browser-extension control was unavailable. A dedicated local documentation tab was readable through the Brave connector, but native app control showed the user's other active browser window and was interrupted by user activity before any zoom or OS setting was changed. Actual 200% browser zoom and OS reduced-motion activation remain **NOT RUN**. Existing browser tests use CSS zoom/media emulation. No native-setting pass, generated-preview pass or screenshot of private user browsing is published.

**BYOK and Vercel:** user direction is accepted; deployed qualification is open. The current application provider registry is distinct from the RFC fixture service. No arbitrary provider capability, encrypted hosted key store, spend authorization, persistent worker, isolated execution or private preview is inferred from Vercel hosting. See the guide's provider matrix and official Vercel references. No domain purchase is needed for the intended platform URL; the actual protected/public URLs still require validation.

## Open-source, package and asset audit

Preserved the exact existing **MIT LICENSE**. Font license files exist for IBM Plex Mono, Instrument Serif, Inter and Press Start 2P. The candidate dependency license inventory is declarations, not completed compatibility review; Task 03 owns updated dependency provenance/release qualification.

The current tracked-text audit found personal local-path metadata in **43 files**, account-resource metadata in **2 docs**, and provider account-scoped artwork URLs in **4 sources**. These observations do not imply compromised credentials. Existing public logs contain local installation paths; screenshots/videos and nested archives were not exhaustively reviewed frame by frame. Raw secrets, signed/private URL exposure and permission to redistribute artwork are not established by account IDs alone. No blanket privacy or license clearance is claimed.

[Archive inventory](../evidence/task-09/archive-review.json) binds the two ZIPs: one local checkpoint screenshot/log package and one competitor research screenshot/video package. Neither embeds a license/notice. The research source notes say it was captured from logged-in competitor sessions and its video is a reconstructed walkthrough, not original generation recording. Recommend excluding these artifacts from runtime/export packages and obtaining a reviewed public-tree disposition. Existing source branches/history and hash-bound failures must be preserved rather than silently rewritten.

The root package is `private:true`; no npm upload occurred. The staged positive-allowlist proposal removes evidence/research archives, real environment files, runtime data/private directories and account metadata from the package inventory, preserving runtime/configuration/migration code and README/LICENSE/example config. It is **not applied**: Task 01 owns the root manifest. npm excludes the root package-lock from its tarball, so this proposed package cannot be advertised as a clean `npm ci` source export. Full verification also depends on tests/historical evidence omitted from a runtime-only archive. Use a reviewed Git checkout/lock-bearing source ZIP until that distribution contract is explicitly resolved. Package exclusions do not sanitize public Git history.

## Findings routed and acceptance still needed

| Finding | Owner / current disposition |
| --- | --- |
| Missing explicit runtime/canonical/deployment binding in old evidence envelope | Task 09 independent checker added/tested; original contracts and historical ledger unchanged. Trusted collector authentication still required. |
| README reproducibility and historical worktree setup wording | Task 01 accepted direction for `npm ci` and guide/provider distinction; exact shared patch supplied separately, not applied here. |
| Package includes logs/research/assets; no root lock in npm tarball | Task 01 requested and received staged positive-allowlist proposal; distribution readiness remains blocked. |
| Artwork account paths and unverified rights | Task 08 assigned metadata sanitization; exact four-source and two-archive inventories sent. New fixes not yet audited at an integrated commit. |
| Native-control simulations cannot establish native-setting support | Task 08 notified; independent checker regression tests reject them. Native control interrupted, still unrun. |
| Missing final integrated source, access and numeric campaign budget | Task 01/02–08 must provide final SHA, approved runtime/provider/identity/storage/preview setup and budget before final audit. |

Code/test completion is **passed for Task 09's independent scope only**. First live demonstration is **blocked**. Private-alpha acceptance is **blocked** (A01–A22/D1–D8 and integrated service evidence). Production readiness is **not established**, with production abuse/operations/availability/security gates beyond a portfolio. A successful video or public website cannot change those outcomes by itself. The validation work grants no live enablement authority; Task 09 did not merge or close any PR.

## Published follow-up and CI

GitHub CI passed on evidence head `4fa7dc2ea573564441fc305929ad72a916bdc189`: [run 34437495850](https://github.com/shellcat-com/forge-ai/actions/runs/34437495850). `gh run view 34437495850 --repo shellcat-com/forge-ai --json headSha,status,conclusion,url` returned success; [receipt](../evidence/task-09/ci-source.json). The subsequent report-only commit preserves the exact audited implementation and its source inventory.

At 2026-09-10 04:33:55 UTC, Task 09 independently opened both Task 08’s [public alias](https://forge-ai-demo-omega.vercel.app/) and [immutable URL](https://forge-ai-demo-kcmp4ynqr-biswas07.vercel.app/) in a fresh task-scoped in-app browser, without Forge/Vercel login, owner cookies or bypass headers. Both rendered the platform-authored availability page and explicitly stated that the hosted builder and live generated portfolio are unavailable. This passes anonymous **availability-page reachability only**, not the requested generated-portfolio demonstration. Owner-reported commit/digest are preserved separately from independently authenticated deployment provenance in [follow-up evidence](../evidence/task-09/public-availability-followup.json).

The same follow-up reads Task 08 commit `339fb8e44234cca9ec5cfe3590e62709458e40a4`: the four identified metadata files no longer contain the account-scoped artwork URLs or job-ID fields, and artwork bytes are unchanged from the baseline. This verifies that narrow fix at the owner commit; it neither imports Task 08 nor clears historical public copies, media privacy, asset rights, packaging or final integrated acceptance. Task 03 also reported candidate dependency/export/native PostgreSQL evidence; its full integration and independent rerun remain future gates.

Task 01 subsequently integrated the reviewed authored commits into `codex/demo-delivery-baseline` at `d3244f7a300bba5d0351b36261b16d24d3474592`. GitHub automatically marked [PR #10](https://github.com/shellcat-com/forge-ai/pull/10) merged at 2026-09-10 04:34:45 UTC because its commits entered its feature-branch base; [receipt](../evidence/task-09/pr-integration.json). Task 09 performed no merge/close action. Task 01’s PR #8 to `master` remains the draft release integration. Later Task 09 report-only commits are published on the same owned branch for Task 01 to integrate; they do not have a new PR-triggered CI run after PR #10 closed. The recorded successful CI source and 304-file source inventory remain unchanged. Do not create a duplicate validation PR or interpret feature-branch integration as completed acceptance.

## Task 03 committed handoff review

Task 09 independently read commit `b3fb6f6771c482a09fc0a431240e7d3c250172d6` from [PR #13](https://github.com/shellcat-com/forge-ai/pull/13), verified all **26 evidence artifact hashes and 24 owned source hashes** against Git object bytes, and confirmed its successful exact-head [CI run](https://github.com/shellcat-com/forge-ai/actions/runs/34437962419). The original `engine/operations/provider-evaluation.ts` and its frozen provider corpus are byte-identical to the baseline. The reference-app diff only adds a portfolio entry bound to specification digest `6bbce92a1a970fbf37fc789858a839efbf99c8198b13eb62e99a7d7fe9be1020`; task-board/Pomodoro definitions are unchanged. [Review evidence](../evidence/task-09/task03-handoff-review.json) retains the precise diff and CI identity. This verifies the committed handoff binding, not an independent replay of acquisition/export/database execution. Task 03 still labels the release candidate, real Linux execution false and provider generation false. Its license/provenance caveats, D7 and final combined/live gates remain open; no Task 03 implementation was imported here.
