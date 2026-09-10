# Task 05 — identity adapter and owner access

2026-09-10 UTC. **Independent implementation and synthetic protocol/native/browser verification complete; live owner demonstration and shared application integration remain blocked.** No real-user login, provider key access, hosted session or preview handoff is claimed.

Branch: `codex/task-05-identity`; exact starting commit: `881e9ac2b11f8f168cb7849b77c4ee7439e55458`. PR base: `codex/demo-delivery-baseline` (Task 01 / PR #8), not `master`. Task 01 delegated identity-only auth branches in `engine/control/http.ts`; other control routes, startup/config, shared schemas, SQL, root dependencies and application auth files remain with Task 01. Worktree: `/tmp/forge-task05-identity`. Commit and PR identity are recorded in the delivery response and Git history rather than a self-referential commit hash.

## Delivered

- `OidcIdentityAdapter`: administrator-pinned HTTPS issuer/authorization/token/JWKS/redirect/client/algorithm, authorization code with S256, confidential Basic client authentication, exact issuer and exclusive audience, authorized-party check, signed ID-token expiry/issued-at/nonce checks. Only identity claims cross into control; access/refresh tokens and provider response bodies are discarded. No dynamic discovery, redirects, userinfo linking, automatic signup or fallback. Responses are bounded to 64 KiB with a five-second network timeout and a bounded JWKS cache.
- Existing `SessionService` now accepts explicit fixture or OIDC adapters. Identity provenance does not widen generation/runner provenance. OIDC sessions require an exact HTTPS origin; existing opaque hashed sessions, encrypted PKCE verifier, one-use state and invited `(issuer, subject)` admission remain canonical. Bootstrap creation time is covered by its HMAC nonce and enforced server-side for ten minutes. Callback checks transaction expiry again after token exchange and rejects adapter/claim provenance mismatch. Twelve-hour absolute sessions, CSRF and logout retain the existing database model.
- The exact GET callback permits cross-site **document navigation** needed by real OIDC while other routes retain Origin/Host/CSRF checks. Duplicate/unknown/error callback parameters and a mismatched optional response issuer fail closed. OAuth codes use bounded printable syntax instead of fixture token syntax. Existing Secure/HttpOnly/Lax cookies remain unchanged. No HTTP fixture identity-minting route was added or enabled.
- `IdentityOperator` admits known immutable subjects as owner/editor/viewer through a separately privileged operator Pool, protects the last owner, acquires conflicting rows with NOWAIT and bounded whole-transaction retry, audits each operation and atomically invalidates all user control sessions/preview tickets on membership changes. Normal API/worker grants cannot mint users/membership. This reuses existing SQL; it does not claim a reviewed deployed operator role.
- `CredentialConnectionAuthorizer.withAuthorization` requires a current owner membership, exact HTTPS Origin, CSRF and an engine session created within 15 minutes. It holds authorization locks through the supplied scoped metadata transaction. It never accepts provider secrets. Task 04 establishes actual TLS and handles encrypted keys/destination policies; a standalone authorization decision does not authorize a later unguarded write.
- A concrete Better Auth 1.7.3 provider/plugin, schema metadata, route, single-authority mapping, recovery and placeholder environment proposal is at [task-05-better-auth.md](../../operations/proposals/task-05-better-auth.md). This reconciles the canonical approved Better Auth/Neon direction with historical `server/cloud`; it is not a second account authority or an applied provider setup.

## Reproduction and evidence

Environment: macOS arm64; Node `v25.8.1`, npm `11.11.0`, native PostgreSQL `14.18 (Homebrew)`, installed Google Chrome `153.0.8010.36`. Node 25 is local compatibility evidence; the root requirement remains Node 24. Dependencies were reused **read-only** via a symlink to Task 01's frozen `/tmp/forge-task01-clean-reproduction/node_modules` because concurrent tasks had limited disk. No `npm ci`/install ran through that symlink. Captured terminal logs are normalized only for carriage returns/trailing whitespace. Root lock SHA-256: `849678e40252047ab5ed464cb2541eb2edb77ae2f1da1a7f801f155499353e93`. The final contention fix received focused ESLint/strict engine TypeScript and the 81-test native/browser regression run. The full local verify log predates that fix (622 passed); concurrent disk pressure prevented a second full local build. Final-head CI is a separate required check. This is not a clean dependency-install reproduction; CI must independently install the unchanged lock.

Run from this branch with the root lock installed and PostgreSQL utilities on PATH:

```sh
npm ci
npm run verify
npm run test:db:control
npm run control:build
FORGE_IDENTITY_BROWSER=true \
FORGE_IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
npx vitest run tests/engine/oidc-identity.test.ts tests/engine/identity.native.test.ts tests/engine/control.native.test.ts \
  --maxWorkers=1 --reporter=default --reporter=json --outputFile.json=docs/reports/evidence/task-05/identity-tests.json
```

`npm ci` above is the clean reproduction instruction, **not a command executed in the shared-dependency local run**. On a machine with Playwright's matching browser installed, omit the executable override. Browser harness also requires `openssl`; it creates temporary local certificates, ignores their self-signed trust only in its test context, and removes them. PostgreSQL tests create unique socket-only disposable clusters with separate non-owner runtime logins, never load `.env.local`, and remove clusters after testing.

| Check | Exact result | Evidence classification |
| --- | --- | --- |
| `npm run verify` | PASS: lint, strict app/engine TS, 622 tests passed / 5 explicitly skipped, Next.js production build | [Log](../evidence/task-05/verify.log); unchanged four optional baseline tests plus optional identity browser skipped in default run |
| Identity + E1 regression command above | PASS: 81/81, no skips: 25 OIDC protocol, 11 new native/browser, 45 existing control regression | [JSON](../evidence/task-05/identity-tests.json), [log](../evidence/task-05/identity-tests.log) |
| Native control migration | PASS: 45 constraint/RLS assertions | [Log](../evidence/task-05/control-db.log); real PostgreSQL, synthetic records |
| `npm run control:build` | PASS | [Log](../evidence/task-05/control-build.log) |
| Diff review | `git diff --check` passed; owned paths only, no credentials/private identity records/production artifacts | [Manifest](../evidence/task-05/manifest.json) binds source and evidence hashes |

The local browser genuinely navigates between two HTTPS localhost hosts with Chrome, follows the cross-site callback, checks authenticated session/HttpOnly cookie and logout denial. Its IdP response transport and account are simulated. Native tests exercise exact invited subjects, uninvited denial, role checks, foreign workspace/credential-authorization/project denial, stale/expired/logout/revoked sessions, server-expired bootstrap, state replay, encrypted/hashed persistence operator contention/progress and exhausted-retry rollback with no partial audit/session/membership mutation, and **one native pooled connection** alternating tenants after commit, rollback and concurrent callers. Existing E1 tests verify native SSE reconnect and termination on membership/session revocation, as well as existing preview-ticket revocation behavior. These results do not establish Task 04's live foreign-key endpoint denial or Task 07's gateway handoff.

Task 01 review identified a settings-versus-session lock-order inversion in the initial operator implementation. Every relevant existing row is now prelocked with NOWAIT, the transaction rolls back before bounded retry (12 attempts), and user locks fence new session insertion. A 25ms lock timeout also bounds relation-lock waits. Sustained contention returns `IDENTITY_OPERATOR_BUSY_RETRY`; callers can safely retry the entire operator command.

Development failures were corrected: Node fetch rewrote the synthetic navigation header, so the HTTP-header test now uses the native HTTP client; the bundled Playwright executable was absent, so the browser run explicitly used installed Chrome. The final commands above passed. No UI styles changed, so visual viewport/theme checks are outside this identity transport diff. No paid API call, purchase or infrastructure provisioning occurred.

## Integration dependencies and open acceptance

1. **Task 01:** review/install `@better-auth/oauth-provider@1.7.3`, generate/apply the Drizzle delta against existing custom auth tables, register a static confidential client, finish the existing login continuation, wire `/api/v1` to the real adapter and production control DB configuration. The adjacent generated inventory is exact plugin schema metadata, **not an executable Drizzle migration**. Shared startup remains explicit fixture/laboratory code and must not be exposed in hosted mode. Public legacy local-owner fallback must remain unreachable. No reserved migration number was consumed speculatively.
2. **Single-authority lifecycle:** add reviewed Better Auth account disable/delete/session revocation/sign-out hooks to invalidate mapped control sessions and Task 07 gateway records. Engine logout currently revokes the local server session and existing preview tickets, not the upstream Better Auth session. Provider `prompt=login` is requested; this is not proof of upstream fresh-password/MFA behavior. Engine credential freshness is specifically time since engine session creation.
3. **Real identities/access:** no configured issuer/client, real owner/two test-account access, production session key, deployed control DB or trusted operator grants were provided. Supply these through the approved secret/access system. Reproduce login, foreign project/key denial, roles, expiry, logout, upstream and membership revocation, SSE shutdown and preview handoff with those two accounts. This is the missing live D1 evidence; fixture passes do not close it.
4. **Tasks 04/06/07:** integrate credential metadata under `withAuthorization`, deployed DB privileges/recovery and gateway parent-session/current-membership revalidation. Real credential endpoint isolation and preview authorization handoff remain dependent acceptance. Last-owner recovery needs verified trusted operator intervention; no email-based account merge or public registration was added.
5. **Task 08:** the public portfolio remains anonymously viewable without Forge account authority, on a Vercel-issued HTTPS URL with no domain purchase. A real owner-operated generated demo depends on the above integrations and runtime/provider permissions; no live deployment or generation is claimed here.

Keep this PR draft until shared integration and live acceptance are closed. Do not merge or enable live execution merely because identity protocol tests pass.
