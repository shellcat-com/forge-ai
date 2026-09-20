# E2 source generation implementation and handoff

Status: **independent implementation and synthetic tests delivered; E2 milestone blocked on D3/D4/D5 and integrated E1 adoption**. No live model call, paid service, release template, execution, public route or private-alpha acceptance is claimed. Worktree baseline: `b0031b6`. E1 remains separately owned; no control files, migrations, shared contracts, package manifests or UI files were changed.

## Delivered interfaces

| Module | Exports and integration responsibility |
| --- | --- |
| `engine/providers/chat-completions.ts` | `ChatCompletionsAdapter`: fixed operator-approved HTTPS destination; no redirects, native tools, streaming, fallback, discovery call or automatic retry. Nonstream JSON response is byte-bounded, decoded strictly and parsed with E0 schemas. Credential retrieval, HTTP request and streamed body reads honor the bounded deadline. Injected HTTP transports must declare fixture provenance. `listModels` returns the operator allowlist and constrained adapter capabilities; credential presence never claims remote verification. |
| `engine/artifacts/store.ts` | `ArtifactStore`, `ArtifactRef`, `ArtifactScope`, `ImmutableObjectBackend`, `MemoryObjectBackend`. Store assigns scoped UUID keys, creates immutable versions, hashes bytes and reads back before returning an available reference. Reads check workspace/project, canonical key, immutable version, byte length and digest. Authenticated scope and reference must come from E1, never request bodies. |
| `engine/artifacts/local-backend.ts` | `LocalSyntheticObjectBackend.open(root)`: restart-persistent synthetic inert blobs. Directory and immediate parent must be canonical, trusted, process-owned mode 0700. Files use exclusive/no-follow creation, mode 0600, one link, a UUID version header, bounded reads and file/directory fsync. No generated file tree is written or executed. |
| `engine/generation/catalog.ts` | `TemplateCatalog`, `templateCatalogDigest`: exact template metadata and every source/asset byte hash; protected configuration ownership, strict TypeScript, pinned Next.js/lock versions, source and asset limits. No real release is included. This structural catalog validation supplements, and does not replace, dependency/license/scanner/image release checks. |
| `engine/generation/context.ts` | `buildGenerationRequest`: template guidance and structural schema, canonical plan/base/preset bindings, relevant hash-checked source and sanitized bounded diagnostics. Untrusted brief/source/diagnostics remain user-role data. Requests fail on context caps rather than silently omit required source. `sanitizeDiagnostic` normalizes control characters before credential-pattern redaction. Heuristic redaction is not a secret-manager substitute. |
| `engine/generation/pipeline.ts` | `collectProduct`, `generatePlan`, `generateFileBatches`. Sequential exact batch/base/plan binding, one writer per path, whole-proposal operation caps, full planned-task completion, no post-terminal fragments or mixed provenance. Arbitrary adapters get independent 120-second/deadline iteration cancellation; no hidden retry or repair. Plans must exactly match trusted resource/network/check policy before adoption. |
| `engine/generation/source.ts` | `createTemplateSource`, `validateStoredSource`, `readSourceFile`, `buildCandidate`, `prepareDiff`, `prepareExecutionReview`, `restoreSource`, `prepareSourceExport`. Complete immutable manifests; expected prior hashes; append-only migration history; immutable base; full-file unified review hunks; source-only ZIP with template-owned README, lockfile and environment placeholder example. Export requires a scanner callback and returns inert archive bytes, not an authorized download endpoint. |

Template digest convention: canonical SHA-256 of `{schemaVersion:1,manifest,files}`, where `manifest.template` omits its own `digest`, and `files` is sorted by ASCII path with `{path,mediaType,sha256,bytes}` for each file. All other template metadata, including image and lockfile digests, participates. This avoids self-hashing and changes no E0 schema. Coordinator was notified; E3 release tooling must use the same convention.

`ArtifactRef` contains `schemaVersion`, workspace/project/job UUIDs, assigned `id`, artifact `kind`, SHA-256, byte length, opaque `storageKey`/`storageVersion`, `state:"available"`, and `backendEvidence`. Both shipped backends explicitly use `backendEvidence:"fixture"`; persistent local storage is not production durability/encryption evidence. E1 should map these fields to its existing artifact table and CAS-adopt them. Do not expose keys/versions to browser code. A failed write/adoption can leave a quarantine orphan; no source head is updated by these modules. Deletion, retention and orphan inventory reconciliation remain coordinated E1/E5 infrastructure work.

## E1 integration seam and restart instructions

The coordinator identified an active E1 task and relayed its `StageAdapter` direction. No second control service was added. Wire the following hooks into existing leased worker/state transactions:

