# Task 04 — BYOK, source generation and per-call accounting

Status: **owned implementation and integration proposal delivered; live and hosted product acceptance blocked**. No billable API call, purchased service, deployment, credential discovery or generated-code execution was performed. Fixture output is never live evidence.

## Baseline and ownership

Started in isolated `/tmp/forge-task04-byok` on `codex/task-04-byok` at Task 01's published worker SHA `881e9ac2b11f8f168cb7849b77c4ee7439e55458`. Origin verified as `https://github.com/shellcat-com/forge-ai.git`. PR base: `codex/demo-delivery-baseline`, depending on draft PR #8 and Task 01's integration. PR #7 is already merged into master. The dirty shared checkout and other sessions are preserved.

Read AGENTS.md, RFC 0001, E0/E1 and E2–E5 reports, engine-decisions.md, the current Task 01 coordination board, existing providers/source/artifact/control/accounting code and tests. Current ownership/metadata was read from Task 01's newer published board because the frozen worker SHA predates its publication note. This task changes only `engine/providers`, one new source-composition module under `engine/generation`, provider/source tests, and its report/evidence. Shared contracts, control service, migrations, manifests/lockfiles, Next.js routes/UI, runtime and template were not edited.

## Delivered

- Exact provider/capability registry and tested OpenAI-compatible nonstreaming JSON transport. Named OpenAI policy restricts the snapshot and endpoint; other protocols are unavailable. DNS/IP validation covers IPv6, mapped/private/metadata/reserved targets and mixed DNS answers. HTTPS connects to the validated IP with original Host/SNI, fixed path, certificate checks, fresh socket and no redirects/retries/proxy fallback.
- Credential connection service with authenticated TLS/Origin/owner gate before body reading; redacted status; AES-256-GCM ciphertext bound to tenant/ID/revision/provider/destination; server environment/secret references; CAS rotation/deletion; stale worker-handle rejection. PostgreSQL repository uses Task 05's authorization **transaction** for the actual CAS, not an earlier authorization boolean. No raw-key read endpoint or client integration was added.
- Existing E1 hooks implemented with durable per-call intent, one-winner dispatch, model/context bounds, full pinned price snapshot/hash, per-component integer rounding, call/repair caps, retained unknown charges, scoped/deduplicated late settlement and no automatic paid fallback. PostgreSQL adapter uses the existing E1 accounting tables. Its additive SQL is a **proposal outside engine/migrations**, not an applied production schema or alternate ledger.
- Structured source-stage composition validates batches, writes immutable candidates/diffs and returns all repairs for fenced new-review adoption. Tests bind output to raw/source/diff hashes and preserve fixture provenance. No runner result or stage-origin literal was widened.

