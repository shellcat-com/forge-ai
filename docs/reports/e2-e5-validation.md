# E2–E5 independent validation track

Status: independent validation implementation delivered; E2/E3/E4/E5 acceptance remains incomplete. Baseline `b0031b6`; isolated worker branch `codex/e2-e5-validation`. No E1 control/migration/contracts or dependency manifests changed.

## Implemented boundaries

- `engine/validation/migrations.ts`: bounded ASCII SQL tokenizer and recursive parser accepting only additive CREATE TABLE, CREATE [UNIQUE] INDEX and ALTER TABLE ADD COLUMN in the fixed `app` schema. AST renderer quotes identifiers and emits canonical statements. Runtime must execute only returned `statements`; original model SQL is never an execution input. Tables require one primary key. NOT NULL additive columns require non-null defaults. UUID IDs are app-generated: database function defaults, expressions, quoted identifiers, block comments, procedural SQL, destructive DDL, extensions, grants and cross-schema access are unsupported and rejected. The parser is deliberately narrower than PostgreSQL grammar; unsupported ordinary SQL is an actionable policy limitation, not a fallback.
- `engine/validation/dependencies.ts`: validates exact package/lock bytes against an authenticated operator dependency policy, exact direct/transitive versions, registry destination, SHA-512 integrity metadata, reviewed licenses and install scripts, revocation and expiration. This validates policy metadata; it does not fetch packages, scan vulnerabilities, verify downloaded tarball bytes, or approve D7. The immutable materializer must verify bytes independently.
- `engine/validation/adversarial.ts`: explicit hostile SQL/path/prompt/check-spoof corpus; never executable host payloads.
- `engine/validation/acceptance.ts`: all A01–A22 requirements, evidence modes/assertions, prerequisite enforcement and E4/E5 decision gates. The resolver must authenticate externally collected evidence. Caller/model JSON is never trusted evidence. Fixture/unit/embedded records remain visible and cannot pass live acceptance. A22 binds template/policy across distinct source snapshots, requires 30 unique live runs and both reference variants, retains failed attempts, and checks the 90% threshold. This is a reporting evaluator, not an execution or promotion authorization service.
- `tests/harness/reference-apps.ts`: immutable reference corpus plus trusted task-board CRUD/title/filter/priority and Pomodoro timer/session-history assertions. Both demand a changed app-process ID and unchanged DB volume, check PostgreSQL rows separately, then read the UI again. Driver fixture tests expose lost rows, false restart and faulty filtering. These harnesses return observations only, never verification stamps.
- `tests/harness/native-migrations.ts`: opt-in native PostgreSQL drill using reviewed synthetic SQL only, fresh cluster, private Unix socket, limited roles, no inherited DB configuration, and confirmed cleanup. It is not a generated-app runner and does not execute generated app code.

## Verification

Commands:

```sh
npx tsc -p tsconfig.engine.json --pretty false
npx eslint engine/validation tests/engine/validation-*.test.ts tests/harness
FORGE_NATIVE_MIGRATION_TEST=1 npx vitest run tests/engine/validation-*.test.ts
npm run verify
```

81 targeted tests passed across six files, including native PostgreSQL 14.18 fresh and seeded-prior migration checks, default preservation, invalid-priority rejection, and denial of runtime table/role creation and server-file reads. Native cluster was stopped and removed. Embedded PGlite independently passed fresh/prior migration checks. Native synthetic SQL evidence does not count as Firecracker isolation or generated-app persistence evidence. Default suite marks the native drill skipped unless explicitly enabled.

Strict engine TypeScript and targeted ESLint passed. Full `npm run verify` passed on the independent baseline plus these additions: lint, typecheck, 197 passing tests plus one intentionally skipped opt-in native drill, production build. Existing ancestor `expo/tsconfig.base` warning remains. No UI changed and no browser flow was exercised by this track.

Machine-readable targeted results and verification logs are in `tests/harness/evidence/`. Absolute worktree paths in test output identify the actual tested checkout. Reports use test fixture provenance even where assertions intentionally supply fake “live” records to test the evaluator. Such test records are not acceptance evidence.

## Acceptance disposition and blockers

A01–A22 remain blocked/not-run as complete real acceptance scenarios. Partial validation evidence supports A02/A11/A12/A15/A21 foundations only. In particular, native PostgreSQL SQL tests do not close A02 without real generated priority source, isolated execution and browser regression.

