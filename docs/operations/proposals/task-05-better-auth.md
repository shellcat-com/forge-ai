# Single-authority identity configuration proposal

Proposal for Task 01 integration; no live issuer/client, app schema migration or production startup is claimed. Canonical `AGENTS.md` records approval for Better Auth + Neon; the older engine decision sheet predates that direction. Keep `src/server/auth/config.ts` as the account authority and Neon as its PostgreSQL hosting direction. The prior `server/cloud` Neon Auth JWT/session prototype is historical; do not enable it or import its sessions/users into engine authority. Installed SDKs were not used as selection evidence.

## Exact dependency and configuration delta

Task 01 owns root manifests/lock, `src/server/auth`, Next.js routes and SQL. Proposed dependency: `@better-auth/oauth-provider` **1.7.3**, matching current Better Auth **1.7.3**. Registry metadata retrieved 2026-09-10 UTC reports peers `better-auth ^1.7.3`, `@better-auth/core ^1.7.3`, `better-call 1.4.0`, `@better-auth/utils 0.4.2`, `@better-fetch/fetch 1.3.1`. Tarball integrity is recorded in the adjacent schema inventory. It was unpacked in a temporary directory for inspection, not installed into shared dependencies.

The current maintained provider plugin supports authorization code + S256, administrator-managed clients and OIDC ID tokens. The previous `oidcProvider` plugin was removed in 1.7. Use the existing authority with the new plugin and `jwt()`. [Official configuration](https://better-auth.com/docs/plugins/oauth-provider), [1.7 migration guide](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/guides/1-7-upgrade-guide.mdx).

Proposed `src/server/auth/config.ts` delta (requires dependency/schema review before application):

```diff
+import { jwt } from 'better-auth/plugins'
+import { oauthProvider } from '@better-auth/oauth-provider'
 // Inside existing betterAuth options; retain invite hooks and existing login methods.
+disabledPaths: ['/token'],
-plugins: process.env.BETTER_AUTH_API_KEY ? [dash({ apiKey: process.env.BETTER_AUTH_API_KEY })] : [],
+plugins: [
+  jwt({ jwks: { keyPairConfig: { alg: 'RS256' } } }),
+  oauthProvider({
+    loginPage: '/login',
+    consentPage: '/oidc-consent',
+    scopes: ['openid'],
+    grantTypes: ['authorization_code'],
+    allowDynamicClientRegistration: false,
+    allowUnauthenticatedClientRegistration: false,
+    clientPrivileges: async () => false,
+  }),
+  ...(process.env.BETTER_AUTH_API_KEY ? [dash({ apiKey: process.env.BETTER_AUTH_API_KEY })] : []),
+],
```

This delta intentionally leaves ordinary client self-management unavailable. A separate trusted operator composition must register the one confidential client through the plugin's administrator API, then remove that provisioning capability from runtime. Registration fields: `redirect_uris: [exact Forge HTTPS /api/v1/auth/callback]`, `token_endpoint_auth_method: 'client_secret_basic'`, `grant_types: ['authorization_code']`, `response_types: ['code']`, `scope: 'openid'`, public immutable subject type, PKCE required, no refresh/offline grants, no wildcard redirect, no dynamic clients. Verify the plugin's issued subject equals the immutable Better Auth user ID; pairwise subjects require a separately recorded immutable mapping and cannot be guessed. Client ID/secret are server configuration, never frontend environment variables.

The extracted metadata retains the [upstream MIT license and attribution](task-05-better-auth-LICENSE.txt). The adjacent [generated schema metadata inventory](task-05-better-auth-schema.json) is the exact extracted plugin schema for `oauthClient`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `oauthClientAssertion` plus JWT `jwks`, including fields/references/index declarations. It is **not an executable or applied Drizzle migration**. Task 01 must generate the Drizzle delta against the existing custom `forge_user`/`forge_session` tables and inspect FK names, private signing-key protection, constraints and token retention before assigning a migration. Do not run a generic migration against live Neon or overwrite existing auth tables. Even with refresh grant disabled, the plugin schema must remain compatible with its version.

Route delta: retain the existing `/api/auth/[...all]` Better Auth handler. Verify `{issuer}/.well-known/openid-configuration` and JWKS reach it; explicitly forward discovery if Next.js routing does not do so. Add a consent page only if consent is used; otherwise operator-register a trusted first-party client with reviewed consent exemption. Task 08 must wire the existing login page to the OIDC query continuation (the current page does not establish this integration). Route `/api/v1/auth/*` and `/api/v1/session` to the canonical control transport via trusted same-origin routing. Do not proxy anonymous callers into the legacy local-owner fallback. The remaining application project/provider routes must use the same reviewed control session/membership authority before hosted rollout.

## Placeholder-only engine setup

```dotenv
FORGE_AUTH_MODE=hosted
BETTER_AUTH_URL=https://FORGE_PROJECT.vercel.app
BETTER_AUTH_SECRET=REPLACE_WITH_SERVER_SECRET_REFERENCE
DATABASE_URL=postgresql://AUTH_LOGIN:REPLACE@NEON_HOST/AUTH_DATABASE?sslmode=verify-full
FORGE_OIDC_ISSUER=https://FORGE_PROJECT.vercel.app/api/auth
FORGE_OIDC_CLIENT_ID=REPLACE_WITH_REGISTERED_CONFIDENTIAL_CLIENT_ID
FORGE_OIDC_CLIENT_SECRET=REPLACE_WITH_SERVER_SECRET_REFERENCE
FORGE_OIDC_AUTHORIZATION_ENDPOINT=https://FORGE_PROJECT.vercel.app/api/auth/oauth2/authorize
FORGE_OIDC_TOKEN_ENDPOINT=https://FORGE_PROJECT.vercel.app/api/auth/oauth2/token
FORGE_OIDC_JWKS_URI=https://FORGE_PROJECT.vercel.app/api/auth/jwks
FORGE_OIDC_REDIRECT_URI=https://FORGE_PROJECT.vercel.app/api/v1/auth/callback
FORGE_CONTROL_SESSION_KEY=REPLACE_WITH_32_RANDOM_BYTES_AS_64_HEX_CHARACTERS
```

These are examples, not existing environment-loader flags. Task 01 maps them to `OidcConfiguration` and explicitly constructs `new SessionService(controlDb, new OidcIdentityAdapter(config), serverSessionKey, exactOrigin)`. Retain the standalone fixture CLI as a laboratory-only composition; do not mount it in hosted Next.js. Changing a flag does not configure the database, issuer, routes or live generation. `ControlDatabase.check()` currently requires synthetic settings; production schema/config readiness remains Task 01/06 work. The origin and complete endpoint paths are pinned from verified metadata, including the issuer path/trailing-slash bytes; never normalize an ID-token issuer to its origin. No ID/access/refresh token is returned to the browser or used as engine bearer authority.

## Admission and revocation

`IdentityOperator` is a **separately held trusted operator Pool**, outside the API/worker. Normal API/worker roles lack user/membership insert/update rights and cannot use this operator capability. Operators create an active workspace through the coordinated provisioning path, verify the existing Better Auth immutable subject through trusted administration, then call `admit({operatorId,requestId,workspaceId,issuer,subject,role})`. The operator ID is provisioned service identity; never accept it from public JSON. Exact known-subject admission is the engine invitation; there is no email-based auto-link or public registration. Existing Better Auth email invitations still gate account creation upstream. No admission code, password, provider key or user email is written to engine audit metadata.

Admission/role changes and `revoke` serialize with control settings and workspace locks, append the existing audit table, invalidate every session and preview ticket for that user, and protect the last owner from accidental removal. Each attempt is one PostgreSQL transaction. Existing rows are prelocked with NOWAIT and a 25ms lock timeout; lock contention rolls back the whole attempt before a bounded retry (12 attempts). Exhaustion returns `IDENTITY_OPERATOR_BUSY_RETRY` without partial changes. This prevents the operator from waiting in reverse order against session-first control/preview requests. Operator retries are state-safe but append another audit event; `requestId` is correlation, not a deduplication guarantee. A dedicated production operator role's exact grants are Task 01's SQL review; current tests use the disposable migration owner, not a production privilege attestation.

Task 01's remaining authority bridge must handle Better Auth account disable/delete, upstream session revocation and sign-out hooks. It must revoke mapped engine sessions/tickets and Task 07 gateway sessions, preventing a stale upstream account from retaining control. Local engine logout already revokes its opaque session and all user preview tickets; it does not log the user out of the upstream Better Auth account. The adapter requests a login prompt on subsequent authorization. Do not claim global sign-out until that bridge is implemented and tested. Existing engine polling reauthorizes SSE; Task 07 must join current user/session/membership for ticket exchange and every gateway request, without trusting an earlier handoff indefinitely.

Credential connections use `CredentialConnectionAuthorizer.withAuthorization(request, action)` so the fresh owner session and membership locks remain held through scoped credential metadata commit. Only metadata transaction authority crosses this interface; provider secrets stay in Task 04. Reads/decisions can use `authorize`, but it is not sufficient for a later write. Strip unrelated transport fields before passing the strict request; Task 04 must establish authenticated TLS from trusted listener/proxy configuration before reading key bodies.

## Recovery and demo access limits

Only invited owner access is required to record the demo; two separately controlled test accounts are needed for live negative acceptance. No access to those accounts, registered client, live session key, approved control DB or issuer configuration was supplied. Do not send those secrets in chat or evidence. Use the existing approved secret/access system.

Email/password recovery works only if the existing email-delivery configuration is operational. Social-account recovery belongs to the selected upstream login service. If the last Forge owner loses that account, recovery requires the trusted operator to verify a replacement immutable identity and admit it before removing the old membership; never silently rebind by matching email. Lost session-encryption/HMAC key invalidates CSRF and outstanding PKCE transactions: revoke sessions, rotate the key and require a new login. Restore/rotation must not resurrect revoked sessions or membership; include that in Task 06 recovery drills.

The public portfolio is a separate Vercel-hosted website and requires no Forge account. Its anonymous visitors receive no control API, generation, account, session or provider-key authority. A Vercel-issued HTTPS URL satisfies the no-domain-purchase direction; the private-preview gateway remains a separate Task 07 acceptance requirement.
