# Task 08 — Prepare a truthful real-app demo recording

Own the reproducible demonstration scenario, browser evidence and recording guide. This task prepares for the user's recording; do not record/post a video or post to LinkedIn unless separately requested. Do not create another portfolio instead of demonstrating Forge.

Use the deployed Forge URL from Task 07. With an authorized synthetic test account, securely connect a real supported user provider key and choose a model. Keep actual credentials out of visible recordings and screenshots. Use a simple timer or task app that fits the supported stack and can generate reliably within the approved live-call budget. Do not substitute a prebuilt or fixture app.

Rehearse the entire actual flow: open Forge → sign in → connect/select provider/model → describe the app → review and approve source → isolated build → open private preview → request a visible edit → review/approve and verify it → click Publish → open the generated app's public URL in a separate unauthenticated session. Confirm the recording starts from Forge and ends at the actual published app.

Capture sanitized commit/deployment IDs, timestamps, provider request references, source hashes, build results and public URL checks. Distinguish new app generation from replaying a previously completed run. Show real failures/retries honestly; never replace a long build with fake progress. If editing footage later, label time compression where it matters.

Also verify a PostgreSQL-backed example persists data after app restart before making full-stack claims. A timer-only demo proves that narrower flow, not arbitrary applications or complete platform maturity.

Write a short recording script/shot list, clean-start/rehearsal instructions, expected timings measured from real runs, recovery steps, limitations to disclose and an optional LinkedIn caption that links to Forge itself. A generated-app URL can be a secondary proof link. Use synthetic names/data and a safe key-connection screen; do not display tokens or account secrets.

Exit: a reproducible real demonstration ready for the user to record, with actual public Forge and generated-app URLs. If a dependency blocks the rehearsal, prepare the script but explicitly mark recording readiness blocked. Report in docs/reports/forge-release/08-demo.md.

## Shared requirements — apply to this task

The deliverable is Forge AI itself, publicly hosted on Vercel and ready for a truthful recorded app-building demonstration. Generated applications also need their own in-product Publish flow and public URLs. Do not substitute publishing a portfolio for publishing Forge. No custom-domain purchase is requested.

Users can self-host the open-source project or use hosted Forge with their own provider API keys. Implement tested provider/model adapters, not an unsupported promise that every model or application stack works. Keep Next.js + strict TypeScript + PostgreSQL as the first supported generated stack; preserve Forge's existing frontend unless an approved change requires otherwise. BYOK does not require selling credits, a subscription, payment checkout or a Forge model-billing system. Preserve abuse limits and bounded usage; provider credentials are not hosting credentials.

First read AGENTS.md, README.md, docs/architecture.md, docs/security-model.md, docs/provider-integration.md, docs/rfcs/0001-app-generation-vertical-slice.md, docs/reports/e0-contracts.md, docs/reports/e1-control.md, docs/reports/e2-e5-checkpoint.md, docs/reports/engine-decisions.md and newer relevant reports/code. Treat historical checkpoint counts as historical, not current verification. Inspect existing branches/PRs and reuse completed implementations. Read authoritative repository skills before UI/preset changes. Public publishing changes previously deferred RFC scope: record the amendment without silently relaxing security gates.

Use an isolated worktree and your own codex/ branch from Task 01's recorded baseline. Before that baseline is known, limit work to read-only inventory/design. Task 01 owns shared contracts, migration allocation, root manifests/lockfiles and integration staging. Task 04 owns shared Forge UI integration; send other tasks' UI changes through that owner. Never edit another task's checkout or overwrite concurrent changes. Record actual dependencies and agreed interfaces in docs/operations/forge-release-coordination.md; use your own report under docs/reports/forge-release/ for progress. Do not run duplicate workers on the same scope.

Complete and verify all independent work in your scope. Use additive migrations and ephemeral native PostgreSQL with synthetic data for database tests. Run npm run verify and relevant native-database/browser/security tests; for visual changes check both themes at 390/768/1440, keyboard focus, zoom and reduced motion. Record exact commands, versions, results, reproduction from a clean checkout and evidence bound to the tested commit. Distinguish fixtures, local real integrations, deployed live tests, skips and blockers. Never use a fixture to pass a live acceptance gate.

Do not expose keys in client bundles, browser persistence, generated files, logs, screenshots, exports, public environment variables, commits or PRs. Use approved secret injection. User-entered keys travel only through authenticated TLS to tenant-scoped server handling. Never run generated code on the developer host/control plane or downgrade the approved sandbox. Do not infer approval of unresolved D1–D8 choices. No new paid services, purchases or billable test calls without an applicable explicit budget. Lack of access blocks the affected live step, not independent implementation. Do not claim unlimited scale, completion percentages or a deadline without evidence.

You are authorized to commit your owned changes, push your branch to the verified origin for shellcat-com/forge-ai, and open or update one GitHub PR for this task. Name its correct base and dependencies; use a draft PR if dependencies or live acceptance remain blocked. Include reproduction commands, tests, residual limitations and evidence. Check CI and fix attributable failures. Do not merge, force-push, close others' PRs, or commit credentials, private data or unreviewed artifacts. If GitHub access is unavailable, finish the local commit and provide exact push/PR instructions without claiming upload succeeded.

Inspect the final diff, commit only owned files, and return your commit SHA, PR URL (only if created), base/dependencies, exact reproduction commands, evidence and remaining user inputs. Missing credentials must be requested by secret-reference/configuration name, never by asking the user to paste secrets into chat.

