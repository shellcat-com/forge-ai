# Task 06 — Persistence, Vercel control integration and backups

Own durable storage adapters, hosting configuration and operational persistence tests. Coordinate schema changes with Task 01, secret storage with Task 04, identity with Task 05, and deployment configuration with Task 08.

Vercel is selected for website hosting. Determine which existing API handlers can run there within current account/runtime constraints and which durable workers need an external process or an explicitly selected durable workflow service. Preserve PostgreSQL job state, leases, idempotency, restart recovery and SSE reconnect behavior. Never rely on a warm process or temporary filesystem for persistence.

Implement the selected control PostgreSQL and versioned object-storage adapters, least-privilege roles, encrypted secret references, object authorization/version integrity, retention, deletion and orphan cleanup. Preserve the boundary between Forge control data and generated-app data. Use existing approved services where compatible; do not silently buy database, KMS or storage services.

Prepare separate local/self-hosted and hosted setup instructions. Vercel frontend requests must not point to an inaccessible loopback backend. Configure exact trusted origins, HTTPS and server-only environment variables. Make unavailable worker/storage configuration explicit without falsely reporting readiness.

Reproduce database migration on disposable data, simultaneous jobs, artifact read/write across process restart, cross-tenant denial, version mismatch rejection, deletion and a backup restore into a separate target. Measure recovery time/data loss; do not call a local synthetic restore deployed backup acceptance.

Only configure/provision external resources under documented access and applicable budget. Coordinate deployment writes through Task 08. Report: docs/reports/demo-delivery/task-06-persistence.md.

Execution and PR requirements:
Read AGENTS.md, RFC 0001, the E0/E1 and E2–E5 checkpoint reports, engine-decisions.md, current code, and docs/operations/demo-delivery-coordination.md if present. User requirements now include open-source BYOK, Vercel hosting, no purchased domain, and a real generated portfolio demonstration. Preserve the required Next.js + strict TypeScript + PostgreSQL engine path and existing work.

Work in your own codex/ branch and isolated worktree based on Task 01's published canonical commit. Before that commit exists, do read-only investigation and design preparation. Do not reconstruct a conflicting baseline or overwrite another session. Task 01 owns shared contracts, migration numbering, package manifests/lockfiles and architecture integration; coordinate shared edits through it. Follow repository skills for UI work.

Implement your assigned scope, reproduce it with meaningful tests, run npm run verify plus relevant native database/browser checks, inspect the final diff for secrets and unrelated changes, and document exact commands/results in your task report. Mark fixtures, simulations, skipped tests and live evidence separately.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

No new paid subscription, infrastructure purchase, or billable API run without an explicit applicable budget. BYOK does not establish spending authorization. Missing access blocks its integration, not independent implementation. Finish independent work, publish its accurately labeled PR, and report the specific remaining input. Do not claim 100% from fixtures. Return commit SHA, PR URL, reproduction steps, evidence and open blockers.

