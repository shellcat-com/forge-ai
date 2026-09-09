# Forge AI: unified creation workflow and hosted beta

Execution amendment: the latest approved plan requires resuming `codex/forge-unified`, Azure Neon replacement and Better Auth integration. The user’s latest instructions take precedence over earlier resume notes in this attached reference. See [implementation status](implementation-status.md) and [cloud setup status](cloud-setup-status.md) for verified execution; this plan is not a completion claim.

## 1. Product direction and implementation foundation

Forge will become one application where a user can describe an idea, receive a working website or web app, refine it through conversation or direct editing, invite feedback, and publish it.

**The approved Forge appearance remains the visual foundation.** Its neutral colors, typography, borders, artwork, light/dark themes, and restrained motion carry into the unified product. Generated projects receive their own visual direction.

### Confirmed decisions

| Area | Decision |
|---|---|
| Audience | Solo builders and small teams |
| First release | Responsive websites and web apps; PWA support where appropriate |
| Default journey | Build directly from a prompt |
| Planning | Optional Idea, Brainstorm, and Plan modes |
| Design choice | Automatic by default; references, examples, and comparison are optional |
| Collaboration | Owners build; invited reviewers preview and comment |
| Beta access | Invite-only, with capped usage |
| Publishing | Forge-hosted links first |
| Architecture | Combine the working Next.js engine with the approved Forge interface |
| Infrastructure | Managed services through replaceable adapters |
| Existing constraints | Preserve the exclusion of AWS and Supabase; use Azure for the replacement Neon project |

“Any app” means broad freedom over product purpose, pages, workflows, and appearance within the supported web runtime. Native mobile applications and arbitrary framework selection remain later milestones.

### What already exists

There are two implementations to consolidate:

- **Current `master`:** the approved Vite interface, marketing pages, theme system, five examples, local project briefs, downloadable preset packages, and NVIDIA text planning.
- **`codex/forge-ai-local`:** Next.js, PostgreSQL/Drizzle, durable jobs and events, provider adapters, validated file operations, Docker previews, Monaco editing, revision history, and recovery.

The existing engine substantially reduces the work required. Its current generation contract still limits output to one page and one stylesheet against a fixed SQLite backend. It also pauses the sole preview while rebuilding. Those restrictions must change before Forge supports the intended range of products.

Fresh verification passed:

- Visual checkout: lint, type checking, 33 tests, and production build.
- Engine worktree: lint, type checking, and 55 tests.

Earlier reports contain live generation and browser verification. Those live workflows were not rerun during this planning pass.

### Research basis

The saved Bolt, Lovable, and Emergent research informs the interaction patterns:

| Observed pattern | Application to Forge |
|---|---|
| Central prompt composer | Make describing an idea the primary entry action |
| Recent projects and search | Make returning to work immediate |
| Chat beside a running preview | Keep requests and results visible together |
| Optional planning controls | Support exploration without requiring a long wizard |
| Design directions and drafts | Offer comparison without forcing it |
| Version cards and history | Make changes understandable and reversible |
| Visual selection tools | Let users identify changes directly in the preview |
| Data and integration panels | Reveal configuration when the project needs it |
| Build logs and screenshots | Show evidence of what ran |
| Share and publish controls | Separate private review from public release |

The [research ZIP](</Users/biswaskhatiwada/Documents/ChatGPT/Forge AI _ Full-Stack App Generator/research/forge-builder-ux-evidence.zip>) contains 18 verified screenshots and a reconstructed slideshow. It does not contain a continuous original-session recording, and the one-time onboarding dialogs were not captured in the exported screenshot set. Connector menus demonstrate discoverability, not verified operation of every integration.

## 2. The complete user experience

### A. Landing, authentication, and first entry

Preserve the current marketing composition and artwork. Update its navigation and explanations to describe the actual creation workflow.

