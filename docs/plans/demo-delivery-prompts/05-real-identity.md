# Task 05 — Real identity and owner access

Own the engine identity adapter, real session integration and authentication tests within coordinated file boundaries. Preserve the current fixture identity as an explicit test-only composition.

Reconcile the existing Neon/cloud prototype with the canonical engine's OIDC, membership and session model. Do not operate two competing account authorities. Use an already approved/configured provider if one is documented; otherwise prepare a concrete provider configuration proposal while implementing vendor-independent code. Existing SDKs do not constitute a selection.

Complete invite/owner admission, OIDC authorization code + PKCE, opaque server sessions, exact issuer/audience/state/nonce validation, CSRF/Origin protection, expiry, logout and revocation. Add credential-connection authorization for Task 04 without handling provider secrets in unrelated identity code.

For the demonstration, support a real authenticated owner operating Forge. The public portfolio is viewable without a Forge account. Public anonymous access must not grant control API, generation or provider-key authority. Public multi-user registration is not necessary to record the owner demo.

Reproduce with two real test identities when access is available: login, denied foreign project/key access, roles, stale/expired sessions, logout, revoked membership, SSE revocation and preview authorization handoff. Include native PostgreSQL pooled-connection isolation tests and relevant browser flows.

Document setup with placeholder-only environment examples, account recovery/access limitations and the exact relationship to the prior prototype. Do not leave an HTTP fixture identity-minting route enabled. Report: docs/reports/demo-delivery/task-05-identity.md.

Execution and PR requirements:
Read AGENTS.md, RFC 0001, the E0/E1 and E2–E5 checkpoint reports, engine-decisions.md, current code, and docs/operations/demo-delivery-coordination.md if present. User requirements now include open-source BYOK, Vercel hosting, no purchased domain, and a real generated portfolio demonstration. Preserve the required Next.js + strict TypeScript + PostgreSQL engine path and existing work.

Work in your own codex/ branch and isolated worktree based on Task 01's published canonical commit. Before that commit exists, do read-only investigation and design preparation. Do not reconstruct a conflicting baseline or overwrite another session. Task 01 owns shared contracts, migration numbering, package manifests/lockfiles and architecture integration; coordinate shared edits through it. Follow repository skills for UI work.

Implement your assigned scope, reproduce it with meaningful tests, run npm run verify plus relevant native database/browser checks, inspect the final diff for secrets and unrelated changes, and document exact commands/results in your task report. Mark fixtures, simulations, skipped tests and live evidence separately.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

No new paid subscription, infrastructure purchase, or billable API run without an explicit applicable budget. BYOK does not establish spending authorization. Missing access blocks its integration, not independent implementation. Finish independent work, publish its accurately labeled PR, and report the specific remaining input. Do not claim 100% from fixtures. Return commit SHA, PR URL, reproduction steps, evidence and open blockers.

