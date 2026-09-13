# Task 05 — Production identity, durable data and backend operations

Own real identity/session composition, control-service persistence, artifacts/secrets integration and operational lifecycle. Reuse E1 transactional behavior and native-PostgreSQL migrations; coordinate new shared contracts/migrations with Task 01. Task 07 owns deployment of Forge's Vercel project.

Finish integration of the approved identity provider with sessions, CSRF protection, authorization, invite/public-signup policy, tenant membership, logout and revocation. Never expose a fixture identity adapter or trust browser-local project state on the public service. Public access to Forge's landing page does not grant anonymous generation authority.

Use approved durable PostgreSQL and object storage with tenant authorization, immutable version references, optimistic revisions, private access, encryption/key rotation and defined retention. Integrate durable jobs, quotas, leases, heartbeats, usage records, SSE replay and reconciliation in the selected hosting topology. Do not rely on process memory or ephemeral function disks for durable state.

Keep control data separate from generated apps' databases and untrusted workloads. Define app database provisioning/credentials/backup ownership with Task 06, which owns public app publishing. Implement permitted cleanup/deletion workflows without deleting active publications or user data implicitly. Verify RLS with actual unprivileged roles.

Prepare least-privilege service configuration, health/readiness endpoints, redacted telemetry, rate limits, queue backpressure, backup/restore and rollback procedures. Test concurrent admissions, duplicate requests, restart/recovery, lease expiry, fencing, cancellation/promotion races and SSE reconnect/revocation using ephemeral native PostgreSQL.

If approved hosted access exists, verify deployed connectivity, two actual users, stored projects after restart and a scoped synthetic restore drill. Never run destructive restore/fault tests on shared production data.

Exit: public Forge can authenticate real users and safely persist projects/jobs/artifacts across service restarts, with reproducible operations. Otherwise finish adapters and report the exact missing deployment/access gate. Report in docs/reports/forge-release/05-backend.md.

## Shared requirements — apply to this task

The deliverable is Forge AI itself, publicly hosted on Vercel and ready for a truthful recorded app-building demonstration. Generated applications also need their own in-product Publish flow and public URLs. Do not substitute publishing a portfolio for publishing Forge. No custom-domain purchase is requested.

Users can self-host the open-source project or use hosted Forge with their own provider API keys. Implement tested provider/model adapters, not an unsupported promise that every model or application stack works. Keep Next.js + strict TypeScript + PostgreSQL as the first supported generated stack; preserve Forge's existing frontend unless an approved change requires otherwise. BYOK does not require selling credits, a subscription, payment checkout or a Forge model-billing system. Preserve abuse limits and bounded usage; provider credentials are not hosting credentials.

First read AGENTS.md, README.md, docs/architecture.md, docs/security-model.md, docs/provider-integration.md, docs/rfcs/0001-app-generation-vertical-slice.md, docs/reports/e0-contracts.md, docs/reports/e1-control.md, docs/reports/e2-e5-checkpoint.md, docs/reports/engine-decisions.md and newer relevant reports/code. Treat historical checkpoint counts as historical, not current verification. Inspect existing branches/PRs and reuse completed implementations. Read authoritative repository skills before UI/preset changes. Public publishing changes previously deferred RFC scope: record the amendment without silently relaxing security gates.

Use an isolated worktree and your own codex/ branch from Task 01's recorded baseline. Before that baseline is known, limit work to read-only inventory/design. Task 01 owns shared contracts, migration allocation, root manifests/lockfiles and integration staging. Task 04 owns shared Forge UI integration; send other tasks' UI changes through that owner. Never edit another task's checkout or overwrite concurrent changes. Record actual dependencies and agreed interfaces in docs/operations/forge-release-coordination.md; use your own report under docs/reports/forge-release/ for progress. Do not run duplicate workers on the same scope.

Complete and verify all independent work in your scope. Use additive migrations and ephemeral native PostgreSQL with synthetic data for database tests. Run npm run verify and relevant native-database/browser/security tests; for visual changes check both themes at 390/768/1440, keyboard focus, zoom and reduced motion. Record exact commands, versions, results, reproduction from a clean checkout and evidence bound to the tested commit. Distinguish fixtures, local real integrations, deployed live tests, skips and blockers. Never use a fixture to pass a live acceptance gate.

Do not expose keys in client bundles, browser persistence, generated files, logs, screenshots, exports, public environment variables, commits or PRs. Use approved secret injection. User-entered keys travel only through authenticated TLS to tenant-scoped server handling. Never run generated code on the developer host/control plane or downgrade the approved sandbox. Do not infer approval of unresolved D1–D8 choices. No new paid services, purchases or billable test calls without an applicable explicit budget. Lack of access blocks the affected live step, not independent implementation. Do not claim unlimited scale, completion percentages or a deadline without evidence.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

Inspect the final diff, commit only owned files, and return your commit SHA, PR URL (only if created), base/dependencies, exact reproduction commands, evidence and remaining user inputs. Missing credentials must be requested by secret-reference/configuration name, never by asking the user to paste secrets into chat.

