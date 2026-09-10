# Unified builder implementation status

September 9, 2026. This is an implementation checkpoint, **not a hosted-beta completion claim**. Work resumes the existing `codex/forge-unified` integration rather than replacing either foundation.

## Implemented

- One Next.js application with the approved neutral Forge appearance, original artwork, both themes, public pages, documentation, five optional examples and downloads. Canonical workspace routes and legacy hash/query compatibility.
- Prompt-first Home, automatic project naming, editable names, four modes, written design direction, optional example, persisted composer, recent projects, indexed search, owned/shared/starred/archived filters, sorting and grid/list views.
- Responsive workbench with conversation, saved events, stop, preview sizes, independent preview origin, Monaco recovery buffers, stale-revision protection, history, source export and independent remix. Mobile Chat/Preview/Tools and saved panel/file/viewport preferences.
- Expanded bounded file operations for nested pages, components and server routes; relevant source selection; isolated Docker builds; up to two targeted build repairs; cancellation checks and promotion checks. Planning modes allocate no build sandbox.
- Better Auth server/Drizzle integration, invitation gating, conditional email/OAuth/dashboard configuration, sign-in/sign-out/recovery UI, ownership and viewer/commenter permissions. Existing-account sharing, revocation and revision comments have server checks. Hosted private previews remain disabled pending the authenticated preview adapter.
- Five-project, one-active-owner-job and ten-daily-request caps, with visible request allowance. Restoring source does not consume generation allowance. This is request counting, not the planned monetary reservation ledger; hosted generation remains disabled.
- Additive local migrations and explicit owner assignment. Imported two original engine projects, preserving their IDs and 12 revisions, 16 jobs and 352 events; verified source content. Source database unchanged. Browser JSON import preserves original backups and creates archived drafts.

## Verified evidence

- `npm run verify`: lint, strict TypeScript, 92 tests including retained NVIDIA planning tests, and production Next.js build pass.
- Browser foundation/provider suite: 15 pass; one live Ollama test intentionally skipped. Workbench suite: eight pass. Captures at 375/390/768/1440 widths as applicable, light/dark, keyboard skip link, reduced-motion workbench, custom direction, mode/draft preservation, imported history, editor-buffer recovery and legacy routes.
- Real local PostgreSQL tests pass concurrent idempotency, project ownership, active-job limits, stale revision rejection and reviewer revocation.
- Better Auth integration test passes invitation gate, verification, sign-in, stored session and sign-out. Test email delivery is stubbed; live email/OAuth/dashboard verification is not claimed.
- Live Groq/Docker Pomodoro: one generated candidate repaired a module-resolution error and reached a working preview. Start, countdown, Pause and settings were exercised in Brave. Earlier provider/build failures remain visible. A later refinement failed at the provider and preserved the working revision. Controlled-clock acceptance: Start/Pause/Resume/Reset passed. Duration persistence after reload and automatic break countdown failed. Focus-to-break mode transition and session counting were observed during that test. Dialog keyboard behavior remains unverified; this is not a passed full Pomodoro benchmark.
- Request quota rejection observed. Further model-backed evaluation was stopped at the configured cap. No 30-run acceptance result or latency percentile is claimed.

Actual Forge screenshots are in `docs/evidence/unified`. No continuous recording was made for this checkpoint. Historical engine evidence remains outside that subdirectory and must not be presented as current. Competitor material remains private in the original research archive.

## Cloud status

See [sanitized cloud setup record](cloud-setup-status.md). The Neon account offered only AWS regions; Azure replacement was not created. The old project `curly-heart-88402811` remains intact pending replacement/data validation. Better Auth dashboard onboarding requires a reachable server; development/production dashboard connections were not created or verified. No upgrade, tunnel, external email, cloud deletion or public production activation occurred.

## Milestones and remaining work

| Milestone | Status | Outstanding exit requirements |
|---|---|---|
| 0 Consolidate | Implemented local foundation | Broader packaging and migration recovery exercises |
| 1 Creation UX | Substantial implementation | Attachments, complete auth redirect/attachment journey, generated thumbnails, deletion/resource handling and broader accessibility |
| 2 General generation | Partial | Trusted product-specific database/auth/upload modules, functional/security verification, capability checks, broader dependency catalog and ten-brief coverage |
| 3 Hosted foundation | Partial code; cloud blocked | Azure Neon, dashboard/email/OAuth verification, E2B, R2, per-project leases/fencing, independent previews, usage reservation/settlement and monetary ceilings |
| 4 Refinement/review | Partial | Reliable visual source mapping/editing, optional comparison, bookmarks/diffs, comment replies/context, authenticated hosted previews and full conflict comparison |
| 5 Publishing | Not implemented | GitHub App/Render adapters, deployment records/jobs, preflight, separated production data, health activation, rollback and unpublish |
| 6 Release hardening | Not complete | 30-run generation gate, isolation/access-control matrix, backups, full keyboard/screen-reader/zoom/contrast review and measured performance |

The local worker intentionally retains the original global lock/single active preview. It pauses the preview during builds. The starter still includes legacy SQLite/items infrastructure. Neither is the final hosted architecture. No unsupported integration catalog or nonfunctional Publish control is presented as working.

## Resume

Use this worktree and its ignored local configuration. Do not alter the original visual/engine checkouts. Continue from the approved [plan](implementation-plan.md), respecting the latest Azure/Better Auth amendment. For cloud continuation, obtain Azure availability in the named Neon account and configure reachable Forge environments, provider credentials and operating budgets before activation. Existing deletion authorization remains valid only for the identified resource after preservation and replacement checks.