1. `beforeDispatch(request)` must recheck current lease/flags/approval, persist the immutable request context, atomically increment the job call counter (maximum 12 including repairs/retries), and reserve the attempt's maximum possible charge. It returns `{callNumber}`. E2 validates that returned bound and never selects a different model or retries itself.
2. `recordUsage(requestId,event)` writes a deduplicated measured/estimated/uncertain liability. Missing usage, network ambiguity, timeouts and interrupted iterators must retain the bounded reservation. A `retryable` provider error is not authorization to repeat an uncertain attempt.
3. `persistProduct(request,product)` stores the validated immutable plan/batch artifact before returning. It must reject stale epoch/state and atomically adopt its reference. `generatePlan` additionally requires expected brief/template/preset hashes and the trusted command policy; provider-selected grants cannot replace policy.
4. After a complete proposal, `buildCandidate` produces a new manifest. Run source/dependency/secret/migration policy checks before E1 exposes the execution review. `prepareDiff` and `prepareExecutionReview` bind candidate, diff, policy, image and migration list. E1 persists review and state atomically, then owns actual authorization, resource dispatch, verification and promotion.
5. `prepareSourceExport(..., scan)` calls `(files: readonly {path:string;bytes:Uint8Array}[], manifestDigest:string) => Promise<void>` with copied bytes. Scanner failure produces no archive artifact. E1 still checks editor membership, verified snapshot and fresh active scan/revocation policy. The validation track's concrete scanner can supply this callback.
6. To resume a crash, load E1's persisted request/output and artifact references; re-read immutable versions through `ArtifactStore`. Never blindly repeat an ambiguous provider call. Rebuild a proposal from its sequential persisted batches. Return to execution review after every repaired candidate.

Local backend initialization deliberately requires a precreated private parent and private child. Create those with a synthetic test owner, then call `LocalSyntheticObjectBackend.open(absoluteCanonicalChild)` and construct `new ArtifactStore(backend)`. Persist returned refs in the synthetic control database. Reopening the same path with the same refs reads exact versions after process restart. Node lacks descriptor-relative `openat` tree traversal here: an adversarial same-UID process replacing ancestors is outside this development backend's boundary. Do not configure this as production D5 storage or place generated execution beside it.

## Verification evidence

All source, provider transport and catalog data in tests are explicit fixtures. The catalog tests intentionally use fake `1.0.0` releases and a fixture image digest; they are not runnable Next.js releases. The local artifact tests use temporary private directories and delete them afterward. No environment file, database credential or real provider token was read.

```sh
npx vitest run tests/engine/e2-generation.test.ts tests/engine/e2-local-artifacts.test.ts
npx tsc -p tsconfig.engine.json --pretty false
npx eslint engine/providers engine/artifacts engine/generation tests/engine/e2-*.test.ts
npm run verify
```

Machine-readable result summary (targeted run, 2026-09-09):

```json
{"schemaVersion":1,"stage":"E2-independent","environment":{"node":"v25.8.1","platform":"darwin","arch":"arm64"},"evidenceOrigin":"fixture","targeted":{"files":2,"passed":38,"failed":0,"skipped":0},"strictEngineTypecheck":"passed","targetedLint":"passed","repositoryVerify":{"passed":155,"files":15,"lint":"passed","typecheck":"passed","build":"passed"},"liveProvider":"blocked:D3/D4","realObjectStore":"blocked:D5","realTemplate":"blocked:D7","generatedCodeExecuted":false}
```

Coverage includes fixed destination and redirect refusal; credential-presence semantics; HTTP auth/rate/unavailable redaction; refusal/truncation/native tools; malformed/oversized and split-UTF-8 responses; unknown/measured usage; cancellation and hung credential/HTTP/arbitrary iterator deadlines; stale hashes/path escape/unowned writes; scoped object reads; create-only and defensive copies; corrupted object readback; private local restart/tamper/symlink/version tests; immutable template/strict compiler validation; complete candidate, diff/review and restore bindings; scanner rejection; source-only archive contents; plan policy and hook/call-cap enforcement; and rejecting post-completion data before product adoption.

Final full repository verification passed 155 tests in 15 files, lint, strict TypeScript and production build, including the final coordinator-requested policy/deadline regressions. The targeted suite contains 38 of those tests. The coordinator reruns integrated `npm run verify` after merging all tracks. The preexisting ancestor `expo/tsconfig.base` warning remains. Full-file diff artifacts have a 24 MiB cap; exceptionally expansive review text fails closed and requires a smaller proposal. No browser check applies to this backend-only change; A21 browser compatibility remains a coordinator check.

## Acceptance and external gates

