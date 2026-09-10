# Production integration report — release incomplete

Latest implementation: [free-service account/key integration](free-connections/README.md). That milestone supersedes the historical account-bridge/BYOK gaps below, records the new $0 managed-Sandbox direction, and preserves all remaining live release gates.

2026-09-10. The requested hosted generation-to-publication product is **not complete**. This task implements and verifies a public-account milestone and fixes concrete hosted-boundary/onboarding failures. No real generated application, working published application URL, live mailbox-delivery result or complete product recording is claimed. Further implementation is required in addition to external configuration.

The subsequent [post-login website-attempt investigation](website-attempt/README.md) adds a recording of a basic bakery-site request, corrects the misleading model-connection/worker messages and mobile zoom overflow, and records its own final verification. The account-milestone counts and hashes below remain historical evidence.

## Baseline, ownership and GitHub

Verified origin: `https://github.com/shellcat-com/forge-ai.git`. Remote default `master` was `42a376387835c2d7140b6c484c3517fe466714eb`. The newer canonical integration branch was `codex/demo-delivery-baseline`, `4afc9cb587df24bfc7c31deee13cbc8af2d7ad42`, draft PR #8. This task branches from that canonical commit as `codex/production-integration`; it does not restart the obsolete Vite checkout or merge/rewrite existing branches. The Documents checkout had stalled Git/file reads; work used a clean independent clone at an isolated Developer directory. Its private `.env.local`, index and concurrent changes were not copied or edited.

Read the current working agreement, README, architecture/security/provider documentation, RFC 0001, coordination records, baseline report, and PR #17's independent release audit. PR #17 remains review-only and unmodified. Existing Tasks 02–08 source is already included through PR #8. The new scope and ownership/migration decision is [ADR 0002](../../decisions/0002-public-self-service.md). PR base is `codex/demo-delivery-baseline`; PR #8 must be resolved before a final release to `master`.

Tested implementation commit: `c5b035d81bce7437a31c404c5a7b72e7644d924c`. Subsequent delivery commits update reports only. No deployed commit is assigned to these local results.

The repository's legacy Docker workflow and RFC control system remain distinct. This task does not introduce another identity authority, queue, cloud provider, worker or frontend rewrite. It does not simply remove fixture guards.

## Implemented and reused

- Reused Better Auth 1.7.3 and the existing login/recovery UI. Public signup is the hosted default; an explicit optional invite policy preserves private installations. Verification precedes builder access; signup grants no RFC/operator membership. Passwords are server-bounded to 12–128 characters. Added resend-verification UI.
- Added strict hosted deployment/host/origin checks to the actual account route, bounded request bodies, compressed-body rejection, and atomic PostgreSQL abuse admission. Vercel cannot silently run as a local owner when mode configuration is absent or wrong.
- Reused the existing validated PostgreSQL TLS configuration adapter for a new **separate auth connection pool**, with no migration/app DSN fallback. Added runtime privilege checks and a reviewed, dedicated-database role-grant script. Auth runtime cannot read project tables, own schema objects, create schema objects or inherit privileged roles.
- Added application migration 0005 for suspension and fixed-size rate counters. Preserved original application 0001–0003 and engine migrations; application 0004 remains reserved for the control bridge. No live Neon migration was applied.
- Hardened session expiry/freshness, cookie settings, OAuth-token encryption and linking policy. Recovery revokes existing Better Auth sessions. Protected requests recheck account suspension. **These are not yet RFC engine/gateway lifecycle guarantees.**
- Fixed a real integration problem: Better Auth can swallow email-transport exceptions. Request-scoped delivery tracking now returns a safe 503 instead of a misleading inbox success. Delivery is awaited, timeout-bounded and does not follow redirects. Real mailbox delivery still requires configuration/evidence.
- Prevented hosted use of the local Docker worker/operator-key provider registry and local preview URLs/heartbeats. Corrected the unsafe onboarding advice suggesting that starting the legacy worker enables approved generation.
- Fixed the auth page's 200% CSS zoom overflow with scoped minimum-width/grid rules, preserving the shared palette/artwork and other pages.
- Added native account/role/concurrency tests and a genuine Firefox **local account regression recording with a synthetic inbox**. It visibly labels generation and publication unavailable.

Reused foundations still awaiting composition: E1 transactional/RLS/lease/admission control, provider encryption/accounting adapters, immutable artifacts, candidate generation bridge, broker/guest/preview contracts and narrow static publication tools. Their earlier tests do not establish production readiness.

## Exact remaining gaps, by category