- Rename **Design systems** to **Examples** in customer navigation.
- Keep documentation, workspace access, and the five example presentations.
- Use **Start building** as the main product action once generation is available.
- Keep **Explore a sample** as a separate, clearly labeled demonstration.
- Replace descriptions implying every project must use one of five systems.
- Update product screenshots only after the corresponding functionality works.

A visitor may write a prompt before signing in. Authentication must preserve that prompt and return them to it.

For the hosted beta:

- Implement Better Auth with Google, GitHub, and email sign-in.
- Require an invitation before starting credit-consuming work.
- Retain the approved split login/artwork layout.
- Show only configured sign-in methods.
- Handle expired invitations, interrupted authentication, existing accounts, and session expiry.
- Avoid mandatory role, company, discovery-source, or design-selection surveys.

After authentication, open the composer immediately. Introduce secondary tools contextually when first used.

### B. Home, projects, and navigation

Use these primary destinations:

| Destination | Purpose |
|---|---|
| Home | New prompt and recently opened projects |
| Projects | Search, filter, organize, and reopen projects |
| Examples | Optional inspiration and reusable starting points |
| Connections | Manage authorized external services |
| Documentation | Product guidance and supported capabilities |
| Settings | Account, appearance, usage, and data controls |

Keep account navigation separate from project tools.

**Home**

- Place the prompt composer above recent projects.
- Show a small set of diverse starter prompts: website, dashboard, portal, utility, and content application.
- Selecting a starter fills the composer and permits editing before submission.
- Return focus to a restored draft when appropriate.
- Show usage unobtrusively near account controls.

**Projects**

- Search names and brief summaries.
- Filter by owned, shared, starred, archived, and published.
- Sort by recently opened, recently updated, or name.
- Provide grid and list views.
- Display actual preview thumbnails, update time, ownership, and understandable status.
- Distinguish project lifecycle from the current job: a published project may simultaneously have an edit running.
- Support rename, star, archive, duplicate/remix, export, and deletion.
- Make archive reversible; protect permanent deletion with a clear description of affected resources.
- Use pagination and indexed search rather than downloading every project.

Recent projects must reflect `lastOpenedAt`, not creation order.

**Routing**

Use one Next.js route system:

- Public marketing, examples, and documentation.
- `/app` for Home.
- `/app/projects` for the project library.
- `/app/projects/[id]` for the builder.
- Dedicated account and project settings routes.

Preserve old hash links and `/?project=...` links through compatibility redirects. Back/forward navigation must restore the relevant project view.

### C. Prompt-first creation

The composer contains:

- A multiline prompt.
- An attachment action.
- A mode selector, defaulting to **Build**.
- Optional appearance/reference controls.
- A primary submit action.
- Advanced model/runtime controls when appropriate.

Project name, stack, and preset selection are no longer mandatory first-step fields.

Generate a short editable project name from the prompt. Keep technical stack selection inside advanced settings; use the supported Next.js runtime by default.

**Four connected modes**

| Mode | Result |
|---|---|
| Idea | A clearer concept and intended audience |
| Brainstorm | Possible features, workflows, and alternatives |
| Plan | Editable requirements, pages, data needs, and acceptance criteria |
| Build | A working candidate application |

Modes share the same project context. Switching modes preserves the conversation, attachments, and decisions. Idea, Brainstorm, and Plan do not allocate a build sandbox.

**Clarification rules**

Start building immediately when the request is sufficiently clear.

Ask a small, grouped set of questions only when the answer changes essential behavior—for example:

- Personal browser storage versus shared accounts.
- Public content versus private customer records.
- A working payment integration versus a visual checkout concept.

Provide recommended defaults and explain their practical effect. Do not ask users to choose databases or frameworks when Forge can choose the supported implementation.

Persist the prompt before starting work. A double click, refresh, or request retry must not create duplicate projects or charges.

### D. Unrestricted visual direction

Replace the required preset relationship with a flexible **Design brief**.

It records:

- Style description and reference attachments.
- Colors, typography, density, and layout preferences.
- Navigation structure and responsive intent.
- Accessibility and motion preferences.
- Optional example ID.
- Elements the user explicitly wants preserved.

