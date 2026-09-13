# User login readiness — September 11, 2026

**The account build is now deployed to production.** [Open Forge](https://forge-ai-demo-omega.vercel.app/#/login). A real Google sign-in on this exact URL opened the existing “Login readiness check” project. The deletion 404 and strict cross-site-cookie login failure are fixed. Full verification passed, and live browser session and database recovery checks passed.

**The exposed DeepSeek provider key has been rotated and revoked.** The old `ANTHROPIC_AUTH_TOKEN` returns HTTP 401 and its replacement returns HTTP 200 from the provider's models endpoint. The replacement is stored in the existing local `~/.deepseek_key` file with mode 0600; restart existing ClaudeCode sessions to load it. The two unrelated provider keys were preserved. Neither old nor replacement provider key is included in the account deployment.

## What was fixed

- Authentication now uses the pinned Neon SDK's framework-independent server proxy at `/api/auth`. Cookies are Secure, HttpOnly and SameSite=Lax on the application origin. Only an explicit set of user-authentication endpoints is reachable; administrative endpoints and caller-selected upstream URLs are excluded. POST requests require the exact application Origin and bounded JSON bodies. Foreign-origin/cross-site requests are rejected. Session reads bypass cookie caching, and account APIs still verify the signed JWT and the live database session.
- Google callback verifiers are exchanged against the HttpOnly managed challenge cookie through the proxy and removed from navigation history before rendering. The server cookie signing secret is configured only in the server environment. Twelve additional regression cases cover the proxy boundary, SDK cookie rewriting and verifier handling.

- The pinned Neon SDK (`0.5.0-beta`) replaces `session.token` with a JWT. Forge now reads the original opaque session credential separately from the managed, uncached `/get-session` response and reads the JWT from `set-auth-jwt`. Server signature, verified-email and live database session checks remain enforced. Malformed session responses fail closed with a recoverable service error.
- Session loss, account changes and authentication failures clear private account state and empty account dialogs. Successful login and sign-out clear stale feedback.
- Self-service deletion uses `DELETE /api/account` with an exact `DELETE` confirmation. The server chooses the identity from the verified session; the caller cannot supply a user, project or branch ID. A session must be unexpired and created within five minutes. The UI provides a sign-out/sign-in return to Settings, without requiring a password from an OAuth-only account.
- Deletion calls Neon's managed branch user-deletion API using a server-only, project-scoped key. It confirms that the user is absent from the database before reporting success, including after an uncertain upstream response. It never automatically replays the administrative request. Managed foreign keys remove the account's Forge records.
- Migration `0002_session_freshness.sql` grants read access only to the session creation timestamp. The runtime still cannot write managed authentication tables. The readiness script now requires the deletion configuration and checks the timestamp grant.
- Vitest now uses at most two workers. This resolved database setup and WASM timeouts under resource contention without increasing timeouts, skipping checks, or weakening assertions. A duplicate lint global declaration was removed.

## Live account evidence

The staging build and production build have the same application assets and account server code. Their configured application origins differ.

- Google sign-in, guided project creation, viewing, sign-out and reopening across sign-ins passed on staging. Production Google sign-in and opening that same persisted project then passed on the main URL.
- A disposable plus-address account received and used a real email verification code. It created “Disposable deletion proof.” Email login in Firefox opened the same saved project as the independent in-app browser.
- “Sign out other sessions” succeeded. Refreshing Firefox rejected its revoked session and returned it to login.
- The disposable account completed the new sign-in-again flow and returned to Settings. “Delete my account” succeeded and returned to login with a deletion confirmation.
- Refreshing the other Firefox session after deletion rejected it. The deleted credentials could no longer sign in. A database check found zero matching accounts and zero matching disposable projects, while retaining the original account and project. [Deletion evidence](evidence/login-20260911/deletion.json).
- Earlier live checks verified that a second account could not view the original account's project. Password recovery email delivery and reset succeeded; the previous password was rejected and the replacement signed in. The reset token was removed from the URL.
- On production, `/api/config` returned 200 with account deletion and Google enabled, anonymous `/api/me` returned 401, and a foreign-origin request returned 403.

The production proxy follow-up also passed email login, fresh-session reauthentication and self-deletion of the Safari/Firefox test account. A database check confirmed zero test accounts and projects, while retaining the original account and project. Production Google login then reopened the original “Login readiness check” project. [Cookie-proxy follow-up evidence](evidence/login-20260911/cookie-proxy.json). Safari private login and Settings access were also verified through the new staging proxy; Safari regular/private project reload was verified earlier in this same follow-up before switching to the proxy.

The DeepSeek rotation used the existing authenticated Firefox provider session. The old `ClaudeCode` key was replaced locally and revoked only after the replacement was verified. Its two unrelated keys were preserved. The temporary credential transfer file was removed. [Redacted rotation evidence](evidence/login-20260911/provider-rotation.json).

The original account was not deleted. OAuth-only self-deletion and provider linking/unlinking were not exercised on that account. The password-independent fresh-session path is implemented and covered by server checks; this is not a claim that every identity-provider scenario has been tested.

## Recovery and database boundaries

A separate branch was created from the saved WAL position in the configured Neon database. Its user count, project count and project-content digest matched the source checkpoint: one user and one project. The source was never restored or overwritten. The temporary recovery branch was deleted after verification. [Recovery evidence](evidence/login-20260911/restore.json). This proves recovery of the checked database contents; authentication on the restored branch and a full disaster cutover were not tested.

The existing `forge-auth-staging` project (`flat-pond-32100882`), branch `production` (`br-fragrant-voice-ayq82j6b`), database `neondb`, now serves the production account deployment. The staging alias uses the same account store; it is not an isolated database environment. Future destructive testing must use disposable identities or a separate branch. The unrelated `forge_control_v1` database and separate Next.js application were not changed.

The runtime role is `forge_vite_accounts_runtime`, inheriting `forge_app`, with no superuser, BYPASSRLS, CREATEDB or CREATEROLE attributes. The four account tables enforce RLS. Migration and runtime connections remain separate and use certificate verification. Migration credentials were not uploaded to Vercel. The account-deletion key is a Vercel sensitive server variable scoped to this Neon project; it is never a client variable. A temporary key displayed by an automatic browser snapshot was revoked and replaced before deployment.

## Verification

`npm run verify` passed in a local verification copy with freshly installed locked dependencies: **582 passed tests, four skipped tests**, lint, strict TypeScript and the default build. [Full log](evidence/login-20260911/verify.log). The focused account suite passed **48 tests across ten files**. [Account test log](evidence/login-20260911/account-tests.log). The cloud build and remote Vercel Node 24 preview and production builds passed. `git diff --check` passed. A bounded scan of all six HTML/CSS/JavaScript files in the new account deployment package found no configured credential values, including the replacement provider key and server cookie secret.

The original iCloud checkout stalled on offloaded files. Clearing the npm download cache recovered about 12 GB; verification used a fresh local dependency installation and copied source/test fixtures. Seven unrelated offloaded files were omitted from that copy: two historical build logs, README, Prettier configuration, the skill-sync script and two skill reference JSON files. The acceptance-ledger fixture was included. Earlier failing runs remain historical failures; the passing run followed the status-code test correction and bounded worker configuration.

Earlier UI checks covered light/dark at 390, 768 and 1440px, keyboard focus/navigation, Firefox 200% zoom and macOS reduced motion. This follow-up changed the deletion controls using existing styles, with no CSS changes. The new deletion flow was checked live in the in-app browser; Firefox email login, shared saved data and session rejection were checked live. Safari regular and private email login, saved-project access and full reload passed. Firefox with “Block all cross-site cookies” initially failed with the direct managed-domain integration. After the proxy fix, private Firefox sign-in, saved-project opening, reload and rejection after cross-browser session revocation passed on staging. Production Firefox private sign-in, saved-project viewing and reload then passed with all cross-site cookies blocked. The original “Isolate cross-site cookies” preference was restored and confirmed. Standalone Chrome, reset-token reuse/expiry and all provider-linking combinations remain unverified.

## Deployment and scope

| Purpose | URL |
| --- | --- |
| Production | https://forge-ai-demo-omega.vercel.app |
| Production deployment | https://forge-ai-demo-ol681boyz-biswas07.vercel.app |
| Staging alias | https://forge-ai-accounts-staging-biswas07.vercel.app |
| Preview deployment | https://forge-ai-demo-f7xgzwnqw-biswas07.vercel.app |

Both exact application origins are trusted in Neon. Only email and Google are enabled; GitHub is not configured. Public signup is open, and trusted origins are not a signup allowlist. The API rate limiter remains per function instance; shared ingress limits are needed before scaling. The same-origin proxy resolved the observed cross-domain cookie failure; evidence covers the specific Safari and Firefox settings described above, not every browser or identity-provider combination.

This deployment provides accounts, saved briefs and design choices. It does not provide a deployed full-stack application-generation engine. Optional provider connections and hosted generation remain disabled on these deployments.

## Reproduce

```sh
node --env-file-if-exists=.env.local scripts/check-cloud-readiness.mjs
npm run verify
node scripts/package-cloud-vercel.mjs
```

The packaging script uploads only an explicit build/server allowlist. Configure secrets through the server environment; never upload `.env.local`, migration credentials or the working tree. See [the Neon integration guide](../auth-neon.md).
