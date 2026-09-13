# Task 07 — Working private preview without buying a domain

Own the preview gateway, ticket/session lifecycle, routing and preview-browser tests. Task 02 owns environment execution, Task 05 identity, Task 06 durable storage, and Task 08 public demo deployment.

Implement actual atomic one-use ticket consumption through the canonical control service, exact environment-generation routing, private viewer authorization, expiry, renewal, revocation, unhealthy-runtime handling and cleanup. Do not stop at policy helpers.

The owner does not want to buy a domain now. Investigate default platform-generated HTTPS hostnames and a no-purchase private-preview arrangement. Verify browser site/origin boundaries, cookie scoping and provider protection with real browser tests; differing hostname strings alone are not evidence of isolation. Document an RFC amendment for any change from the original separate-site plan.

Never make the private gateway public just to obtain a convenient URL. Keep Forge cookies, BYOK credentials, database credentials and deployment tokens out of guest responses. A public portfolio deployment in Task 08 is a distinct, explicitly published artifact.

Reproduce authorized and unauthorized access, replayed/expired tickets, cross-tenant sessions, cookie collisions, CSRF, host manipulation, redirected upstreams, membership revocation, preview timeout and stale environment routing. Run real generated-app readiness and app-process restart tests with Task 02 once available.

If the selected free/default hostname arrangement cannot satisfy the boundary, complete gateway code and tests, report the exact missing capability, and offer a no-purchase alternative for review. Do not fabricate a working private preview URL. Report: docs/reports/demo-delivery/task-07-preview.md.

Execution and PR requirements:
Read AGENTS.md, RFC 0001, the E0/E1 and E2–E5 checkpoint reports, engine-decisions.md, current code, and docs/operations/demo-delivery-coordination.md if present. User requirements now include open-source BYOK, Vercel hosting, no purchased domain, and a real generated portfolio demonstration. Preserve the required Next.js + strict TypeScript + PostgreSQL engine path and existing work.

Work in your own codex/ branch and isolated worktree based on Task 01's published canonical commit. Before that commit exists, do read-only investigation and design preparation. Do not reconstruct a conflicting baseline or overwrite another session. Task 01 owns shared contracts, migration numbering, package manifests/lockfiles and architecture integration; coordinate shared edits through it. Follow repository skills for UI work.

Implement your assigned scope, reproduce it with meaningful tests, run npm run verify plus relevant native database/browser checks, inspect the final diff for secrets and unrelated changes, and document exact commands/results in your task report. Mark fixtures, simulations, skipped tests and live evidence separately.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

No new paid subscription, infrastructure purchase, or billable API run without an explicit applicable budget. BYOK does not establish spending authorization. Missing access blocks its integration, not independent implementation. Finish independent work, publish its accurately labeled PR, and report the specific remaining input. Do not claim 100% from fixtures. Return commit SHA, PR URL, reproduction steps, evidence and open blockers.

