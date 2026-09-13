# Task 02 — Real isolated runtime

Own the missing execution implementation under the coordinator-assigned runner modules and their tests. Coordinate the image/toolchain contract with Task 03, control authorization with Task 01, and preview runtime contract with Task 07.

Inspect the current unavailable driver, broker/client, signatures, leases, tombstones and collector. Implement the actual LinuxExecutor, guest RPC, image launch and lifecycle integration against the selected runtime contract. Preserve authenticated descriptors, exact source/image hashes, deny-by-default networking, quotas, lease fencing, independent watchdog termination and bounded collection.

Vercel web hosting does not itself close D2. Evaluate the current Vercel Sandbox service as a possible managed adapter using official documentation if it can satisfy the required isolation/network/lifecycle controls; adopting it requires a documented architecture amendment and account/cost feasibility. Otherwise implement the dedicated Linux/KVM path. Do not silently substitute an ordinary host process, generic container or a Vercel Function for the required sandbox.

Implement app-local PostgreSQL credential provisioning, approved migration commands, build/test commands, isolated external test access and cleanup. Provider, control-database and deployment credentials must never enter generated-code execution.

Reproduce on the approved real runtime: signed launch, build, database readiness, app-process restart, cancellation, expired lease, delayed create/destroy, process/memory/disk exhaustion, blocked network destinations, neighbor responsiveness and resource cleanup. Bind evidence to exact image and source hashes.

Without real host/service access, finish driver code and local contract/fault tests, document the exact one-time host/access requirements, and keep live execution disabled. Do not record containment as passed. Report: docs/reports/demo-delivery/task-02-runtime.md.

Execution and PR requirements:
Read AGENTS.md, RFC 0001, the E0/E1 and E2–E5 checkpoint reports, engine-decisions.md, current code, and docs/operations/demo-delivery-coordination.md if present. User requirements now include open-source BYOK, Vercel hosting, no purchased domain, and a real generated portfolio demonstration. Preserve the required Next.js + strict TypeScript + PostgreSQL engine path and existing work.

Work in your own codex/ branch and isolated worktree based on Task 01's published canonical commit. Before that commit exists, do read-only investigation and design preparation. Do not reconstruct a conflicting baseline or overwrite another session. Task 01 owns shared contracts, migration numbering, package manifests/lockfiles and architecture integration; coordinate shared edits through it. Follow repository skills for UI work.

Implement your assigned scope, reproduce it with meaningful tests, run npm run verify plus relevant native database/browser checks, inspect the final diff for secrets and unrelated changes, and document exact commands/results in your task report. Mark fixtures, simulations, skipped tests and live evidence separately.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

No new paid subscription, infrastructure purchase, or billable API run without an explicit applicable budget. BYOK does not establish spending authorization. Missing access blocks its integration, not independent implementation. Finish independent work, publish its accurately labeled PR, and report the specific remaining input. Do not claim 100% from fixtures. Return commit SHA, PR URL, reproduction steps, evidence and open blockers.

