# Public accounts: deployment and verification

This branch implements public Better Auth signup and local integration tests. It does **not** enable the full hosted builder. Production account delivery, the Better Auth→RFC control bridge, BYOK routes, approved cloud execution and in-product publication still need integration/configuration and live acceptance. Do not replace the Vercel availability page with this branch as a completed release.

## Supported setup

Use the root's Node 24.20.0 and npm 11.11.0 toolchain. PostgreSQL 14.18 is the native test database in this campaign; Neon is the selected hosted PostgreSQL service. Keep the auth/application database separate from every generated application's database. Neither database compute nor Vercel frontend hosting supplies the durable worker or sandbox.

1. Clone the reviewed branch without copying private environment files or dependencies. Run `npm ci --no-audit --no-fund` and `npm run verify` with native PostgreSQL tools on PATH.
2. Create a dedicated Forge database through the approved infrastructure account. Configure its migration-owner URL privately as `DATABASE_DIRECT_URL`, then explicitly run `npm run db:migrate`. Existing migration hashes are verified; changed applied migrations abort. Application 0005 adds the account suspension column and four bounded admission rows. Application 0004 remains reserved for the control identity bridge; this is intentional and independent of engine migration numbers. Existing projects/accounts remain intact.
3. Review [public-auth-grants.sql](../examples/public-auth-grants.sql) before applying it to that **dedicated** database. It revokes `PUBLIC CREATE` on the public schema, affecting all database users; it must not be run blindly on a shared database. It creates a NOLOGIN `forge_auth_api` role, with only account/session/verification/invitation/admission table access. Bind a separate secret-managed LOGIN to it. Do not use the migration owner, application login, PostgreSQL superuser or a role with project/DDL/server-file access. The account handler checks these privileges and fails closed.
4. Configure server-only `FORGE_AUTH_DATABASE_URL` and `FORGE_AUTH_DATABASE_HOST` for that narrow login. The DSN must identify that exact public hostname and use validated TLS; the existing PostgreSQL configuration adapter rejects certificate-bypass query parameters. `DATABASE_URL` remains the separate application login. The auth pool never falls back to it. Production database network/grants/TLS must be tested on the actual Neon deployment; native tests inject an isolated Unix-socket pool only inside test code.
5. Configure `FORGE_AUTH_MODE=hosted`, `FORGE_SIGNUP_POLICY=public`, exact HTTPS `BETTER_AUTH_URL` (origin only), and a cryptographically random `BETTER_AUTH_SECRET` of at least 32 characters. Use the same stable secret across Vercel instances. `VERCEL` requires explicit hosted mode; omitted/misspelled/local mode fails closed. No anonymous local-owner fallback is available on Vercel. Preview deployments need their own exact origin and isolated test database/configuration.
6. Configure the existing `FORGE_EMAIL_ENDPOINT` and `FORGE_EMAIL_TOKEN` adapter. The HTTPS endpoint accepts authenticated JSON `{to, subject, url}`. It must actually deliver the provided verification/recovery link, restrict sender/domain, enforce retention and return success only on accepted delivery. The adapter awaits a response for at most ten seconds, rejects redirects and treats non-success as a delivery failure. An HTTP 202 from this endpoint is **not proof of mailbox delivery**. No email vendor, free entitlement or sender configuration is implied by this interface. Browser tests use a synthetic in-memory transport, never Gmail delivery.
7. If selected, configure existing Google/GitHub client credentials and exact callbacks `/api/auth/callback/google` and `/api/auth/callback/github`. Only configured methods appear. Account linking is disabled, and provider tokens are encrypted through Better Auth. Recovery for a social identity depends on that provider. These provider flows were not live-tested here. Better Auth dashboard/infra is optional and does not substitute for the delivery adapter or account database.
8. Run the real mailbox and two-account acceptance checks below before advertising hosted accounts. Do not enable generation/publication until their separate gates also pass.

Never place secrets in `NEXT_PUBLIC_*`, browser persistence, screenshots, commands committed to Git, prompts, source exports or PRs. Enter them through the intended secret manager/configuration UI. Auth database/token/backup credentials remain entirely outside generated-code execution.

## Behavior and limits

Public signup creates an ordinary Better Auth account without an invitation. Email/password login requires verification. Server password length is 12–128 characters. The existing optional `FORGE_SIGNUP_POLICY=invite` retains private-installation admission; Better Auth intentionally gives a generic signup response for denied/duplicate registration to reduce account enumeration. No engine operator or cross-tenant membership is minted by signup.

