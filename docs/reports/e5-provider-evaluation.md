# Provider quality evaluation: offline implementation

Status: offline harness implemented; **A04/A22 live acceptance remains blocked**. No provider request, credential lookup, account operation, execution, purchase or spending authorization occurs in this module. E1 accounting/control and existing readiness calculations are unchanged. Owned files are `engine/operations/provider-evaluation.ts`, its dedicated test and this report.

## Inputs, evidence and metrics

`providerReferenceCorpus()` returns a frozen six-case proposal: basic and keyboard task boards; priority filtering and sorting changes against a verified task-board base; Pomodoro session history and daily totals. Every case has exact instruction bytes and an explicit base requirement. Priority cases bind to the corresponding basic/keyboard board candidate from the same repetition; missing, failed or unrelated bases fail validation. Five independently recorded repetitions per case produce 30 scheduled slots. Hash the whole corpus with E0 `canonicalHash`; changed wording, case selection or repetitions must be recorded rather than silently substituting a different campaign.

`providerEvaluationSchema` binds campaign times, expiry, origin, corpus, scheduled repetitions, price record, approved model envelope and per-job ceiling. Every run repeats exact provider/model-snapshot, adapter, endpoint, prompt, model-policy, template, image, command-policy, scanner-policy and price pins. It records one unique slot/run ID; all dispatched call IDs, stages, input/output token bounds, maximum reservations and measured/estimated/uncertain usage; repair count; terminal outcome and safe failure-code enum; active time; structured-source result and candidate/base digests; all 14 mandatory check results; promotion; and optional source-export evidence.

Mixed fixture/live origins, changed pins/corpus, duplicate slots/run/call IDs, unknown cases, unplanned repetitions, inconsistent export/candidate origins and missing/duplicate mandatory checks are rejected with fixed `INVALID_PROVIDER_EVALUATION`. Repair/call overruns remain in the report as violations and effective failures, rather than disappearing from the denominator. A denied admission must have no calls, candidate, export, promotion or claimed checks.

`evaluateProviderEvidence(input, {now?, reader?, signal?})` is offline and unverified by default. No reader is instantiated or discovered automatically. Supplied `origin: live` labels cannot meet acceptance thresholds. A separately injected `ProviderEvidenceReader` may read captured receipts from a trusted evidence store; the evaluator requires authenticated, unrevoked, unexpired matching provenance, reads at most 1 MiB per receipt, hashes the exact bytes and compares the parsed run to the campaign. The read phase has a 60-second aggregate cancellation deadline, including readers that ignore AbortSignal. There is no automatic retry.

The reader is an explicit trust boundary: its implementation must verify original producer signatures/attestation, ownership, underlying provider requests/usage, immutable source/verification/export artifacts, and revocation. A JSON digest or self-declared `authenticated: true` is not independently sufficient. This module validates receipt binding and computes metrics; it does not independently run the underlying application, inspect a cloud account or verify a provider invoice. Tests use synthetic reader responses, including simulated `live` labels, solely to exercise this contract.

Returned metrics contain digests and aggregate measurements, not prompt/source/response bodies:

- Full planned/reported/not-run/admitted/dispatched/denied counts; outcome counts; admitted-demand ratio; per-case coverage. Missing slots and zero-dispatch failures remain visible. At least 30 dispatched runs and five admitted runs per case are required for a complete proposed A22 campaign.
- Effective structured-source, complete-build and export successes; build success rate and Wilson 95% interval; unsafe promotions and policy/budget/repair violations. Failures, timeouts and cancellations remain in the admitted denominator.
- p50/p95 active latency including failures/timeouts, with measured and missing sample counts. These measurements do not claim API/preview/runner capacity; the existing operational campaign remains a separate test.
- Exact integer observed charges and maximum remaining liability; unknown calls/runs; fully measured cost count and p50/p95 cost distribution. Estimated/uncertain/missing tokens or charge retain at least the full relevant attempt reservation, even if the reported charge is zero. Unknown-cost runs cannot satisfy evidence gates. Oversized token use, under-reservation, overcharge and per-job/envelope violations block gates.

`a22EvidenceMeetsTargets` requires fresh authenticated captured **live** receipts, complete corpus coverage, at least 30 dispatched runs, ≥90% complete builds within two repairs/12 calls, no unsafe promotion, known accounting and a respected envelope. `a04EvidenceComplete` is deliberately stronger than an isolated export check: every admitted benchmark run must have a passing build and source-only, secret-scan, clean-environment, lockfile-install, PostgreSQL-migration, build and HTTP-run export results bound to its candidate/archive. A scanned ZIP alone cannot pass A04. Actual export sample counts remain reported.

Both results always return `releaseReady: false` and `dispatchAuthorized: false`. They never mint the release-evidence format expected by the template activation gate. D1–D8 closure, real isolation, browser evidence, independently verified receipts and operator approval remain separate.

## D3/D4 proposal, not authorization