| Category | Remaining work |
| --- | --- |
| **Implementation** | Better Auth→canonical E1 identity/lifecycle bridge; tenant-scoped hosted key connection/validation/rotation/removal UI and routes; actual current-authority live StageAdapter; complete provider/global/job accounting and encrypted-object adoption in the fenced worker transaction; reviewed full-stack application DB provisioning/migrations; first-class durable publication API shared by chat/button, hosting connection and exact source/exposure approvals, callbacks/idempotency/reconciliation, history/republish/rollback/unpublish. Existing publication code is a narrow static portfolio helper, not this full-stack service. |
| **Integration** | Canonical schema/proposal composition; current Next.js workspace connected to E1 projects/source/reviews/progress instead of legacy jobs; provider/artifact/runner/cleanup adapters through the one existing worker authority; fresh source/schema approval and artifact promotion; private gateway/session/revocation mounting; complete application database and Vercel publishing paths. No feature flag alone closes these gaps. |
| **Configuration/access** | A dedicated Neon auth/application/control deployment with reviewed runtime roles; auth origin/secret and actual verification/recovery delivery; exact supported BYOK model policy/entitlement/rates; approved cloud durable-worker host and region; Linux/KVM sandbox account/host, image release, workload identities/network/cleanup; durable private objects/KMS/retention/backup policy; separately isolated preview TLS site/gateway; user-connected hosting policy/accounts and bounded infrastructure limits. No applicable new model/infrastructure budget was supplied; the budget question remained unanswered during implementation. New billable spend stayed $0. |
| **Deployment** | Deploy the connected application to a preview of the verified Vercel project, configure all external services, pass live A–P acceptance, then promote the exact tested commit. Record real worker/sandbox/storage locations, application DB identities, generated-app deployment receipt/health/public browser checks and rollback. None was deployed by this task. The current public alias remains the availability artifact. |

Least-change infrastructure direction is the existing external durable process, approved Linux/KVM broker and encrypted private PostgreSQL object adapter, with Vercel for the trusted application and Neon for data. No general-purpose execution capability is inferred from Neon, and no cheaper unreviewed container/Vercel build fallback was enabled. Exact cloud service/account/region and budget are still unselected. The user-authorized Gmail session was visible in Firefox; Neon navigation reached a login state, but native computer-use screenshots were stale and no Neon credentials/configuration were retrieved or changed. No unrelated mail was opened or sent.

## Deployment inventory and current public state

Read-only Vercel CLI access works. Verified team/account scope `biswas07`, project `forge-ai-demo`, project ID `prj_5NmNEwVtJcH2BhGcPPpe5OTzo1GL`, Node 24.x. Framework preset is `Other`; **no environment variables** were configured. This is not yet a configured Next.js hosted backend.

Existing production deployment is `dpl_HQkCUrvZnLVXx4LjGfo64qUu1jh3`, provider state Ready. Immutable URL: https://forge-ai-demo-kcmp4ynqr-biswas07.vercel.app. Production alias: https://forge-ai-demo-omega.vercel.app. Both identify the old static availability artifact; the earlier source receipt is commit `339fb8e44234cca9ec5cfe3590e62709458e40a4`, not this branch. The new anonymous Chrome check passed six availability-page cases and explicitly returned `generatedPortfolio: false, liveBuilder: false`. A web-reader fetch failed; the existing browser harness supplied the actual public observation instead.

**Separate generated-app URL: none. Deployed commit for this task: none.** No deployment, new service, plan upgrade, purchase, live model call or production-data fault test occurred. The existing production deployment remains the rollback point. Application code rollback must not remove additive schema or reverse application data migrations automatically.

## Verification and retained failures

A fresh dependency install used Node 24.20.0 and npm 11.11.0, with no copied dependency tree/private environment. Initial canonical verify passed 794 tests with five skips. This task's final results and source identity are recorded in the adjacent [verification record](verification.json); sanitized logs, screenshot evidence and the reviewed video are under [evidence](evidence/).

