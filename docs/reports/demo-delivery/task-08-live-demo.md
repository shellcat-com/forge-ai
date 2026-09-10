# Task 08 — Publishing support; live engine demonstration blocked

Date: 2026-09-10 UTC. Branch `codex/task-08-live-demo`, based exactly on published canonical `881e9ac2b11f8f168cb7849b77c4ee7439e55458`. Worker PR base: `codex/demo-delivery-baseline` (Task 01 PR #8); Tasks 02–07 are live integration dependencies. No shared API, contracts, migrations, manifests, lockfiles or worker composition were changed. The dehydrated Documents checkout was preserved; implementation uses `/tmp/forge-task08-live-demo` from the verified canonical repository.

## Delivered scope

- `engine/publishing`: static portfolio artifact preparation bound to provider source, job/template/image/policy, authenticated runner verification supplied by a trusted control adapter, content approval, provider usage evidence, snapshot, source commit and exact Vercel project. Rechecks current permission after immutable artifact reads. Rejects fixtures/restores, stale or failed verification, output mismatches, wrong account/project, env/server files, unsupported profile and known-secret canaries.
- Static-only Vercel Build Output API staging with restrictive CSP, no Functions, no Git auto-deploy, no API routes and no generated-code build on the operator/Vercel host. Offline staged-byte audit accepts only the platform-authored frontend; generated portfolio publication has no unauthenticated JSON/CLI shortcut.
- Shared `HostedUnavailable` component and scoped `/hosting` Next.js route. The opt-in packager emits the same component as a temporary public fallback, self-hosted IBM Plex Mono plus its license, semantic light/dark tokens and exact static hashes. It truthfully states generation, sign-in, private previews and publishing are unavailable. It collects no briefs/keys and makes no backend calls. Canonical Next.js remains the intended full frontend.
- [Demo runbook](../../operations/task-08-demo-runbook.md): brief → actual model call → review → isolated checks/repair → private app → promotion/history/restoration/export → publication, plus distinct real PostgreSQL task-board restart/additive-priority evidence and rollback procedure.
- Bounded asset metadata sanitization delegated by Task 01: three matching JSON catalogs and three account-scoped video references. Provider origins, models/prompts/crop metadata and all asset bytes remain; the preparation script fails before fetching origin-only metadata; account paths/job IDs are removed. `redistributionRights: not-verified` preserves the missing rights evidence. Existing historical commits are unchanged; no secret compromise was established by account/job identifiers. Newly exported design packages read sanitized public provenance. Research/evidence archives remain unchanged and are routed to Tasks 01/09 for distributable allowlisting.

## Verification record

Commands used exact Node 24.20.0 via `/tmp/forge-e3-node24.UZHrx7/node-v24.20.0-darwin-arm64/bin` on PATH unless otherwise noted.

| Command / inspection | Result / evidence layer |
| --- | --- |
| `npm run verify` | PASS lint, TypeScript, 618 tests; 4 optional tests skipped; Next.js production build including `/hosting`. Supporting local verification, not clean reproduction or engine acceptance. |
| `npm run test:db:control` | PASS native PostgreSQL14.18, 45 constraint/RLS assertions on a new ephemeral cluster. Synthetic control data, not generated task-board persistence. |
| `npx vitest run tests/engine/publishing.test.ts` | 28 PASS, explicit synthetic authority/runner/provider inputs; negative cases cannot establish live provenance. |
| Connected E1/E2/E4 HTTP/source/repair test group | 53 PASS including 28 publisher + 25 native source/HTTP/repair cases; still synthetic generation/execution despite native PostgreSQL and actual source/export bytes. |
| `npx tsx scripts/publishing/prepare-frontend.tsx NEW_STAGE` | PASS trusted platform-only static packaging; precommit review stage explicitly marked dirty. Clean production receipt will name committed source. |
| `node scripts/publishing/check-public.mjs EVIDENCE --stage STAGE` | PASS six fresh Chromium contexts: light/dark390/768/1440, public assets/fonts, same-origin GET-only requests, no API request, API404, navigation, keyboard, no page errors/overflow. All six screenshots visually inspected. |
| CSS200%zoom / reduced-motion media emulation | PASS after narrow reflow fix. Simulations only; native browser zoom and native OS reduced motion NOT RUN. |

Dependencies were reused read-only through a symlink to Task 01's frozen canonical `node_modules` due roughly1GiB free disk. Root lockfiles are unchanged. Final full verification also passed 618 tests / 4 optional skips; the separately added metadata preparation guard passed targeted lint and a no-network/no-write execution check. This does **not** count as fresh `npm ci` reproduction. No install/removal through the shared dependency path occurred. Exact commands/output hashes are preserved in this task's evidence manifest. First CSS200%zoom check failed; wrapping/max-width fix passed subsequent six cases. No generated source was built or executed on macOS.

## Deployment and access

Read-only Vercel preflight verified CLI account `biswaskhatiwada213-7214`, the sole accessible team `biswas07` (`team_redhKy5rKgFelsT5oaWR7nYv`), active Hobby plan. Existing `parable`, `biswas-khatiwada-portfolio`, `hatch` and `parcel-zeta-silk` were audited without changes; none links the Forge Git repository. Proposed dedicated `forge-ai-demo` and `forge-generated-portfolio` names returned404. Existing website-capacity authorization applies; no paid services/upgrades/domain or model spend authorized. New fallback project/deployment metadata will be recorded after the committed artifact passes its byte audit.

This is a public unavailable frontend, **not a working hosted builder or generated portfolio**. No portfolio deployment ID/source hash can be provided yet; none was fabricated. No provider/control/deployment secret enters the static build/runtime. Deployment credentials are held only by the trusted operator CLI. Vercel public URL/production browser evidence is pending the deployment step.

## Remaining live blockers

1. An explicit supported model/endpoint/entitlement and numeric total API spend ceiling; asked asynchronously, no answer received. Current authorized billable model spend remains$0. BYOK alone grants no spending authority.
2. Task 01's real identity/admission/per-call accounting/source-stage bridge and Tasks 04–06 authenticated provider/storage credentials and actual call evidence. `PublicationAuthority` is an unregistered server-side port; arbitrary evidence JSON or booleans do not authenticate receipts.
3. Task 02 approved real isolated runtime/access plus Task 03 released immutable template/image and proposed static export profile. Current task-board profile cannot be relabeled static; the publishing CSP deliberately refuses inline hydration until reviewed profile compatibility exists.
4. Task 07 working private preview/tickets/revocation tied to exact environment/generation and Task 05 real owner session. No private URL was supplied.
5. Actual generated PostgreSQL task-board CRUD, app-process restart, additive change, repair, source promotion/restoration and clean export demonstration. Supporting native fixture tests are not this proof.
6. Full canonical frontend hosting with real services, native accessibility checks, operational/release acceptance and artwork redistribution evidence. The fallback does not close these gates.

Public portfolio content may use the clearly labeled demonstration brief in the runbook when profile claims are missing. No qualifications, employers, testimonials, projects or contact destinations were invented. No new agents, domain purchase, new paid infrastructure, paid model call, merge, force-push or unrelated project write occurred.