| Acceptance | E2 result | Remaining real evidence |
| --- | --- | --- |
| A01/A02 | Not run end to end; complete-source/batch/migration foundations tested synthetically | Live generated task board, isolated checks, PostgreSQL CRUD and additive edit |
| A03/A04 | Synthetic immutable base/restore/diff/ZIP tests passed | E1 history/CAS integration and clean install/migrate/build/run export |
| A05/A06 | Scope/digest preparation and cross-project object-read tests passed | Authenticated E1 endpoint/approval races and full tenant suite |
| A08/A09/A10 | Local restart/readback, partial-output rejection and cancellation bounds passed | Durable worker/broker crashes, fencing, cleanup and remote uncertain charge reconciliation |
| A11/A12 | Synthetic transport/parser/path/catalog/context and source-integrity tests passed | Exact entitled live endpoint behavior, source policy and real isolation corpus |
| A15/A16/A17 | No fixture verification claim; exact review preparation and 12-call-hook bound tested | Authenticated runner evidence, bounded integrated repairs and transactional ledger races |
| A18 | Local immutable-version restart only | D5 production artifact/control restore and measured RPO/RTO |
| A07/A13/A14/A19/A20/A22 | Not run by this track | E1/E3/E4/E5 integrated systems and browser/live/load campaigns |
| A21 | Backend-only targeted checks and full repository verification passed as recorded | Final integrated verification and existing browser flows |

E2's RFC exit gate remains **blocked**. D3 exact provider/model entitlement and D4 spend approval are open. D5 storage/KMS/region/retention and D7 real template release are open. D1/D2/D6/D8 remain tracked by the coordinator. NVIDIA loopback planning and Neon/cloud experiments do not close any of those decisions. No live policy is enabled by adding this implementation.

## Proposed D3/D4 choice for owner review, not an enabled policy

One concrete compatibility-evaluation candidate is `gpt-4.1-2025-04-14` at `https://api.openai.com/v1/chat/completions`, using this adapter's nonstream JSON mode with tools disabled. The official model page lists that snapshot, Chat Completions, and standard text prices of $2 per million input tokens and $8 per million output tokens; availability and account limits still require owner entitlement evidence. This is a conservative adapter-compatibility proposal, not a quality recommendation or vendor selection. [Model documentation](https://developers.openai.com/api/docs/models/gpt-4.1). JSON mode only ensures JSON; E0 schemas and semantic policy remain mandatory. [Chat Completions documentation](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Proposed evaluation policy: pin a dated price record; propose a verified upper bound of 65,536 input tokens (including role/schema/protocol overhead) and output at 8,192 tokens. UTF-8 context bytes alone are not proof of this billable-token bound; a model-specific counter or documented conservative bound is a paid-dispatch prerequisite. At the listed uncached prices this gives 196,608 microdollars maximum per attempt and 2,359,296 across 12 attempts. These are calculated ceilings, not measurements. Proposed owner envelopes are $5/job, $25/workspace/day, $50/global/day and a separately approved 30-run evaluation budget of at most $150, plus a separately specified infrastructure envelope. They remain disabled proposals. Unknown usage retains the full relevant reservation.

Owner closure must specify secret-manager location and worker identity, approved data residency/retention, account entitlement to the exact snapshot, real RPM/TPM/project caps, dated prices and tax/currency assumptions, billing lookup/reconciliation procedure, and budget authority. Before activation, run the RFC frozen 30-run task-board/Pomodoro corpus with all attempts recorded, at least 90% completion within two repairs, and all promoted checks passing. Test real cancellation/error/capability drift and disable policy on drift. Neither this suggestion nor documentation research authorizes any call or purchase.

## Coordinated review follow-up

After coordinator integration of `0331f7b`, independent review found an unbounded credential-presence probe and a brief-hash mismatch with E1. The follow-up keeps E1 and all shared contracts unchanged:

- `validateCredentials` now bounds secret retrieval to 10 seconds, honors caller cancellation even when the secret store ignores its signal, returns redacted `UNAVAILABLE` status on lookup failure/timeout, and makes no HTTP probe. Configuration presence remains separate from verification.
- `PlanV1.briefHash` in E2 context now equals **SHA-256 of the exact admitted job instruction encoded as UTF-8**, matching E1's existing `sha256(instruction)`. There is no JSON quoting, added newline, trimming, case folding or Unicode normalization at this step. The separately supplied project brief remains context data. File-generation context rejects a plan whose instruction hash differs. Canonical JSON hashing remains unchanged for complete plans, manifests, presets, reviews and descriptors.
- New tests cover stalled/cancelled/redacted credential lookup and whitespace/decomposed-Unicode hash vectors. The latest targeted result is **41 passed, 0 failed, 0 skipped in 2 files**; strict engine typecheck and targeted ESLint passed. The earlier full-repository 155-test record above describes the initial E2 commit; final integrated verification remains the coordinator's responsibility after this patch.

## Coordinated integrated checkpoint

The subsequent approved E1 bridge is documented in[e2-control-integration.md](e2-control-integration.md). Actual immutable source/diff/file/export/restore APIs now integrate with the sole E1 control service, with19 native bridge tests. Validation/replay recomputes diffs without creating comparison objects. The connected HTTP/client suite passes2 tests, the repair suite4, and the final repository run532 tests with4 explicit optional skips. These remain fixture/provider-free integrations; the live E2 release blockers above are unchanged.
