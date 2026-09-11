# Hosted readiness correction — release still blocked

2026-09-10. Isolated task branch `codex/hosted-readiness`, based on combined
integration commit `d85eeca498c61fe8220a56725287a0fc63a08a0e`. The production
integration owner explicitly assigned the existing readiness script correction;
shared auth code, migrations, application configuration and deployment remain
with that owner. This task does not create a competing PR or release authority.

## Combined CI and live release audit

Independently inspected [CI run 34541063662](https://github.com/shellcat-com/forge-ai/actions/runs/34541063662)
on exact head `d85eeca`: **SUCCESS**, including lint, strict types, tests, build,
native PostgreSQL constraints and standalone control build. The committed combined
report records **911 passing tests and five optional skips**. This CI does not
cover subsequent unpublished changes or the correction in this report.

Verified PR ancestry: `master` → PR #8 (`codex/demo-delivery-baseline`) → PR #18
(`codex/production-integration`), without force pushes, squashing dependencies or
merging. Both PRs remain draft with unmet release acceptance requirements.

A direct anonymous HTTPS GET of `https://forge-ai-demo-omega.vercel.app` returned
HTTP 200 on 2026-09-10 at 23:05 UTC, but the actual content was titled “Forge AI —
Hosted builder availability” and said generation, sign-in, private previews and
publishing were not connected. `connect-src 'none'` and `form-action 'none'`
matched that static availability artifact. **This was not a browser rehearsal,
authenticated builder or generated application's URL.** No live account/model
creation or deployment was attempted by this audit.

## Correction

The old `scripts/check-cloud-readiness.mjs` incorrectly expected
`NEON_AUTH_BASE_URL`, legacy Neon Auth tables/JWKS and a migration connection.
It now boots a strictly read-only Better Auth/E1 preflight:

- `scripts/check-hosted-readiness.ts`: exact existing TLS configuration and runtime
  verifiers, separate restricted auth/API/worker/maintenance logins, current auth
  columns, canonical migration version presence, forced tenant RLS, current
  issuer and disabled/enabled control settings. Database drivers load only after
  configuration validation. No provider, OAuth, mail or publishing HTTP requests.
- `scripts/check-cloud-readiness.mjs`: existing invocation preserved, safe JSON,
  redacted failures and a sixty-second absolute CLI deadline. Exit 1 means failed
  foundation/configuration; exit 2 means foundation passed but live release
  acceptance remains unverified. **No release-success exit 0 is emitted.**
- `tests/engine/hosted-readiness.test.ts`: explicit SQL-port fixtures plus actual
  CLI fail-closed startup; invalid TLS/identity/key configuration, excessive grants,
  migration/RLS/issuer drift, disabled gates, cleanup and error redaction.
- `tests/engine/hosted-readiness.native.test.ts`: actual disposable PostgreSQL,
  synthetic restricted identities, all four connections read-only, no state
  mutation, and denial after real privilege/RLS/issuer drift.
- `docs/operations/hosted-readiness.md` and the historical document notice in
  `docs/auth-neon.md`: current configuration, exit semantics and limitations.

The probe does not read real users, sessions or encrypted keys. Auth column
checks use `LIMIT 0`; privilege checks do not perform the writes they inspect.
It does not fetch privileged migration hash receipts or count free allowance;
those remain explicitly unverified. Disabled admission/worker/enrollment remains
visible even when installation checks pass. Presence of OAuth settings is not a
real callback pass. Enabling flags cannot turn this probe into release acceptance.

## Verification and failure history

Final-source `npm run typecheck`, `npm run lint`, `git diff --check`, and the
23-case fixture/CLI suite passed. The earlier native focused run passed five
additional cases, before the final typed-factory and migration-discovery changes.
The production integration owner requested this isolated commit for review and
one serial combined `npm run verify` campaign including their concurrent storage
and provider work. That final native/full run and CI on the resulting combined
head remain **pending**; earlier CI and focused results are not substitutes.

Preserved failure classifications:

1. Dependency refresh on the d85eeca manifest failed with **ENOSPC**, leaving an
   incomplete private dependency tree. Premature formatting/type checks during
   that failed refresh/removal reported absent tools and missing Next/React type
   declarations. No declarations, compiler options or application source were
   weakened to conceal the environment failure.
2. Removed only this task's regenerable `.next/cache` (172 MB) and its incomplete
   `node_modules` (834 MB). With owner approval, the task uses a **read-only local
   dependency symlink** to the integration owner's identical d85eeca dependency
   install. The link is not staged. Other task/source/private files were untouched.
   This is not a fresh-clone self-host acceptance result.
3. The first focused run passed 22 cases but its standalone CLI cold start took
   5.5 seconds and hit the test's five-second limit. Moved database/auth driver
   loading after configuration validation; the unchanged 23-case suite then passed
   in 733 ms overall. No test deadline was increased.
4. Native focused run passed **28/28** (23 fixture/CLI plus five actual PostgreSQL
   cases). Strict TypeScript caught a TS2352 inferred-record assertion in the
   connection factory. Replaced it with an explicitly keyed, typed factory rather
   than casting through `unknown`. Types, lint and the 23-case suite passed after
   that fix. Canonical migration discovery was subsequently made version-aware so
   newly allocated migration files cannot be silently skipped.

## Handoff and rollback

Review this isolated correction and integrate it into existing PR #18, then
require CI on that resulting head. Use the documented script through privately
configured runtime references for live Neon preflight; do not request migration
credentials, rotate keys, mutate grants or enable flags to make the report pass.

Remaining live release gates include real social callbacks/multi-user isolation,
entitled user-owned model credentials, actual provider generation, durable E1
dispatch/adoption, qualified managed builds/private previews, app databases,
publishing/rollback, restore/key recovery, clean self-host reproduction and the
full deployed rehearsal with local services stopped. The integration task owns
those implementations. No public replacement, release merge or LinkedIn post is
authorized by a foundation preflight pass.

Rollback affects only diagnostic code/docs. It changes no stored data or running
resource. Do not restore the obsolete Neon Auth checker as a release approval
shortcut. Exact reproduction and exit handling: [preflight guide](../operations/hosted-readiness.md).