D1/D4/D5 E1 controls and live service decisions remain with E1/coordinator. D2 Linux/KVM isolated runtime, D3 approved generation entitlement/spend, D6 preview DNS/TLS domain, D7 reviewed exact image/dependencies and D8 alpha operations/capacity signoff remain unresolved. No paid APIs, infrastructure, public publishing or DNS mutations occurred.

Missing real harness integration: a separately isolated browser driver implementing the documented semantic UI contract, an app-local test database reader and authenticated runtime restart/volume observer. No ordinary-host generated-code or browser execution substitutes for them. Responsive/keyboard/zoom/reduced-motion checks are defined in the frozen corpus but still need the real browser-driver implementation and evidence. External authenticators must feed the acceptance resolver; accepting arbitrary user records would violate its contract.

## Resume and integration

1. Coordinator integrates this worker commit after E2/E3 review; runtime imports `validateMigrationSql` from `engine/validation/migrations.ts` and executes only canonical statements after its own signed approval and role/time-limit gates.
2. E2 supplies trusted immutable dependency metadata to `validatePinnedDependencies`; the cache materializer verifies downloaded object digests separately.
3. Bind reference drivers and evidence resolver only to authenticated isolated services. Run both schema paths, actual reference apps and negative corpus inside the approved microVM boundary when D2/D7 close.
4. Populate A01–A22 from authenticated evidence. E4 requires E1/E2/E3 prerequisite completion; E5 also requires A20/A22 and all D1–D8 closures. Never turn fixture records into live records to bypass missing access.

## Follow-up scanner and independent review

`engine/validation/secrets.ts` supplies the concrete E2 export callback through `sourceExportScanner(policy)`, and synchronous candidate-source scanning through `scanSourceSecrets(files, manifestDigest, policy)`. It scans bounded source/asset bytes for server-known canaries in raw, URL/base64/Unicode-escaped and control-split forms, common private-key/provider-token signatures, literal secret assignments and credential URLs. Unsafe artifact paths fail closed. An optional exact reviewed `.env.example` digest suppresses generic assignment/URL rules only; canaries/key signatures are never exempt. Errors contain no matched value or source. `assertNoKnownSecrets` supports bounded event/log assertions. Four additional tests cover actual rejection through this callback; there is no no-op scanner in these tests. This is a heuristic plus known-value scanner, not proof against unknown or arbitrary obfuscation.

Independent E2/E3 review findings were sent to owning workers rather than modifying concurrent files:

| Area | Finding and required resolution |
| --- | --- |
| E2 diagnostic redaction | Credential matching before removing controls can reconstruct leaked `api_key`/Bearer strings. Normalize first, then redact; add canary regression. |
| E3 guest logs | ANSI removal after canary replacement reconstructs secrets. Strip controls first, redact known values, and prevent cap-truncated partial known-secret leaks. |
| E3 lifecycle | Sweeping a pending create and confirming destroy before a late create completes can resurrect a VM after capacity is released. Durable host-side fencing/tombstones must make a successful destroy irrevocable for that environment generation. |
| E3 authority reads | Awaiting unbounded E1 authorization inside the global journal lock can block renewals/cancellations; bound these reads and minimize lock duration. |
| E3 release evidence | Reports checking only `status=passed`/`origin=real` allow unrelated prior evidence to approve changed templates. Every report must bind exact template/image/lock/policy, kind and current trusted approval; benchmark evidence must bind frozen corpus and sample requirements. |

These findings are review requests; their resolution and regression evidence belong in the integrated coordinator report. Merely sending the requests does not close them.

## Integrated contract evidence after worker review fixes

Reference commits imported into this isolated validation worktree only as dependencies:

| Worker source commit | Local cherry-pick | Purpose |
| --- | --- | --- |
| E2 `0331f7b` | `7367e28` | Source generation and immutable local artifacts |
| E3 `bf2130c` | `15a2344` | Broker, runner client, candidate template, review fixes |
| E3 `f5a8670` | `daf9164` | Frozen corpus binding, strict release negatives, template fixes |
| E2 `eb8d676` | `37ccd7d` | Bounded credential probes, exact admitted instruction hash |

The subsequent validation integration commit changes only this track's owned validation code/tests/report/evidence. Do not reapply these worker dependencies from the validation branch when integrating that final commit.

`tests/engine/validation-integration.test.ts` statically imports the committed E2/E3 interfaces; all four integration tests execute without availability skips. They exercise:

1. E2 immutable candidate source containing a canary cannot export through the concrete secret scanner; base content remains unchanged and SQL parser validates the stored migration bytes.
2. Synthetic local object storage is reopened through a fresh backend instance, metadata round-trips through JSON, candidate bytes revalidate, and a scanner-approved source ZIP round-trips through immutable storage. This is restart-persistent local artifact evidence, not cloud durability.
3. The actual committed Next candidate's 20 selected files materialize through the E2 catalog-digest convention, validate against the stored manifest and pass concrete source scanning/export. No template app code is executed by this harness. Image identity and origin remain explicit fixtures, so this does not approve D7 or prove a clean install/build.
4. The exact E2 diff/review binds E3 signatures and candidate hashes; approved SQL enters the E3 migration adapter only as canonical parser output with app-local identity and timeout constraints; all fourteen broker checks run through an explicit fixture host; fixture verification is refused by the real passing-verification validator; stale candidate binding is rejected and fixture teardown confirms both resource destruction and fencing.

The generic secret-assignment heuristic recognizes only exact symbolic values `REPLACE_ME` and `REPLACE_WITH_LOCAL_PASSWORD` used by the reviewed template tests. This is not a path or arbitrary-content exemption. Known canaries, key signatures and credential URLs are checked independently; regression tests show a server-known secret equal to a placeholder is still rejected. `.env.example` generic URL acceptance still requires its exact reviewed hash. Unknown/obfuscated secrets remain a material scanner limitation.

A22 evaluation additionally requires every successful live benchmark run to carry microVM and native PostgreSQL evidence, while keeping failed generation attempts in the denominator. A synthetic test verifies the 27/30 threshold across distinct source digests and rejects missing execution evidence, duplicate attempts and sub-threshold outcomes.

Final integrated checks in this worktree:

- **PASS:** 87/87 targeted validation tests across seven files, including opt-in native PostgreSQL 14.18 synthetic migration/privilege drill, zero skips/failures; `tests/harness/evidence/validation-integrated-tests.json`.
- **PASS:** strict engine TypeScript and targeted validation ESLint.
- **PASS:** full `npm run verify`, 287 passed tests and one intentionally skipped opt-in native drill, production build; `tests/harness/evidence/validation-integrated-verify.log`. An initial inherited template-global `URL` lint failure was fixed in E3 `f5a8670`; the final log reflects the repaired snapshot.
- **PASS in explicit fixtures:** E2 normalization/probe deadlines; E3 controls-first redaction and truncated canary handling, delayed-create host tombstone protocol, bounded authority reads, strict release subject/freshness/revocation/corpus tests. Real host tombstones and a real trickling mTLS/network campaign remain not-run. The client now applies an absolute deadline; a unit-code review is not live network evidence.

Coordinator operations/preview helpers also received a bounded read-only review; no additional blocking code finding was identified. These pure helpers remain partial implementation and supplied-measurement evaluation; the review is not A14/A18/A20 acceptance.

A01–A22 still have no newly closed real end-to-end gate from this work. E1 durable integration and D1–D8 release dependencies remain as recorded by the coordinator. No UI behavior was changed or verified by this track; platform-authored candidate browser evidence is owned by E3, separate from generated-app browser acceptance.

## Machine-readable release checkpoint ledger

`docs/reports/evidence/e2-e5/acceptance.json` records all 22 RFC acceptance scenarios, their exact required assertions, scenario prerequisites, decision blockers, evidence references and unavailable release digests. D1–D8 remain OPEN with null closure evidence; E1 is in progress and E2–E5 remain blocked. No live acceptance pass or release attestation is invented.

Current checkpoint: **21 blocked, A21 failed, zero passed.** A21's actual combined repository verification failed at E1 reconciler insertion of NULL `audit_events.actor_id`: lint/typecheck passed; 331 tests passed, one failed and one skipped; build was not reached. The E1 owner acknowledged the issue and is fixing it. This task changed no E1 code and did not repeat the held combined verification. The exact failed log is preserved as `repository-verify-e1-audit-failure.log` beside the ledger so a successful later run cannot erase this historical result.

Supporting evidence is a separate layer: seven passed items and one failed item. The ledger hashes the coordinator's 191/191 targeted test snapshot; native PostgreSQL14.18 synthetic migration support; real platform-authored candidate browser/build checks; npm advisory snapshot; prior isolated-worker verification; unchanged Forge browser actions; and the failed combined verification. Existing Forge browser actions passed with their recorded limits: downloaded export bytes were not independently inspected. Scaffold/browser tests never become generated-app or microVM evidence. Source/template/policy release digests remain null; actual evidence artifact hashes are populated only from bytes read.