Support four entry paths:

1. **Choose for me:** infer an appropriate direction from the product.
2. **Describe a style:** accept freeform visual requirements.
3. **Use references:** interpret uploaded screenshots and approved assets.
4. **Start from an example:** optionally reuse one of the five existing directions.

The five examples remain downloadable and reusable. They do not define the available output types, layouts, colors, or typography.

Explicit user instructions take precedence over inferred style. An unknown or custom design must never silently fall back to Technical Mono.

**Optional comparison**

Offer **Compare directions** before a build or during refinement.

- Produce three project-specific design candidates.
- Vary meaningful composition, typography, density, and visual character.
- Keep requested functionality consistent across candidates.
- Show desktop/mobile representations and a short explanation.
- Allow selecting one, requesting another, or returning to the existing direction.
- Display the additional usage before generating alternatives.
- Retain candidates separately until accepted.

Comparison must never overwrite the active project simply because a candidate was previewed.

**Design isolation**

Forge interface tokens and generated-project styles remain independent. Fonts, CSS resets, themes, and media from a generated app run inside its isolated preview.

Expand evaluation beyond decorative landing pages: dashboards, forms, tables, content layouts, calendars, storefronts, and customer portals must have appropriate structure.

### E. Builder workspace

Use a stable, persistent workbench:

```text
Project name / status               History   Share   Publish
────────────────────────────────────────────────────────────
Conversation and composer │ Preview   Code   Data   More
                          │
Progress and version cards│ Running application or active tool
                          │
                          │ Checks / logs drawer
```

**Layout**

- Keep workspace navigation expanded on Home and Projects.
- Collapse it by default inside the builder.
- At wide sizes, use a resizable conversation panel of approximately 360–420px.
- Give the remaining width to the preview or editor.
- Move the original brief into a collapsible Project context panel.
- At tablet sizes, use a navigation drawer and switchable workbench panels.
- At mobile sizes, show one primary panel at a time: Chat, Preview, or Tools.
- Keep the composer reachable without scrolling through the entire conversation.
- Preserve panel sizes, selected files, preview route, and scroll position per project.

**Conversation**

- Show user requests, concise responses, clarification cards, and version cards.
- Group progress into understandable stages.
- Put detailed logs behind disclosure controls.
- Keep completed history readable while a new job runs.
- Provide Stop, Retry, and relevant follow-up suggestions.
- Do not display invented progress percentages or internal reasoning transcripts.

**Preview**

- Support desktop, tablet, mobile, and custom viewport widths.
- Include page selection, refresh, open separately, and fullscreen.
- Clearly distinguish current preview, candidate, and published version.
- Preserve the iframe when switching workspace tools.
- Keep the current working preview available while a candidate builds in hosted mode.
- Show expired or suspended previews with a specific restart action.
- Show runtime failures separately from network or sandbox-start failures.

A screenshot is an artifact, not an interactive preview. If local resource limits require pausing, label the paused state explicitly.

### F. Editing, history, and review

**Conversation edits**

Follow-up requests create staged revisions from an explicit base revision. Only a successful build can become the current working version.

**Code editing**

Reuse Monaco with:

- File tree and search.
- Dirty-state indicators.
- Preserved editor buffers and cursor positions.
- Save and rebuild.
- File differences between versions.
- Clear protected-file explanations.
- Conflict handling if another tab or completed job changed the base revision.

Server refreshes must not overwrite unsaved edits.

**Visual editing**

Provide an opt-in selection overlay inside the preview.

- Select text or a supported component.
- Highlight the selected element and show its relationship to source.
- Apply direct text and supported style changes through source patches.
- Send structural changes to the conversation with element context.
- Offer before/after review and undo.
- Preserve changes across reloads and rebuilds.

Use build-time source identifiers. When source mapping is ambiguous, explain the limitation and offer a contextual chat edit. Do not pretend every arbitrary DOM node supports reliable inline editing.

**History**

