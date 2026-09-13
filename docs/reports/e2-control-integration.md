# E2 immutable-source/control bridge

Status: implemented and verified as a zero-cost, native-PostgreSQL **fixture integration**. This is not E2 live-provider completion, E3 isolation evidence, or E4/E5 private-alpha acceptance.

Baseline: `b981ec6b1dfafdeacd32a3765479fd1613622c9a`, isolated branch `codex/e2-e5-integration`. E1 explicitly released catalog/stage-adapter/service/worker and additive migration ownership. A subsequent coordinated extension released only `database.ts`'s resource-kind union and the additive artifact locator. The original fixture adapter, 0001/0002 migrations, E1 tests/report and frozen evidence remain unchanged. All six final E1 handoff items and the frozen evidence manifest were read before implementation.

## Implementation and handoff resolution

One existing `ControlService`, `ControlWorker`, state machine, queue, lease CAS, approvals, usage ledger and promotion service remain authoritative. `ControlCatalog` injection defaults to E1's exact synthetic catalog. The separately named `e2-candidate-fixture` catalog binds server-loaded template/preset/policy bytes, refuses nonzero cost, and uses the fixed `candidateImageDigest` for a nonexistent **NONRELEASE** image. `fixture-v1` / `fixture-e1-v1` remain the frozen E1 model-policy identifiers. The separate catalog name identifies this source mode; no live provenance guard was relaxed.

`CandidateStageAdapter` loads the actual 20-file candidate from an injected `TemplateCatalog`, uses E2 context assembly and PlanV1/FileBatchV1 generation validation, builds a complete immutable source manifest, validates template-owned hashes and migration SQL, scans source, and prepares the actual unified diff. Its product is explicitly deterministic: one plan or one final file batch per E1-reserved stage. The sample replaces `app/page.tsx` with a synthetic-source label; it does not satisfy arbitrary application requests. There are no paid calls, hidden batches, automatic provider retries, shell invocations, generated-code execution, guest databases or real previews. Existing E1 fake execution/verification/preview receipts are rebound to the candidate catalog and stay `origin: fixture`.

`stored-plan` and `stored-candidate` StageResult variants contain immutable object references. The worker captures scoped persisted source metadata in a short lease transaction, validates object bytes outside the transaction, saves validated operation results under the current lease, then validates again before final adoption. Adoption rechecks E1's worker identity, current epoch, active lease, actor membership, cancellation, expiry and revocation. Exact artifact UUID, workspace/project/job, object key, immutable version, raw SHA-256 and byte length are persisted. Existing older-job blobs must already have identical available metadata in the same project. New artifacts must belong to the current job. Object-storage work never runs in a lease transaction. Failed/stale work leaves inaccessible unadopted objects.

Additive migration `0003_immutable_source_bridge.sql` adds tenant-scoped job→base/diff bindings and immutable export receipts. The worker can update only the diff binding, never an established base. Existing E1 snapshots point to the actual source manifest's raw canonical-JSON hash. The immutable E1 JSON cache holds parsed plan/manifests/verification for database-only reads; it does not substitute JSON-wrapper hashes for stored blob hashes. The approved artifact locator extension retains E1 session/current-membership checks and foreign/missing 404 semantics, and filters unavailable/expired artifacts and deleting projects.

Plan binding uses SHA-256 of the **exact admitted instruction UTF-8 bytes** after the existing E1 admission schema has parsed its input. No additional normalization or canonical-JSON string quoting occurs in E2. The template/preset/resource/network/check policy is server-owned. Candidate adoption validates complete source ownership, plan hash, base snapshot, source scope, append-only migrations, every planned changed path and a recomputed diff hash. This bounded bridge rejects no-op file tasks rather than treating them as completed changes. Restoration reuses previously verified source bytes, writes a new `origin: restore` manifest/history record against the current head and requests a new execution review with synthetic-data reset acknowledged.

## Server composition

