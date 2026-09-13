# Task 04 — BYOK, real generation and per-call accounting

Own provider/credential interfaces, source-generation adapters and their tests. Task 01 owns shared control/accounting migrations; submit narrowly scoped changes for coordinated integration. Task 05 owns identity and authorization.

Implement BYOK as a real product feature. Use a provider registry with explicit capability checks and modular adapters. Start with one verified end-to-end adapter and an OpenAI-compatible transport; add additional provider protocols only when implemented and tested. Never advertise arbitrary providers as universally compatible.

For self-hosted use, support server environment/secret references. For hosted users, implement a protected credential connection flow with encryption at rest, tenant scoping, rotation, deletion and redacted status. Keys must not enter localStorage, source exports, generated apps, previews, logs, telemetry or public environment variables. Raw keys may be submitted only over authenticated TLS and must not be returned by read endpoints.

Arbitrary user-supplied base URLs are an SSRF boundary: administrator policies must restrict destinations, validate DNS/IPs including IPv6, block private/metadata targets and redirects, and bind each credential to its exact provider destination. Unsupported endpoints remain unavailable.

Connect real structured file generation and bounded repairs to the E1 durable job/accounting seams. Add per-call reservations, model-specific token upper bounds, exact price-version handling, uncertain-charge retention, deduplicated settlement and no automatic paid fallback. A user key does not make calls free; require an explicit budget for live tests.

Test invalid credentials, unsupported capabilities, malicious endpoints, truncation/refusal/429/timeouts, cancellation, leakage, concurrent quota races and unknown charges. With authorized credentials/budget, generate real source and record its hashes/usage; Task 08 owns the final demonstration. Without access, finish implementation and leave live acceptance blocked. Report: docs/reports/demo-delivery/task-04-byok.md.

Execution and PR requirements:
Read AGENTS.md, RFC 0001, the E0/E1 and E2–E5 checkpoint reports, engine-decisions.md, current code, and docs/operations/demo-delivery-coordination.md if present. User requirements now include open-source BYOK, Vercel hosting, no purchased domain, and a real generated portfolio demonstration. Preserve the required Next.js + strict TypeScript + PostgreSQL engine path and existing work.

Work in your own codex/ branch and isolated worktree based on Task 01's published canonical commit. Before that commit exists, do read-only investigation and design preparation. Do not reconstruct a conflicting baseline or overwrite another session. Task 01 owns shared contracts, migration numbering, package manifests/lockfiles and architecture integration; coordinate shared edits through it. Follow repository skills for UI work.

Implement your assigned scope, reproduce it with meaningful tests, run npm run verify plus relevant native database/browser checks, inspect the final diff for secrets and unrelated changes, and document exact commands/results in your task report. Mark fixtures, simulations, skipped tests and live evidence separately.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

No new paid subscription, infrastructure purchase, or billable API run without an explicit applicable budget. BYOK does not establish spending authorization. Missing access blocks its integration, not independent implementation. Finish independent work, publish its accurately labeled PR, and report the specific remaining input. Do not claim 100% from fixtures. Return commit SHA, PR URL, reproduction steps, evidence and open blockers.

