# Authentication, Neon and onboarding integration

> Historical RFC/checkpoint document. The current application uses Next.js, Better Auth and `src/server` / `worker`. Old Vite/Neon Auth setup commands and pending architecture decisions below are historical context, not current setup instructions. See [PR #7 reconciliation](reports/pr7-reconciliation.md).

The retained `check-cloud-readiness.mjs` command now checks the current restricted Better Auth/E1 installation. Use the [current read-only preflight guide](operations/hosted-readiness.md); the old four-setting/JWKS result below is historical and is not a release gate.

## Status

The opt-in cloud implementation adds Neon client auth, verified JWT authorization, account-owned PostgreSQL briefs, a resumable first-project flow, account export, and local import. The default build remains the local demo. Live authentication and HTTPS staging verification have not been performed. Do not enable public registration based on local tests alone.

Provisioned through the signed-in Neon Console on September 9, 2026: a fresh free-plan project `forge-auth-staging` (`flat-pond-32100882`), PostgreSQL 18 in AWS Ohio, with Neon Auth enabled and email verification required. The existing project was untouched. Neon named the initial branch `production`; this is a staging-only project, not a production release. Database credentials have not been installed, migrations have not been applied remotely, and isolated test branches remain to be created. The Console currently offers shared Google credentials and shared email with verification codes; GitHub/custom Google credentials and a verified custom sender for the implemented verification-link flow remain required. No users were created.

The Console explicitly warns that restricted signups are not supported. The Forge feature flag gates the application, not the provider's public signup endpoint. Resolve registration restrictions before production provisioning; do not assume trusted redirect origins provide a signup allowlist.

## Configure staging

1. Create a Neon project and enable managed auth. Create isolated staging/test branches; use synthetic identities rather than cloning production session data.
2. Configure verified email/password registration, a custom sender for verification links and resets, and Google/GitHub OAuth credentials in Neon. Each provider's callback is `NEON_AUTH_BASE_URL/callback/google` or `/callback/github`. Add the exact staging origin to Neon trusted domains. Configure account deletion, explicit linking only (no automatic email-based linking), last-method protection and fresh-session checks in the provider. If these are unavailable, that is a release blocker.
3. Set `DATABASE_MIGRATION_URL` to the migration role's connection and run `npm run db:migrate`. This runner checks migration checksums and serializes migrations in a transaction. Do not use `drizzle-kit push` against staging or production. `db:generate` produces candidate schema diffs for review; policy/FK/security SQL must be preserved in reviewed migrations.
4. Provision a LOGIN role with a separately generated secret, membership in `forge_app`, and no owner, superuser or BYPASSRLS permissions. Set `DATABASE_URL` to that application's connection. The migration role and runtime role must be different. Never put either in a VITE variable.
5. Set `NEON_AUTH_BASE_URL`, `FORGE_APP_ORIGIN` (exact origin, no trailing slash), and `FORGE_AUTH_ENABLED=true`. Run `npm run api:cloud` behind the staging host's HTTPS reverse proxy; the API listens on loopback port 3001. Route `/api/*` to it and serve Vite build output from the same public origin. Do not run the legacy planning API behind a cloud deployment.
6. Build with `VITE_FORGE_AUTH_ENABLED=true npm run build`. This chooses the cloud client; missing API configuration shows a recoverable unavailable screen instead of falling back to demo storage.
7. Verify Google and GitHub with fresh accounts, email delivery, verification/reset expiry, linking/unlinking, account deletion and cookie restrictions in Chrome, Firefox and Safari. Neon manages HttpOnly session cookies; API JWTs are held only for each request and not saved to browser storage.

## Data and API

`GET /api/config` returns the public auth endpoint. Other endpoints require a signed Neon JWT (EdDSA, exact issuer and audience, expiration, verified email), and each transaction checks the identity still exists and is not banned. `GET /api/me` returns the user and onboarding; `GET/PATCH /api/onboarding` stores version, stage, draft and revision; `POST /api/onboarding/complete` atomically creates the first project once.

`GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, and `POST /api/projects/:id/duplicate|restore` provide project CRUD. Mutations require the current revision; a stale edit returns 409. Lists return at most 50 items and a next offset. `POST /api/projects/import` accepts up to 100 validated local records in a 1 MiB request. Content-derived import keys prevent retry duplicates while changed briefs become separate records. Local originals are retained. `GET /api/account/export` exports onboarding and all active/deleted briefs.

Neon owns identity/session/account records. Forge identity references cascade on provider-side account deletion. The UI calls Neon account-management methods; provider configuration and live behavior must be verified before those controls are advertised as production-ready. The export covers Forge-owned data, not provider credentials or session secrets.

Row security checks the verified subject through a transaction-local setting and workspace membership. The application does not expose arbitrary SQL. The SQL migration is the authoritative source for foreign keys, RLS policies and grants. The initial workspace is personal-only; team membership changes are intentionally unavailable.

## Verification and remaining release gates

Local evidence (September 9, 2026): `npm run verify` passed lint, strict TypeScript, 114 tests across 13 files, and the default build. The cloud-flag build also compiled. The UI journey test uses a mocked identity service; PostgreSQL policy tests use PGlite, not a live Neon branch. Browser inspection confirmed the missing-service recovery screen, not successful authentication. The complete light/dark viewport, keyboard, zoom and reduced-motion matrix remains unverified. Vite also reports an unrelated ancestor Expo tsconfig warning; it did not fail the build.

Run `npm run verify`. Database tests use PGlite's PostgreSQL engine under the restricted application role, including direct cross-workspace insertion rejection, stale edits, delete/restore, import idempotency and atomic onboarding completion. HTTP tests cover authentication, origin rejection, validation and ownership injection. These tests do not prove the managed Neon environment has the expected schema or configuration.

Every API call additionally binds the JWT subject to an active row in `neon_auth.session`, using the SDK session token in `X-Forge-Session`. This rejects revoked sessions even while their JWT remains valid. Tokens are never persisted by Forge or included in logs/exports. Live staging must verify that the pinned SDK and managed service expose the expected session token and column contract; missing/mismatched session evidence fails closed. Deleted/banned users are rejected through database checks; logout clears local client state. The local rate limiter is per-process: use a shared ingress limiter before horizontal scaling and configure Neon auth endpoint limits separately.

Neon's documentation identifies cross-domain session-cookie restrictions, especially Safari ITP. Verify the selected same-site/custom-domain or supported proxy configuration on staging before launch; do not claim cross-browser auth completion based on a successful JWT unit test. Managed auth is beta at the time of this implementation.

Restore drill: create synthetic account/brief, capture a Neon restore point, make a reversible test mutation, restore to a separate branch, verify the brief/schema/RLS and auth environment, and record timing/results. Never restore over production for a drill. No live restore or production provisioning has been executed.

Implemented follow-up: `POST /api/onboarding/start` begins another four-stage guide with optimistic revision checks, preserves the first completion timestamp, and never deletes existing briefs. An unfinished guide resumes instead of being discarded. Settings replays a three-part native-dialog introduction without database writes. Hosted planning now verifies the session, reads only an owned, non-deleted saved brief, checks its revision, and calls the existing NVIDIA text-only adapter. Enable it separately with `FORGE_HOSTED_PLANNING_ENABLED=true` and a server key; its single-instance budget defaults to 20 requests/day and one active call. The UI explicitly asks before sending the brief, escapes the response, and offers a download. Responses are not persisted and do not represent generated applications. Do not scale this process without shared quotas.

Known scope gaps: fresh re-authentication for OAuth-only deletion/linking relies on provider configuration and remains unverified; OAuth-only deletion still needs a complete passwordless re-authentication path. The current staging shared email sender uses codes whereas this client implements verification links, so a verified custom sender remains required. Provider-side last-login-method protection and account deletion must pass live tests. Public production enablement remains blocked until these and the staging checklist are resolved.

Follow-up local evidence: all 18 auth/cloud tests passed, including repeat-guided creation preserving projects, introduction replay without persistence writes, owned/revision-checked planning, quotas and provider failures. Strict TypeScript and the cloud build passed. The full repository verification attempt was blocked by lint errors in independently modified engine/template files; those were left untouched. The authenticated visual matrix and real cross-device tests remain pending. Run the read-only configuration check with `node --env-file-if-exists=.env.local scripts/check-cloud-readiness.mjs`; the current run reports all four required cloud settings missing, without exposing secrets.

## Sources

- [Neon OAuth configuration](https://neon.com/docs/auth/guides/setup-oauth)
- [Neon email verification](https://neon.com/docs/auth/guides/email-verification)
- [Neon JWT verification and cookie limitations](https://neon.com/docs/auth/guides/plugins/jwt)
- [Neon supported features](https://neon.com/docs/auth/roadmap)

These are the documented contracts used for the integration. SDK package versions are locked in package-lock.json.