The reusable native integration harness in `tests/harness/e2-control.ts` exports `createE2ControlHarness(origin?)`; `tests/engine/e2-control-integration.test.ts` exercises it. The factory returns the native pools, session/service/worker/repository/catalog/adapter, and `actor`, `job`, `state`, `approve`, `reach`, `reset`, `close` helpers for coordinator-owned HTTP tests. It is the executable composition example. It reads the committed 20 candidate paths, computes their catalog digest, injects `templateCommandPolicy(fixturePolicy(0).resources)`, a server-owned fixture preset and the concrete source scanner. Engine modules do not statically import `templates/`, preserving `tsconfig.control.json`'s standalone `rootDir: engine` build.

Create `SourceRepository(store, templateCatalog, scanner, scanPolicyDigest)`, then `candidateControlCatalog(repository, policy, preset)`. Use the same catalog/preset for `CandidateStageAdapter(repository, controlCatalog, preset)`, `new ControlService(apiDB, sessions, true, controlCatalog, repository)` and `new ControlWorker(workerDB, adapter, hooks, controlCatalog, repository)`. The scanner digest must identify the operator-owned scanner policy revision; the synthetic default is the command-policy digest. Apply 0003 only to the explicitly synthetic database after 0001/0002. Ordinary control startup remains the E1 default until its composition explicitly opts into this catalog.

The tests use `LocalSyntheticObjectBackend` in a private owner-controlled flat directory. Reopening it verifies immutable source bytes after restart. Its evidence is still fixture: no cloud encryption/KMS, adversarial same-UID `openat` guarantee, backup durability, retention GC or production object-store acceptance is claimed. Diff recomputation is read-only after the coordinated follow-up below. Losing export races and failed new candidate preparation can create orphan objects; there is no orphan-retention collector in this bridge. A configured immutable backend/scanner must be trusted and responsive; live remote-store latency/cancellation and capacity are not measured here.

## Read and export methods for coordinator-owned HTTP/UI routing

All methods return `schemaVersion: 1, origin: 'fixture'`. Untrusted source/diff/plan text must be escaped; attachment responses must use download disposition and `nosniff`, never active inline HTML.

| Service method | Return fields beyond version/origin |
| --- | --- |
| `plan(token, jobId)` | `plan: PlanV1`, `planDigest`, `stateVersion`, `reviewDigest` |
| `changes(token, jobId)` | `snapshotId`, `manifest: ManifestV1`, `manifestDigest`, `diff: {artifactId, sha256, bytes: number, unified: string}`, `verification: VerificationV1 \| null`, `verificationDigest: string \| null`, `stateVersion`, `reviewDigest` |
| `files(token, snapshotId)` | `snapshotId`, `manifestDigest`, `files: {path, sha256, bytes: number, mediaType}[]` |
| `file(token, snapshotId, path)` | `snapshotId`, `path`, `sha256`, `mediaType`, `bytes: Uint8Array`, `manifestDigest` |
| `sourceExport(token, snapshotId, csrf, idempotencyKey)` | `snapshotId`, `manifestDigest`, `jobId`, `artifactId`, `sha256`, `bytes: Uint8Array` |
| `artifactAttachment(token, jobId, artifactId)` | `artifactId`, `kind`, `sha256`, `bytes: Uint8Array`, `snapshotId: string \| null`, `manifestDigest: string \| null` |
| `artifactAttachmentById(token, artifactId)` | Same attachment return through the approved scoped locator |

Source/diff reads load authorized immutable metadata, read bounded bytes outside transactions, and reauthorize/fence metadata afterward. Changes include a hash-checked current verification payload so the UI can bind displayed evidence to the promotion review. The default E1 fixture catalog can return its actual plan; stored-source methods explicitly report `SOURCE_UNAVAILABLE` without a repository. Existing E1 JSON artifact reads are preserved.

Exports require editor access, CSRF, a currently available verified snapshot/verification artifact younger than 24 hours, current catalog and scanner policy, and no policy revocation/security shutdown. Source is freshly scanned outside the DB transaction. A final locked eligibility/idempotency transaction adopts exactly one export attachment and stores its scanner/verification binding and 24-hour expiry. Concurrent identical requests may upload unreferenced objects, but all successful retries return the same adopted attachment. Replay/download rechecks current authorization, verification/scanner policy, revocation and expiry. Viewer access to export bytes is denied. Source, plan and diff attachments remain tenant scoped; object keys/versions are never returned by these service read contracts.

HTTP routing and browser rendering remain coordinator-owned and are not implemented in this commit.

## Verification evidence