The coordinator-owned D3 proposal remains OpenAI `gpt-4.1-2025-04-14` in `docs/reports/engine-decisions.md`; this harness does not replace it. Candidate for its explicitly approved future evaluation: `gpt-4.1-2025-04-14`, fixed `https://api.openai.com/v1/chat/completions`, nonstreaming JSON-object output with the existing runtime schema/proposal checks. Official documentation currently lists that snapshot, Chat Completions support and uncached prices of $2 input / $8 output per million tokens. This is a candidate to evaluate, not an entitlement or quality claim. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-4.1).

Required owner choices/access before any paid run:

1. Exact entitled account/project/model snapshot and endpoint; server-only secret-manager location and worker identity; approved data residency/retention; account RPM/TPM/concurrency and daily caps; output/cancellation/error semantics for that entitlement. Keep the NVIDIA planning endpoint separate. No fallback model or endpoint is inferred.
2. A dated, expiring price record, currency, all billable categories and rounding rules, provider framing/hidden token bounds, pricing-source digest and billing reconciliation access. Operator evidence must establish the bound on **all** billable input/output tokens. Context UTF-8 bytes alone do not establish that bound.
3. A separately approved model spend envelope, workspace/day and global/day caps, per-job ceiling, per-dispatch reservation, and separate infrastructure budget. A proposed $5/job / $150 maximum for 30 benchmark slots is a ceiling proposal only; daily caps and campaign scheduling must be compatible and explicitly approved. No API call is authorized by these numbers.
4. Frozen corpus/template/preset/image/prompt/adapter/model-policy/price/scanner pins, approved base snapshots for priority cases, every attempt retained (including denied/failed/cancelled), independent repeated jobs and isolated checks. Measure token/cost/latency distributions and errors first; choose lower admission concurrency than the actual contracted limits permit.

`quoteProviderReservation(price, inputBound, outputBound, now)` performs BigInt arithmetic only. It separately rounds input and output charges upward to integer USD microdollars, adds a fixed per-request charge, rejects stale/not-yet-effective prices and returns `dispatchAuthorized: false`. With an **operator-proven total** 65,536 input / 8,192 output bound and the candidate's published uncached prices, the conservative separately rounded proposal is 196,608 microdollars per attempt and 2,359,296 across twelve attempts. These are calculations, not measured bills, guarantees or approved spending. GPT-4.1 mini is only an unselected comparison option; the generic arithmetic tests include synthetic price records and do not select a model.

E1 must still transactionally reserve the real maximum before every actual call, bind the exact lease/context/price, enforce the job/workspace/global envelopes and ≤12 calls, retain uncertain liability and deduplicate settlement. This harness neither writes those records nor fixes E1's current fixture-only one-attempt-per-stage seam; live multi-batch/repair accounting needs its separately reviewed interface before enabling a provider.

## E2 inspection and remaining risks

The existing adapter uses one operator-approved HTTPS endpoint, disables redirects/tool calls/streaming/fallback/retries, bounds decoded JSON and validates source schemas. Credential presence checks make no remote verification call. Context binds exact admitted instruction bytes, server-owned preset/template/policy and hash-checked source; output policy rejects unowned/protected paths and append-only migration violations.

Remaining live gates are substantive: current account entitlement and RPM/TPM are unknown; model-specific billable framing/output bounds are not proven by the adapter's UTF-8 context guard; JSON-object capability does not guarantee schema/content correctness; exact live refusal/truncation/cancellation/usage behavior has only injected transport evidence; no selected model has completed the frozen corpus. Real export install/migrate/run, signed runner checks, source quality, repair success, provider rate capacity and costs remain unmeasured. Heuristic scanning cannot prove absence of unknown or obfuscated secrets. No successful synthetic transport, candidate source or captured label closes these gates.

## Verification and restart

Run:

```sh
npx vitest run tests/engine/provider-evaluation.test.ts
npx tsc -p tsconfig.engine.json --pretty false
npx eslint engine/operations/provider-evaluation.ts tests/engine/provider-evaluation.test.ts
```

The dedicated synthetic suite covers offline default behavior, fixture/live separation, trusted-receipt validation, exact pins, missing/failure/denial denominators, repair/call overrun retention, unknown-liability conservation, incomplete A04 evidence, forged/revoked/expired receipts, no-dispatch counting, duplicate evidence, exact large integer costs and a stalled evidence-reader deadline. **16 tests passed; strict engine TypeScript and targeted ESLint passed.** No browser flow changed; the coordinator owns final repository/browser verification.

To resume, inspect this frozen proposal with the maintainer, obtain D3/D4 and runner/storage approvals, wire a trusted captured-evidence reader, and evaluate a separately authorized campaign. Do not call providers while merely loading or evaluating fixtures. D2/D5/D7 block real runner/storage/template portions of A04; D3/D4 and measured results block A22; D1/D6/D8 still block private-alpha release.
