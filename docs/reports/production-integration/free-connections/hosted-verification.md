# Hosted foundation verification

2026-09-11 UTC. **The requested prompt-to-publication release remains incomplete.**
This is a separate hosted verification deployment, with signup, connections,
enrollment, admission and worker execution disabled. No live A–P acceptance gate
is claimed passed.

## Actual deployment and checks

- Vercel team `biswas07` was rechecked as Hobby before creating the dedicated
  `forge-personal-biswas07` project (`prj_YoTRCJ2MEHuuXx1iKMRXQHMP0bf7`). No
  upgrade, domain purchase or unrelated account/project change was made.
- Deployed exact tracked commit `2a20197506b7c69d27fc2cb5214a665b1184c206`, exported
  from Git without local private files, to deployment
  `dpl_E1xVppBznt6Kb9a8oe1Lvn498zCt`. Vercel built the trusted Forge application;
  it did not build or execute generated application source.
- Ready URL: [foundation verification](https://forge-personal-biswas07.vercel.app).
  Immutable URL: [exact deployment](https://forge-personal-biswas07-ggvxpabob-biswas07.vercel.app).
  These URLs are Forge itself, not a generated/published app.
- Thirteen encrypted production configuration values were installed on this new
  project. Only the restricted auth and control API database logins are present;
  migration, worker and maintenance credentials were not uploaded. No model key
  or Gmail app password was supplied. Values and API responses remain private.
- Initialized the empty control installation's exact Better Auth issuer with a
  two-user enrollment cap and `enabled=false`. Existing users/sessions were not
  changed. Read-only preflight passed all eight checks over verified Neon TLS
  using four separate restricted runtime logins. Exit 2 correctly means
  foundation passed but release unverified, not release-ready.
- Headless Firefox on the hosted URL passed eight anonymous checks: login page,
  account capabilities, unauthenticated project/connection/status denials,
  empty auth session, cross-origin auth mutation denial and no page errors.
  The login page truthfully shows missing sign-in configuration. This browser
  run did not use a local Forge server or mock network endpoints.
- The original project's production target remains
  `dpl_HQkCUrvZnLVXx4LjGfo64qUu1jh3` at
  [the existing availability page](https://forge-ai-demo-omega.vercel.app).

The exact code commit passed [full CI](https://github.com/shellcat-com/forge-ai/actions/runs/34543481205):
961 tests passed, five existing optional tests skipped, lint/types/production
build passed, 45 native PostgreSQL control assertions passed and standalone
control build passed. A later evidence-only commit does not change the source
commit used by this deployment.

## Failure and recovery

The first Vercel environment upload, using a top-level array with CLI `api
--input`, returned HTTP 400 `Invalid JSON`. No configuration result was assumed.
Each entry was then submitted as the documented single-object request and its
success response checked; all thirteen succeeded. The initial failed response
contained no secret values. No duplicate deployment or billing escalation was
used to recover.

Earlier local disk failures, preview fixture setup timeouts and Neon role-switch
failure remain recorded in [the provider/storage report](provider-storage.md),
with their successful reruns. The hosted build completed successfully; upstream
dependency deprecation warnings remain, while its installation audit reported
zero vulnerabilities. This is not a separate security audit of all dependencies.

## Live acceptance ledger

| Gate | Current result | Remaining evidence/work |
| --- | --- | --- |
| A signup | NOT PASSED | Real delivery credentials and hosted signup rehearsal. |
| B verification/recovery/logout | NOT PASSED | Real Gmail verification and recovery, then hosted session lifecycle. |
| C account isolation | NOT PASSED | Native account/key isolation passes; repeat across live projects, files, jobs and previews. |
| D BYOK lifecycle | NOT PASSED | Encrypted APIs and native/browser regressions pass; real user key and hosted lifecycle remain. |
| E durable projects/jobs | NOT PASSED | Compose the hosted UI/API with canonical E1 admission and source adoption. |
| F real generation | NOT RUN | User model connection, actual free entitlement, authoritative dispatch and provider source persistence. |
| G approved build/preview | NOT RUN | Managed Sandbox driver, reviewed toolchain, isolation tests and authenticated gateway. |
| H persistent app data | NOT RUN | Separate preview/published Neon databases and reviewed migration workflow. |
| I conversational edits | NOT RUN | Live source edits, rebuilds and data-preservation rehearsal. |
| J chat/button Publish | NOT PASSED | One authorized full-stack deployment API and both UI entry points. |
| K public URL/private records | NOT RUN | Real generated app plus creator-only account authentication. |
| L republish/rollback | NOT RUN | Durable deployment history/reconciliation, code rollback and unpublishing. |
| M cancel/restart/reconnect | NOT PASSED | Cloud outbox/scoped worker integration and live interruption/cleanup campaign. |
| N no Mac dependency | NOT PASSED | Anonymous hosted foundation works independently; repeat the entire connected flow. |
| O clean self-host | NOT PASSED | Reproduce the full supported isolated-runtime setup from a clean clone. |
| P full recording | NOT PASSED | Record successful real signup through publication with secrets excluded. |

Cloudflare's actual Free entitlement and remaining capacity still need verified
access; its authenticated disabled scheduler transport is not a deployed worker.
The Gmail private setup file still has no app password. A user-owned model key
is also required. These inputs alone will not complete the remaining integration.
No shared operator model key, automatic paid fallback or generated source
execution on the Mac is enabled.

## Evidence and rollback

Sanitized [deployment receipt](evidence/hosted-deployment.json),
[Neon preflight](evidence/live-hosted-readiness.json),
[browser results](evidence/hosted-browser-results.json),
[login screenshot](evidence/hosted-login.png) and
[exact CI summary](evidence/combined-ci-result.json) are covered by
[the evidence hashes](evidence-sha256.json). The existing local account/key video
remains explicitly synthetic-delivery regression evidence, not the requested
generation-to-publication recording.

Keep PR18 draft and do not merge. To withdraw this verification surface, pause
only `forge-personal-biswas07`; do not change `forge-ai-demo`. Keep account,
source and encryption data and additive migrations. Keep enrollment/admission/
worker disabled. Never drop application databases or reverse migrations as part
of a code rollback. Re-enabling signup/keys requires the documented private
configuration and live verification, not changing flags to make checks green.