All public account requests pass exact Host/Origin checks; cross-site GET exceptions are restricted to the supported OAuth callbacks and verification/recovery navigation. Better Auth still verifies state/tokens and callback destinations. POSTs are capped at 16 KiB, compressed bodies are rejected, and the Vercel route has a fifteen-second maximum duration. No session or auth response should be cached.

PostgreSQL atomically admits at most 200 account requests/minute per installation, 20 password signups/hour, 30 combined signup/recovery/resend requests/hour and 60 password sign-ins/minute. Failed requests count. Counters are four fixed rows, with database time and persistent windows. These are intentionally conservative aggregate abuse limits: spoofing proxy IP headers cannot evade them, but one abuser can consume capacity for everyone. They are not a measured capacity claim or a replacement for production edge abuse protection. There is no paid Forge account tier.

Sessions use Secure/HttpOnly/SameSite=Lax cookies, twelve-hour absolute expiry, fifteen-minute freshness and no cookie cache. Password recovery revokes existing Better Auth sessions. The account adapter rechecks suspension on every protected application request. A trusted operator can suspend a known immutable user ID and delete its sessions in a reviewed transaction; no public administrative endpoint is added. Suspension is reversible, whereas deleted sessions must sign in again. Do not infer RFC engine/preview revocation from these checks: the lifecycle bridge is still absent and those services must remain unexposed.

Email delivery failures are tracked per request with AsyncLocalStorage because Better Auth can swallow transport exceptions. A swallowed failure becomes a safe 503 instead of a misleading successful inbox instruction. Resend verification is available after a temporary delivery failure. Recovery tokens remain single-use under Better Auth. No secret-bearing response body or email link is logged by the adapter.

The legacy local worker is rejected before opening PostgreSQL in hosted mode, the operator provider registry is unavailable there, and local preview URLs/heartbeats cannot count as hosted readiness. This preserves the existing development workflow while preventing it from becoming a production fallback.

## Reproduction

```sh
npm ci --no-audit --no-fund
npm run verify
npm run test:db:control
npm run control:build
npx vitest run tests/auth/public-auth.test.ts --maxWorkers=1
npx playwright install firefox
FORGE_AUTH_BROWSER=firefox node --import tsx tests/auth/browser.ts
```

Native tools `postgres`, `initdb`, `pg_ctl` and `openssl` must be on PATH, running as a non-root user. The browser harness exclusively acquires `/tmp/forge-native-verification.lock`; do not delete another verifier's lock. It creates and removes its own PostgreSQL/TLS/browser resources, requires a clean checkout without private environment files, and uses the built Next.js application. It never executes generated code. Its custom local HTTPS listener is a regression harness, not a production hosting recipe; deploy Next.js using Vercel or the documented standalone application server. Browser trust bypass applies only to its temporary self-signed local test certificate.

The resulting `local-auth-regression.webm` is explicitly labeled **local regression, synthetic mail, generation/publication unavailable**. Playwright records the page viewport, not browser chrome or the mailbox. All accounts/passwords are synthetic; token-bearing navigation is absent from video chrome. Inspect the output before publishing it. The full live generation-to-publication demonstration cannot be replaced by this recording.

For the actual hosted release, independently verify: public signup without an invite; delivery to a controlled mailbox; unverified denial; verified login; expiry; logout; reset-link delivery and replay denial; prior-session revocation; two-account project/key/artifact/preview isolation; actual model generation; approved isolated build; persisted application data; conversational edit; both Publish entry points; fresh anonymous public access; republish/rollback; worker restart/cancel/lease cleanup; and operation with all local services stopped. Record failures/skips and exact deployed commits/URLs. Run destructive fault tests only against disposable resources with an applicable budget.

## Rollback and backups

Keep the existing production alias until the complete release passes. To roll back this application milestone, redeploy the previous reviewed commit. Application migration 0005 is additive and should remain in place; do not drop accounts or revert database contents automatically. Restore backups only through a reviewed procedure that also prevents resurrecting sessions or suspended accounts. Backups retain historical auth credentials/tokens according to the infrastructure retention policy; this branch does not establish Neon backup/PITR or deletion guarantees. Lost/rotated Better Auth secrets require reauthentication and invalidation of outstanding verification/recovery links as applicable. Do not claim a backup recovery drill from local synthetic tests.

Upstream behavior was checked against the installed Better Auth 1.7.3 code and [configuration options](https://better-auth.com/docs/reference/options), [session management](https://better-auth.com/docs/concepts/session-management), and [email/password guide](https://better-auth.com/docs/authentication/email-password). Repository tests, not documentation alone, establish the local results.