Executed on macOS with native PostgreSQL 14.18 over temporary Unix sockets; trusted control code only. No `.env` credentials or paid infrastructure were used.

- `npm run verify`: passed, **426 tests passed, 2 optional tests skipped**, lint/strict TypeScript/Vite build passed. This includes the E1 native regression and the new bridge tests.
- `npx tsc -p tsconfig.control.json --pretty false`: passed standalone build with no compiler/dependency-manifest changes.
- `npx vitest run tests/engine/e2-control-integration.test.ts tests/engine/control.native.test.ts --reporter=verbose`: **63/63 passed** (18 bridge + 45 untouched E1 native regressions). After harness extraction the 18 bridge tests were rerun; strict engine typecheck and targeted lint also passed.
- `git diff --check`: passed.

The bridge suite covers actual 20-file source→plan review→execution review→fixture verification→promotion; a second generation and restoration of the earlier source; source history, raw file hashes, local backend reopening and clean source ZIP content; wrong scope/hash/version/key; invented plan resources; secret-bearing candidate rejection; saved-result crash replay without redispatch; tampered saved results; stale lease adoption; two-tenant source/attachment reads; viewer download denial; current-session revocation during object I/O; exact export retry identity; expired verification and policy/session revocation. Native fixture assertions are not live acceptance.

Preserved hashes:

- 0001: `6838d3f1f443f31253d9064915565ce9cd5fe3cbf96366baacb120827cf8879e`
- 0002: `de4ba2c189d1c84302a0ba90973c78ca517e3fcf75f411b443f45835d7d6de6a`
- E1 report: `2058c6b4a7e7fa17eb2711bc0c42e6ddc6902ae53bef03ba607b5488d1a377d0`

## Acceptance and remaining gates

| Matrix | This bridge's evidence | RFC acceptance |
| --- | --- | --- |
| A01–A02 | Synthetic source products and full candidate manifests; no live task-board/priority generation or app DB execution | Blocked by D2/D3/D4/D7 and real runner/provider integration |
| A03 | Passed native source history and rollback to earlier immutable bytes; fresh fixture review | Real preview data reset/restart not run |
| A04 | Passed scoped scanned source ZIP and exact bytes | Clean isolated install/migrate/build/run blocked by D2/D7 |
| A05–A09 | Passed targeted native review/hash/scope, retry, saved-result and stale-lease assertions; E1 regressions retained | Browser/live-provider/broker boundary portions not run |
| A10–A18 | E1 default regressions plus source-policy, scanner, export expiry/revocation assertions | Real isolation, runtime cleanup, preview, billing, recovery portions not run/blocked |
| A19–A22 | No browser usability, live quality, capacity or production operations evidence in this bridge | Not run; dependent on E3/E4 and D1–D8 |

D1–D8 remain unresolved: external OIDC/accounts; Linux/KVM isolated host; provider entitlement/model quality; spending/pricing/quota envelope; cloud region/object storage/KMS/backups/retention; separate preview domain/TLS; approved template/runtime/dependency release; alpha invite/capacity and operational owner. NVIDIA planning and Neon experiments are not adopted as approvals. E2 live generation, E3 execution, integrated live E4 and E5 cannot be marked complete from this fixture flow. Broader commercial features remain deferred by RFC 0001.

Resume by running the native composition test, reviewing 0003 and service return schemas with the coordinator, wiring explicit fixture mode through the existing HTTP/UI, then pursuing approved real provider/runner/storage seams. Do not create a second control service or turn fixture receipts into live verification.


## Coordinated diff-validation follow-up

`computeSourceDiff` now reads source bytes and calculates the same bounded unified diff without storing anything. `prepareDiff` remains the creation boundary and writes one new diff object. SourceRepository uses one read-only computation for candidate proposal and exact diff-hash validation, including saved-result replay. Native regressions assert repeated validation and crash replay perform zero object writes and preserve the original diff bytes. This removes comparison-only orphans; interrupted preparation/export-race orphans still require the deferred retention collector.

Follow-up verification: 73 targeted tests passed across provider-evaluation (16), E2 generation (38) and native source bridge (19). Strict engine typecheck, standalone control build, targeted lint and diff whitespace checks passed. The native assertions remain synthetic source/control evidence.