Each revision displays its summary, timestamp, source change, checks, preview evidence, and originating request.

Support bookmarks, comparison, restore, and remix. Restore creates a new revision; it does not erase history.

Keep these operations distinct:

- Restore source/design.
- Restore development test data.
- Roll back a published deployment.

Restoring code must never silently restore an old production database.

**Private review**

Owners can invite authenticated viewers or commenters.

- Reviewers receive preview access according to their role.
- Comments attach to a revision, page, and optional element.
- Owners can reply, resolve, and turn comments into edit requests.
- Reviewers cannot spend generation credits, inspect secrets, or publish.
- Revoking access invalidates future preview access.
- Remixing requires owner permission and creates an independent project without secrets or production customer data.

### G. Data, integrations, and project operations

The Data panel appears when useful, with a clear empty state otherwise.

Beta capabilities:

- Project-specific data models and server routes.
- Database schema and table inspection.
- Development records and test-data reset.
- Generated-app authentication.
- File uploads and storage.
- Environment and secret configuration.
- Migration status and relevant server logs.

Forge accounts and generated-app customer accounts are separate systems.

Use tested backend modules for common authentication, ownership, CRUD, validation, and upload workflows. Extend them to the requested data model instead of routing every application through the current generic `/api/items` backend.

**Connections**

Separate account-level authorization from the services attached to a particular project.

Each connection shows its purpose, permissions, attached projects, health, and disconnect behavior. Provisioning and credential failures must produce actionable states.

Additional integrations enter through complete vertical slices:

- Payments: test checkout, signed webhooks, order state, failure/retry behavior.
- Email: verified sender configuration, delivery failures, and test sending.
- AI features: project-specific model access and usage limits.
- External tools: explicit authorization, scoped access, and disconnect handling.

Do not populate a large catalog with controls that lack implementations.

### H. Publish and return

Publishing opens a review panel for a specific validated revision.

Show:

- Proposed public address.
- Pages and routes.
- Build and runtime checks.
- Required environment configuration.
- Authentication and data-access findings.
- Database migration effects.
- Basic metadata, favicon, social preview, sitemap, and indexing settings.

Publish through a durable deployment job. Show a public link only after the deployed application passes its health check.

Support subsequent releases, deployment history, rollback, and unpublish. A failed release leaves the previous deployment active.

Private previews remain access-controlled and excluded from indexing. Published applications use separate production data and credentials.

Custom domains follow the beta and add verification, DNS guidance, certificate states, and recovery.

## 3. Engineering changes

### A. Consolidate the repository before adding features

Resume the existing `/Users/biswaskhatiwada/.codex/worktrees/forge-unified` worktree on `codex/forge-unified`. Deliberately complete its engine merge; do not create another integration branch or discard either original foundation.

Resolve responsibilities as follows:

- Next.js/React becomes the application runtime.
- The current approved design, original artwork, themes, and shared visual rules become authoritative.
- Retain the existing server providers, worker, Drizzle schema, file validation, Monaco integration, and recovery tests.
- Port marketing, examples, documentation, and local import/export into Next.js components.
- Retire duplicate Vite routing and rendering after equivalent routes work.
- Adapt NVIDIA text planning to the shared provider boundary without representing it as a proven code-generation provider.
- Reconcile documentation, CI, runtime configuration, and repository skills.

Preserve commit history and both existing data sources. Do not resolve conflicts through blanket “ours” or “theirs” selection.

### B. Selected infrastructure

| Layer | Implementation |
|---|---|
| Application | Existing Next.js, React, strict TypeScript |
| Styling | Approved semantic CSS tokens and scoped components |
| Validation | Shared Zod contracts |
| Metadata | PostgreSQL and Drizzle; Neon for hosted operation |
| Authentication | Better Auth |
| Jobs | Extend the existing PostgreSQL-backed worker |
| Events | Durable, replayable SSE |
| Local execution | Existing restricted Docker adapter |
| Hosted execution | E2B adapter |
| Artifacts and uploads | Private Cloudflare R2 storage |
| Hosted web/worker services | Render |
| Generated production apps | Separate Render services, isolated from Forge services |
| Source publishing | Forge-managed private repositories with scoped GitHub App access |

