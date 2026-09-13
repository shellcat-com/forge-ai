# Task 09 — Independent acceptance and open-source demo readiness

Own cross-cutting validation, the release evidence report and demo-readiness documentation. Do not duplicate implementation owned by Tasks 02–08; send findings to the owners, verify fixes and integrate only your scoped test/report changes.

Audit the final integrated commit against A01–A22 and the new BYOK/Vercel/demo requirements. Check that evidence binds to exact source/template/policy/runtime identities. Test provider errors and spending controls, identity/tenant isolation, sandbox abuse, preview revocation, worker/network failures, backup recovery, source restoration and clean export.

Run the required live reference corpus only with approved runtime/provider access and explicit spending limits. Retain failures and report sample size, latency and cost distribution. Run load tests within a declared affordable envelope; do not claim thousands/billions of concurrent builds from a calculator or unit tests.

Validate the published portfolio without a signed-in Vercel or Forge account, and reproduce a new generated app from a clean documented setup. Check owner-demo workflow and actual browser zoom/reduced-motion controls; distinguish simulations from native settings.

Audit the public repository/package/export for secrets, private logs, personal data, third-party asset provenance and missing licenses. Preserve the project's existing license unless the owner explicitly requests a change. Provide accurate README/setup instructions, supported-provider matrix, BYOK security/limitations, Vercel hosting boundaries, contributing guidance and known issues; coordinate shared README edits through Task 01.

Report separate outcomes for: code/test completion, first live demonstration, private-alpha acceptance, and production readiness. A successful video/portfolio does not imply all release gates pass. Do not mark blocked gates passed to meet today's deadline.

Report: docs/reports/demo-delivery/task-09-acceptance.md. Verify, commit your owned changes, push and open the validation PR with evidence and the exact remaining gates.

Execution and PR requirements:
Read AGENTS.md, RFC 0001, the E0/E1 and E2–E5 checkpoint reports, engine-decisions.md, current code, and docs/operations/demo-delivery-coordination.md if present. User requirements now include open-source BYOK, Vercel hosting, no purchased domain, and a real generated portfolio demonstration. Preserve the required Next.js + strict TypeScript + PostgreSQL engine path and existing work.

Work in your own codex/ branch and isolated worktree based on Task 01's published canonical commit. Before that commit exists, do read-only investigation and design preparation. Do not reconstruct a conflicting baseline or overwrite another session. Task 01 owns shared contracts, migration numbering, package manifests/lockfiles and architecture integration; coordinate shared edits through it. Follow repository skills for UI work.

Implement your assigned scope, reproduce it with meaningful tests, run npm run verify plus relevant native database/browser checks, inspect the final diff for secrets and unrelated changes, and document exact commands/results in your task report. Mark fixtures, simulations, skipped tests and live evidence separately.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

No new paid subscription, infrastructure purchase, or billable API run without an explicit applicable budget. BYOK does not establish spending authorization. Missing access blocks its integration, not independent implementation. Finish independent work, publish its accurately labeled PR, and report the specific remaining input. Do not claim 100% from fixtures. Return commit SHA, PR URL, reproduction steps, evidence and open blockers.