| Check | Result / evidence class |
| --- | --- |
| Public auth native regression | 10 tests: real Better Auth, actual disposable PostgreSQL, separate limited auth/app roles, synthetic accounts and simulated delivery. Includes verification, session/logout/expiry, password reset/replay/prior-session revocation, invite/no-authority denial, tenant project denial, concurrent rate caps, mail failures, request rejection and privilege drift. |
| Full repository verification | Lint, app/engine strict types, 804 passed / 5 existing optional skips, production build. Supporting local tests only. |
| Firefox account browser | 10 checks: six light/dark 390/768/1440 signup cases with keyboard/reflow/CSS zoom and reduced-motion emulation, plus signup/verification/login/logout/recovery. Actual application routes/Better Auth/PG; in-memory synthetic mail and test-only self-signed TLS trust. |
| Public anonymous browser | Six existing availability-page cases; **not** the hosted builder or generated app. |
| Native control, standalone control and existing app browser | Exact command outcomes retained in verification.json and final logs. Existing browser suite preserves its gated skips; no worker/provider execution is enabled by this harness. |
| Recording/privacy | 12.64-second Firefox local-auth video; reviewed sampled frames and signup/reset screenshots. Passwords are masked, email is synthetic, no browser chrome/mailbox/provider keys in the recording. Not the requested complete product demonstration. |

Retained failure history: (1) original Documents Git/file reads stalled; isolated fresh clone succeeded; (2) initial auth tests rejected recovery callback with 403 and asserted a denial status that Better Auth masks for enumeration protection; callback fixed and denial test now verifies no account/membership is created; (3) mail-outage recovery falsely returned 200; fixed with request-local delivery tracking; (4) test header-union TypeScript error corrected; (5) Firefox browser binary absent, official Playwright Firefox installed; (6) mobile CSS zoom overflow fixed; (7) readiness browser assertion required an exact text node but the element also contained its link; assertion corrected after visual confirmation. Failed logs are preserved separately from successful reruns.

Five default skips are inherited opt-in native/candidate/browser checks; no skip is counted as success. CSS zoom and media emulation do not establish native browser zoom or OS reduced-motion behavior. Historical runner/template success is not reassigned as current live evidence. The browser harness reports a standalone/custom-server warning; its explicitly test-only listener does not change the production deployment architecture.

## Hosted A–P and self-host acceptance

| Required acceptance | Hosted result | Evidence/remaining requirement |
| --- | --- | --- |
| A self-service signup | NOT PASSED | Local real-library/PG/browser pass; hosted app not deployed. |
| B verification, recovery, logout | NOT PASSED | Local synthetic-delivery flow passes; real mailbox delivery missing. |
| C two-account isolation across all resources | NOT PASSED | Local project ownership and baseline RLS checks; hosted keys/artifacts/preview bridge absent. |
| D supported BYOK lifecycle/revocation | NOT PASSED | Existing adapter fixtures; hosted UI/routes/current-authority integration unfinished. |
| E multiple durable projects/reload/jobs | NOT PASSED | Baseline local persistence/idempotency checks; canonical hosted project/job integration unfinished. |
| F real provider app generation | NOT RUN | No qualified live provider policy/budget or connected dispatch. |
| G approved isolated build/private preview | NOT RUN | No configured cloud approved runtime/released image/gateway. |
| H persistent app data after restart | NOT RUN | No real generated application/database deployment. |
| I conversational additive edit | NOT RUN | Live source/schema/rebuild path absent. |
| J chat and button same Publish API | NOT PASSED | Durable full-stack publication API/UI not implemented. |
| K logged-out public application/private records | NOT RUN | No generated-app public URL. |
| L republish and safe code rollback | NOT RUN | No publication history/provider receipt/database policy. |
| M cancel/restart/lease/reconnect/cleanup | NOT PASSED | Supporting E1/native contracts pass; no cloud execution campaign. |
| N no developer Mac dependency | NOT PASSED | Public site is static; connected cloud services absent. |
| O clean self-host account/BYOK/project flow | NOT PASSED | Clean install/tests and local account harness pass; complete infrastructure-backed flow remains absent. |
| P genuine generation-to-publication recording | NOT PASSED | Only a clearly labeled local account regression is recorded. |

Reproduce with [public-accounts.md](../../operations/public-accounts.md), then the exact commands in verification.json. The guide covers configuration names, role/migration review, bounds, delivery, self-host infrastructure, shutdown and rollback. A clone alone does not supply the approved sandbox or a working hosted builder. Preserve external credentials in secret storage; never send them in chat.

## Handoff required to finish the release

Complete the implementation/integration rows above, then supply the exact missing service/account/configuration references and an applicable explicit spending envelope. The existing Vercel account is accessible; the required worker/sandbox/private storage/gateway/email setup is not present there. Access to Gmail is not a substitute for infrastructure, deployment authority or model budget. Freeze the fully connected commit, repeat every live acceptance gate and clean self-host reproduction, record its genuine flow, and only then promote production/merge a release-ready PR. This task's PR stays draft and must not be represented as completion of the full request.