Better Auth supports the selected Drizzle and Next.js integration. Neon provides database branching suitable for isolated development environments. These choices preserve the original PostgreSQL direction. [Better Auth integration](https://better-auth.com/docs/integrations/next), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Neon branching](https://neon.com/branching).

E2B exposes network and public-access controls; the adapter must explicitly configure and test them. Private artifacts use short-lived authorized access rather than public buckets. [E2B network interface](https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/sandboxApi.ts), [R2 presigned access](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Retain local PostgreSQL/Docker operation. Hosted services must not become prerequisites for running the local development version.

### C. Expand generation into a real project pipeline

Replace the two-file generation schema with a structured project workflow:

1. Normalize the request and relevant context.
2. Identify pages, interactions, data requirements, and design intent.
3. Ask essential clarification questions, if any.
4. Select the trusted runtime and needed capability modules.
5. Produce bounded file-operation batches.
6. Validate every batch before applying it.
7. Build in an isolated candidate workspace.
8. Run functional, browser, and relevant security checks.
9. Attempt at most two targeted automatic repairs.
10. Save artifacts and promote a successful revision.

Support nested pages, reusable components, styles, route handlers, server modules, assets, and schema changes.

Keep infrastructure files and commands controlled by Forge. Dependency requests pass through a reviewed package catalog and produce pinned lockfiles. An unsupported package should produce an explanation or supported alternative, never an unrestricted shell command.

Use repository context selection and summaries as projects grow. Avoid repeatedly sending the entire project or truncating source silently.

Expand provider metadata to include structured-output support, image-input support, token budgets, cancellation, usage reporting, and verified generation status.

Reuse the configured Groq path as the initial cloud integration baseline and Ollama locally. Hosted availability must depend on successful capability tests and configured budgets. Provider fallback must be visible and must not silently enable paid or differently authorized services.

### D. Durable jobs and concurrency

Replace the global worker lock and singleton runtime record with per-project job and preview ownership.

- One mutating job per project.
- Leased jobs with heartbeat, timeout, and fencing against stale workers.
- Idempotency keys for create, edit, cancel, and publish.
- Explicit base revisions for changes.
- Durable cancellation checked during provider requests, builds, tests, and promotion.
- Reconnectable event streams with saved cursors.
- Recovery after worker loss without duplicate promotion or billing.

A job moves through queued, clarifying, planning, generating, building, testing, repairing, and terminal states. Terminal outcomes distinguish success, failure, cancellation, and interruption.

Treat public deployment as a separate job type.

Keep the active preview and candidate separate. Candidate tests use isolated test data. UI-only promotion continues against the current development database; schema changes use validated migrations and explicit handling for destructive changes.

### E. Data model and API changes

Extend existing records instead of introducing parallel project stores.

| Record | Required additions |
|---|---|
| Project | Owner, lifecycle, brief, design brief, runtime, timestamps, active/published revision |
| Conversation/message | Durable mode, content, attachments, clarification decisions |
| Job | Base revision, stage, lease, cancellation, idempotency, usage |
| Revision | Source manifest, parent, runtime/lockfile version, checks, screenshots |
| Preview environment | Project/revision binding, expiry, access policy, health |
| Deployment | Revision, environment, provider identifier, status, URL, migration record |
| Membership/comment | Role, invitation, revision/page/element references |
| Connection | Provider, authorized scope, encrypted credential reference, health |
| Usage ledger | Reservation, consumed usage, released reservation, adjustment |
| Asset | Owner/project, object reference, media metadata, processing state |

Retain separate timestamps for opening, editing, and publishing.

Extend the existing API families:

- Projects: create drafts, update metadata, search, archive, import/export, and remix.
- Messages: submit requests, answer clarifications, and record decisions.
- Jobs: generate, edit, compare, restore, cancel, and replay events.
- Revisions: files, diffs, checks, artifacts, and bookmarks.
- Previews: authenticated session creation and restart.
- Sharing: invitations, roles, revocation, and comments.
- Deployments: preflight, publish, status, rollback, and unpublish.
- Usage/capabilities: remaining allowance and currently available functions.

Use shared schemas for client and server validation. Return typed errors for missing access, stale revisions, exhausted limits, unavailable providers, and invalid output.

### F. Preserve existing projects

There are two migration paths:

**Browser briefs**

- Import the existing versioned JSON format.
- Preserve names, prompts, timestamps, and selected examples.
- Convert preset selection into an optional example reference.
- Treat imported briefs as drafts, never as generated applications.
- Preserve the old storage record until successful import and verification.
- Because browser storage is origin-specific, provide export/import when moving between the old Vite origin and Next.js.

**Engine projects**

- Apply additive database migrations.
- Preserve project IDs, revisions, source, runtime references, and data snapshots.
- Assign legacy local projects to the configured local owner.
- Import selected projects into hosted accounts explicitly.
- Exclude credentials and private account-setup evidence.
- Keep existing SQLite applications supported locally.
- Offer a tested data conversion before publishing a legacy SQLite project to the managed PostgreSQL runtime.

Corrupt or incompatible imports must remain downloadable for recovery.

### G. Isolation and operational safety

Preserve the existing policy boundary while broadening supported applications.

- Generated code never executes in the Forge web or worker process.
- Sandboxes receive only project-scoped development access.
- Production credentials never enter model context or test environments.
- Deny sandbox access to host files, Docker sockets, metadata endpoints, and Forge control services.
- Validate file paths, archive contents, symlinks, sizes, and dependency requests.
- Treat generated logs and documentation as untrusted content.
- Authenticate every project, revision, event-stream, artifact, and preview request.
- Use separate origins for Forge, previews, and published applications.
- Validate preview messaging by origin, session, and schema.
- Keep generated applications separate from Forge’s private service network.

For publication, Forge supplies a protected Dockerfile and deployment configuration. Only nonsecret build arguments are permitted. Render automatically makes service variables available as Docker build arguments, so this boundary needs explicit tests. [Render Docker behavior](https://render.com/docs/docker).

Keep source history immutable. Database backups, schema migrations, and deployment rollback have separate records and procedures.

### H. Usage limits and smoothness

Initial beta defaults:

- Five active projects per owner.
- One active generation per owner and project.
- One published app per owner.
- Ten build/edit/compare requests per day, plus a separate provider-cost ceiling.
- Ten-minute overall job deadline.
- At most two automatic repair attempts.
- Preview suspension after fifteen idle minutes.
- Five attachments per request, ten megabytes each.

These are server-configured beta limits. Global resource and monetary ceilings must be set before hosted generation is enabled.

Reserve usage before work begins and settle actual consumption afterward. Navigation, preview refresh, and reconnection do not consume generation allowance. Cancellation releases unused reservations. Infrastructure retries cannot create duplicate charges.

**Performance targets**

| Interaction | Acceptance target |
|---|---|
| Typing and common local actions | Visible response within 100ms at p95 |
| Warm panel switches | Within 150ms at p95 |
| Project/job acknowledgement | Within one second at p95, excluding authentication |
| Core Web Vitals | LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 |
| Simple app generation | Target ≤2 minutes at p75 and ≤5 minutes at p95 |
| Draft protection | Local recovery plus explicit server saved/unsaved state |

Generation targets must be measured by provider, app category, queue time, and cold/warm runtime. They are launch targets, not claims about current performance.

Use stable React component boundaries, lazy Monaco loading, incremental events, bounded logs, cached metadata, reserved preview dimensions, and selective subscriptions. Preserve focus and input during background updates.

Keep existing restrained motion around 160ms. Respect reduced motion throughout.

## 4. Delivery sequence

Each milestone produces a reviewable implementation, relevant tests, real screenshots, a concise report, and a coherent commit.

| Milestone | Deliverables | Exit condition |
|---|---|---|
| **0. Consolidate** | Integrate engine and approved design; reconcile routes, guidance, build configuration, and migrations | One application retains both existing project sources and working local generation |
| **1. Creation UX** | Home, project search, prompt-first creation, four modes, optional examples, preserved drafts, responsive workbench | A user can start and revisit work without compulsory preset or stack selection |
| **2. General generation** | Multiple pages/components, project-specific backend, context selection, bounded repair, durable cancellation | Diverse applications work beyond the fixed items template |
| **3. Hosted foundation** | Better Auth, invitations, ownership, Neon, R2, E2B, worker leases, quotas | Two accounts can build concurrently without cross-project access |
| **4. Refinement and review** | Persistent Monaco, visual edits, optional comparison, history, comments, sharing, remix | Every accepted change persists and can be reviewed or restored |
| **5. Publishing** | Preflight, isolated production data, Forge links, deployment jobs, rollback, unpublish | Both a website and authenticated web app publish and survive a failed update |
| **6. Release hardening** | Performance measurement, accessibility, abuse limits, backups, recovery drills, support documentation | Release checklist passes and invite-only beta can open |

Do not expose controls as functional before their underlying capability passes its milestone.

### Expansion after the beta

Implement the remaining research-inspired features in this order:

1. **Production integrations:** payments, email, generated-app AI, richer uploads, and operational logs.
2. **Ownership and distribution:** custom domains, GitHub import/export, and portable deployment packages.
3. **Project organization:** collections, reusable project knowledge, cross-project references, and reusable instructions.
4. **Advanced design:** selective draft acceptance, richer component editing, and Figma import.
5. **Product operations:** visitor analytics, monitoring, expanded security checks, and SEO tooling.
6. **Team building:** shared editing with explicit concurrency and permissions.
7. **Additional inputs/runtimes:** voice prompting, hosted BYOK, additional providers and frameworks, and native mobile.

Preserve Idea and Brainstorm as useful product modes throughout this expansion. Broad connector catalogs and mobile generation are roadmap capabilities rather than beta prerequisites.

## 5. Testing, evidence, and publication criteria

### End-to-end acceptance suite

Use ten representative briefs, including:

- Pomodoro timer.
- Editorial portfolio.
- Colorful restaurant website.
- Dense project dashboard.
- Authenticated customer portal.
- Reading tracker with persistent records.
- Booking application with time-zone handling.
- Product catalog and cart.
- Content publication with multiple routes and metadata.
- Team knowledge application with search and access rules.

The purpose is to prove different layouts and behaviors, not ten variations of one landing page.

For the Pomodoro reference, verify start, pause, resume, reset, duration changes, automatic break transition, session count, persistence, keyboard use, and narrow-screen layout. Use controlled clocks rather than waiting through full sessions.

For the beta evaluation, run each brief three times against the configured generation path. Target at least 27 of 30 successful core workflows within the repair budget. Authentication, isolation, and data-integrity failures block release regardless of the overall score.

### Required regression scenarios

- Existing browser and engine projects survive consolidation.
- Custom design creation does not require a preset.
- Switching modes retains all context.
- Authentication retains a visitor’s prompt.
- Double submission creates one project/job.
- Reload and SSE reconnection preserve progress.
- Stop works during generation, build, and repair.
- A stale worker cannot promote output.
- Failed edits preserve the last working revision.
- Unsaved Monaco changes survive background updates.
- Old history remains accessible after restore.
- Code rollback does not revert production data.
- Revoked reviewers lose access.
- Cross-account project, event, file, and preview requests are denied.
- Provider failure produces truthful state and bounded recovery.
- Quota accounting remains correct through retries and cancellation.
- Publish failure leaves the previous release available.
- Unpublish removes public access without deleting source.

### Visual and accessibility checks

Inspect light and dark at 390, 768, and 1440px, plus compatibility coverage at the engine’s existing 375px breakpoint.

Test keyboard navigation, focus restoration, screen-reader labels, contrast, 200% zoom, reduced motion, long names, large histories, empty lists, offline transitions, and loading/error states.

Compare Forge chrome against the approved captures. Compare generated applications against their individual briefs.

### Evidence and documentation

For each milestone, save:

- Desktop and mobile screenshots.
- Test results with the exact revision and environment.
- A continuous workflow recording when recording is available.
- Clear labeling when an artifact is a screenshot sequence.
- Build/check outcomes and known limitations.
- A mapping from implemented feature to supporting evidence.

Keep competitor research private. Public repository screenshots should show Forge itself and omit credentials or private customer content.

Update the architecture, provider capabilities, design guidance, setup instructions, and milestone reports as functionality changes. Remove stale contradictions between the two branches.

### Release gate

The hosted beta is ready when an invited user can:

1. Describe a product without choosing a design system.
2. Receive a working, appropriately styled website or web app.
3. Make conversational, code, and supported visual edits.
4. Leave and return without losing work.
5. Review and restore versions safely.
6. Invite private feedback.
7. Publish a functioning application.
8. Recover from provider, build, and deployment failures.

Before enabling hosted resources, configure provider credentials, service accounts, the Forge-owned application domain, and explicit operating budgets. Preparing these integrations is part of implementation; purchasing services and public deployment remain separate activation steps.


## Binding cloud replacement amendment

The following approved amendment is part of Milestone 3 and supersedes earlier cloud setup wording.

### Neon replacement

- Organization: `org-solitary-bonus-96047632`. Delete only old project `curly-heart-88402811`, currently PostgreSQL 18 on AWS Ohio, after replacement validation. Do not delete the organization, unrelated projects or local source.
- Replacement: `forge-ai`, Azure East US 2 preferred, PostgreSQL 17, database `forge`, production and development branches, smallest suitable compute with scale-to-zero, separate application and migration roles.
- Inspect old branches, databases, integrations, active dependencies and data. Storage/usage counters do not establish emptiness. Make a private recovery export where data exists and test recoverability. Validate PostgreSQL 18→17 compatibility before any required transfer.
- Create and validate the Azure replacement first. If Azure is unavailable, report the actual choices; do not substitute AWS or buy an upgrade. Apply reviewed development migrations and synthetic fixtures, verify role privileges and reads/writes, then update active configuration. Only then delete the exact old project and confirm absence.
- Pooled connections serve application traffic; direct connections run migrations. Keep secrets server-only. Keep generated-app databases separate from Forge identity/metadata. Browser-only utilities do not need provisioned databases. Local PostgreSQL remains supported.

### Better Auth

Better Auth runs within Forge's Next.js server, using Neon for persistence. Do not enable a second identity implementation through Neon Auth. Implement `/api/auth/[...all]`, reviewed auth tables, strong environment-specific secrets, explicit trusted origins, invitation acceptance, sign-in, sign-out, expiry and recovery. Enable Google/GitHub only with tested OAuth applications, and email only with working verification/recovery delivery.

Inspect the dashboard inventory; remove an old entry only if clearly identified with the retired Forge setup. Create separate `Forge AI Development` and `Forge AI Production` connections with private keys and reachable respective server URLs. Verify sign-in, session visibility, sign-out and administrative revocation. Dashboard administration belongs only to operators. A dashboard outage does not invalidate the distinction between an application session and dashboard connectivity.

Enforce authorization on projects, jobs, event streams, revisions, files, artifacts, previews, comments and deployments. Assign legacy ownership explicitly. Preserve prompts/attachments through authentication and redirects.

### Cloud exit gate and authorization

The Azure project and both branches, development migrations, intended role permissions, application reads/writes, identity isolation, activated dashboard connections, old-project removal and sanitized evidence must all be verified. Development results do not establish production readiness. Existing deletion authorization remains valid after the preservation/replacement sequence. Purchases, operating budgets and public production activation remain explicit release inputs.