Run this read-only reporting command from the integrated repository using Node24+:

```sh
node --experimental-strip-types engine/validation/acceptance-ledger.ts docs/reports/evidence/e2-e5/acceptance.json
```

An optional second argument supplies a separate evidence root. The command checks strict schema, complete unique A01–A22/D1–D8 sets, prerequisites, exact open-decision dependencies, known supporting references, truthful failure/pass counts and actual evidence-file hashes, then prints a JSON summary. It cannot establish a live pass from fixture labels, invented digests or client JSON. Actual release attestations require the separate authenticated collectors and acceptance flow, not this checkpoint format.

Seven focused tests pass, covering false passes/closed decisions, duplicate or missing scenarios, omitted prerequisites/assertions/blockers, false provenance, fake digests, unsupported failure claims, missing evidence, mutated artifact bytes and incorrect recorded test counts. Strict engine TypeScript and targeted ESLint pass. The CLI verified all eight referenced artifacts through a temporary evidence view containing the shared files plus the new historical copy. This only verifies local recorded bytes, not provenance authenticity beyond the explicitly documented source.

When final E1 handoff and combined verification complete, retain the historical failure, add the new evidence with its measured status, and explicitly supersede A21's checkpoint result. Do not change the 191-test artifact or its hash silently: if a referenced file changes, the command intentionally fails until the ledger is reviewed and refreshed. The OPEN decisions and E2–E5 milestone gates remain fixed; E1 fixture verification and A21 compatibility can advance within this checkpoint format only with the explicit evidence described below. No CLI flag enables release readiness.

The isolated validation worktree also passed full `npm run verify` after this addition: 294 tests passed, one opt-in native drill skipped, production build passed. That worktree omits concurrent E1 changes, so this success does not supersede the shared-checkout A21 failure.


### Reviewed E1/A21 checkpoint progression

The checkpoint format now distinguishes E1 `fixture-verified` from live authentication and allows A21 existing-Forge compatibility to pass without requiring a live generation engine. The committed checkpoint JSON is intentionally unchanged: E1 remains in progress and A21 failed until the coordinator records the final evidence.

To record E1 `fixture-verified`, add `milestoneEvidenceIds: {"E1":["<support-id>"]}`. That support must be current, passed, `native-postgres-synthetic`, explicitly include `acceptanceChecks:["e1-fixture-suite"]`, include exact scope `tests/engine/control.native.test.ts`, and supply passing test counts with an artifact hash. The artifact verifier also requires the actual JSON to contain that native control suite with nonempty, entirely passed assertions. Other suites may have unrelated skips; they cannot substitute for those native assertions. This asserts fixture/control verification only and closes no D1–D8 decision.

For an A21 pass, a selected current, passed `repository-verification` support must explicitly cover `acceptanceChecks:["npm-verify","loopback-constraints"]`. Its artifact must be a new complete successful npm verification log; the verifier checks all five command stages, passing tests, successful build and absence of test failure markers. Add `supersedesEvidenceIds` naming every retained failed repository support. The new artifact cannot reuse a failed artifact's path/hash, and the historical failure cannot remain marked current.

A selected current, passed `existing-forge-browser` support must cover `acceptanceChecks:["local-brief","sample","export"]`. The artifact verifier requires the recorded existing-Forge browser origin and passed local brief creation, sample walkthrough, design-package export and brief-export checks. Prior worker verification, unit/provider fixtures and scaffold browser evidence cannot fill either current support role. A21 then uses empty `missingAssertions` and `blockers`; it may retain historical support references without treating them as current success. All release source/template/policy digests remain null and `releaseEvidenceIds` remains empty.

Fourteen focused ledger tests pass, including permitted E1/A21 progression, absent/partial/current/historical coverage, fake-only A21 claims, unsuperseded failures, failure artifacts relabeled as success, and complete log/browser content checks. The tests separately validate the actual checkpoint and keep negative-test fixtures independent of future legitimate E1/A21 updates. Strict engine TypeScript and targeted lint pass. Full isolated verification passed after the initial progression change; the final additional stable-fixture test passed in the focused run. This work never changes the committed checkpoint statuses, never waits for E1, and never claims live-engine acceptance.