[Module and integration guide](../../../engine/providers/README.md) documents concrete contracts, key handling, supported protocol, pricing/uncertainty limits, lock requirements and live inputs. [SQL proposal](../../../engine/providers/proposals/0005-byok.sql) is assigned to Task 01's reserved 0005 namespace. Task 05's `withAuthorization(request, action)` seam from [draft PR #11](https://github.com/shellcat-com/forge-ai/pull/11), commit `c4236ba025fa53583db71b1c1e1b4c87de552664`, is structurally consumed; Task 06's 32-byte key resolver convention is compatible and kept in a separate credential encryption domain.

## Verification and evidence

Runtime: macOS; **observed Node 25.8.1**, npm 11.11.0, native PostgreSQL 14.18. Although `/opt/homebrew/opt/node@24/bin` was prepended, invoking that exact binary reported v25.8.1 during the final runtime audit; these local checks are not pinned Node 24 evidence. Supporting local checks reuse a **read-only symlink** to Task 01's frozen `node_modules` with the same lockfile; no npm install/ci or dependency mutation occurred through it. This is not clean-install reproduction. Clean GitHub CI is reported separately.

The initial targeted transport/credential/accounting run passed 92 tests; initial native PostgreSQL run failed on a synthetic seed UUID/text cast, which was fixed. The next targeted run passed 96 tests including all four native scenarios. A later final native setup hit `ENOSPC` before assertions (97 other targeted tests passed, four native cases skipped due to failed setup); this is a failed setup, not four passes. Task 01 coordinated owners' disposable-output cleanup, leaving shared dependencies untouched. An initial full `npm run verify` then passed lint, both strict typechecks, 653 tests / four optional skips and the Next.js production build. Final checks after cache/tier uncertainty and binding hardening are recorded below.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run verify` | PASS: lint, both strict checks, **655 passed / 4 optional skipped**, Next.js production build | [Final local log](../evidence/task-04/verify.log) |
| `npm run test:db:control` | PASS: **45** native constraint/RLS assertions, rolled back | [Control DB log](../evidence/task-04/control-db.log) |
| `npm run control:build` | PASS: standalone trusted-service TypeScript build | [Build log](../evidence/task-04/control-build.log) |
| Final SQL compatibility followup: `npx vitest run tests/engine/byok.native.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile.json=docs/reports/evidence/task-04/native-tests.json` | PASS: **5 native tests**, no skips, including legacy fixture uniqueness and multiple numbered calls | [Native log](../evidence/task-04/native-tests.log), [machine results](../evidence/task-04/native-tests.json) |
| Final owned diff and secret review | Whitespace and Gitleaks checked; exact result in manifest | [Manifest](../evidence/task-04/manifest.json) |
| GitHub clean Node 24.20.0 CI | PASS on source head `641ad33`: `npm ci`, lint, both typechecks, **704 tests / 5 optional skips**, build, 45 native control assertions and standalone control build | [Run 34438040481](https://github.com/shellcat-com/forge-ai/actions/runs/34438040481), [CI record](../evidence/task-04/ci-source.json) |

The full verification preceded Task 01's final partial-index request. Only the proposal index and its native regression test changed afterward; the focused five-test native run passed that final SQL. The final PR CI covers the combined head. CI tested GitHub's PR merge with the advancing Task 01 baseline, so its larger test count includes newer baseline/identity tests and one additional optional skip; it is not the standalone Task 04 denominator. The subsequent report/evidence commit changes no implementation; its final-head CI remains visible in [draft PR #15](https://github.com/shellcat-com/forge-ai/pull/15). One native lock acquisition yielded without starting tests; it was retried only after the prior owner released the lock.

The final evidence manifest hashes owned source/test/SQL files and captured logs. Committed terminal logs normalize carriage returns/trailing whitespace and blank outer lines; raw capture hashes are retained in the manifest, and local raw captures remain in `/tmp/forge-task04-raw-logs`. No test result text is removed. Logs contain synthetic rows/keys or no credentials. Gitleaks found zero issues before the checksum manifest was added, then flagged two generic-api-key patterns in the final diff: both were verified SHA-256 file checksums for the credential source modules. They contain no credentials; no scanner suppression was added. The secret review checks the exact owned diff; unrelated baseline fixture findings are not silently attributed to this task.

Native scenarios: eight concurrent calls competing for one admitted job envelope; six duplicate reservations and dispatches with one winner; six identical late settlements with one ledger entry; unknown liability retained at cancellation/lease loss; stale epochs and call/repair caps; conflicting terms/usage rejected; forced tenant RLS; concurrent credential rotation; deleted ciphertext tombstone; revoked session cannot commit a credential CAS. These exercise actual PostgreSQL transactions under non-owner roles with **synthetic authorization/dispatch gates and quotas**. They do not prove production global-budget admission, real two-user hosted identity, DNS egress containment or provider charging.

Mocked/synthetic scenarios additionally cover invalid credentials, unsupported provider/protocol/capability, malicious endpoints and mixed DNS, socket DNS pinning/redirect refusal, truncation/refusal/tool/malformed responses, 429/503, timeout/cancellation, token bounds/price expiry, missing/cached/tier usage, key echoes/context leakage, tampered ciphertext/AAD, immutable source/diff hashes and two bounded repairs. There are no live source hashes or usage receipts in this report; synthetic hashes are test integrity evidence only.

No UI/route was changed or mounted, so browser/light-dark/viewport/focus/zoom checks are **not run for Task 04**. Protected hosted connection/browser acceptance awaits Tasks 01/05/08; no inherited browser evidence is relabeled. The required generated stack and existing Next.js application remain unchanged.

## Reproduction

Use a fresh clone/worktree and Node 24.20.0, npm 11.11.0, native PostgreSQL binaries on PATH; run as a non-root user. No environment files or provider credentials are needed. A clean checkout should use its own install:

```sh
npm ci
npm run verify
npm run test:db:control
npm run control:build
npx vitest run tests/engine/byok.test.ts tests/engine/byok-transport.test.ts tests/engine/byok.native.test.ts tests/engine/e2-generation.test.ts
```

Native tests bootstrap and remove their own Unix-socket-only cluster. They explicitly apply the proposal to that disposable E1 database. Do not run the proposal against a configured deployment. For parallel local tasks, acquire `/tmp/forge-native-verification.lock` atomically, identify the owning PID, and remove only the lock this task acquired after cleanup. The final local verification ran under this convention.

## Open blockers and exact remaining input

1. **Task 01 integration:** publish reviewed 0005 after Task 05's 0004, implement the live `CallDispatchGate` and immutable job policy/credential revision checks, globally reserve job budgets, update reserved/dispatched/unknown cleanup and global settlement/release, events/audited invoice adjustments, and adopt real source through a reviewed live stage contract. The existing fixture-only worker remains default. Applying this SQL proposal alone is insufficient.
2. **Tasks 05/06/08 hosted flow:** integrate real transactional owner/session/CSRF/freshness authorization with a trusted HTTPS listener/proxy and small unlogged body route; configure persistent credential storage and retained KMS/key versions; expose the redacted connection UI. Prove two-user access/revocation and deployment backup/deletion retention. No route, KMS service, live identity or hosting access is inferred from local modules.
3. **D3/D4 live input:** exact entitled `gpt-4.1-2025-04-14` account/endpoint, protected server key reference or hosted connection, approved dated prices/token overhead/account capacity, and explicit numeric job/workspace/global/total-test budget. Current authorized paid spend is **$0**. The candidate byte/framing bound and published prices are not a live account acceptance. Cache/tier discounts not representable by Provider v1 retain liability pending reviewed reconciliation rather than booking an inaccurate cost.
4. **Task 08 final demonstration:** once the above and runtime/template/private-preview dependencies are accepted, produce real portfolio source, capture its actual hashes/usage, and deploy/review on Vercel's provided HTTPS domain. No domain purchase. This task has no live provider generation, verified portfolio, containment or public multi-user readiness claim.

[PR #15](https://github.com/shellcat-com/forge-ai/pull/15) is published against `codex/demo-delivery-baseline` and remains draft until dependencies and live acceptance are resolved. Do not merge or force-push it.
