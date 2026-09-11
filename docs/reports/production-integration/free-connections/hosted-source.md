# Hosted source admission and recovery

2026-09-10. This implements the hosted source boundary; it does **not** enable the connected prompt-to-publish release. No real model call, generated build, private preview or publication is claimed.

## Changes

- Canonical hosted projects retain drafts independently of model connections. Authenticated admission atomically pins the original account session, key revision, model, free policy, prompt and template; reserves one global daily job; creates the existing job/step and scheduler outbox intent. Replayed requests return the committed result without another job or quota debit.
- Actual hosted provider adapters perform one accounted product per durable step. Validated batches are encrypted before proceeding. A saved final batch can reconstruct source after interrupted adoption without calling the model again. Fixture storage and catalog evidence cannot be used by the hosted stage.
- Restricted PostgreSQL worker checks the exact original Better Auth parent before reservation and dispatch, including verification, suspension, membership, logout, selected key/revision/model, policy expiry/revocation, current project revision, job cancellation, lease and free daily capacity. Uncertain attempts remain accounted; retries do not debit another call.
- Encrypted product adoption requires the matching accounted operation and request hash. It records an immutable recovery reference separately from scheduler step success. Failed authority/adoption leaves an orphan for the existing cleanup process, not an adopted partial result. Source reads reauthorize before and after object I/O.
- Fixture workers now reject hosted databases. Migration 0007 publishes the prior private-preview authority; 0008 supplies the integrated durable outbox; 0009 adds hosted admission/product metadata and bounded allowance counters. No default allowance or hosted worker activation is installed. Applied migrations 0001–0006 are unchanged.

## Verification and failures

Native PostgreSQL suite: 25 tests passed with actual restricted control/object roles and actual encrypted object storage. Accounts, model policies, provider usage and catalog evidence in the suite are explicitly synthetic. No external provider is called. Source pipeline/adapter tests separately cover batch ordering, corruption, scope, key/model/policy drift, source validation, crash recovery and fail-closed hosted composition.

Failures found and corrected during implementation:

1. Batch bindings were passed to a strict three-field artifact scope. Added explicit scope projection; retained strict schemas. The original 16 affected tests passed on rerun.
2. Native administrative seeding needed the published trigger search path. Fixed the test harness, not production constraints.
3. PostgreSQL requires an UPDATE privilege for a credential row-share lock. Granted only `UPDATE(id)` to the worker; the immutable credential trigger and missing revision/envelope privileges still reject mutation. Native tests verify both rejection paths.
4. New draft/admission response bodies omitted the version required by durable idempotency records. Added `schemaVersion: 1`; admission replay, rollback, ownership and quota checks passed.
5. A test tried to force an illegal terminal transition while preparing admission. Replaced it with a seed that creates no job; transition enforcement remains unchanged.
6. An encrypted-storage test used an invalid environment key-reference name. Corrected the fixture to the existing private-key naming contract.
7. Mac disk exhaustion interrupted a test command before execution. Removed only this task's disposable Vercel source export; retained source, private credentials and recordings. The native suite passed afterward.

Local `npm run verify`: lint and both typechecks passed; 1,042 tests passed, 5 existing optional tests skipped. The Next build compiled, passed its TypeScript check and generated all 19 static pages, then disk exhaustion stopped final packaging (exit 1). The separate native constraint check also failed during `initdb` with ENOSPC. Removed only this checkout’s disposable `.next/cache`; retained the failures and reran required checks. The rerun passed all 45 native constraint/RLS assertions and the standalone control build. [Sanitized logs and hashes](evidence/hosted-source/sha256.json) retain failed and passing runs. Clean-runner build outcome is recorded in the PR/CI at the corresponding commit. Local test doubles are never live acceptance evidence.

## Remaining release gates and rollback

Still required: wire the source stage, review approvals and recovery into the live bounded worker; install and verify the released managed Sandbox toolchain; implement and demonstrate private runtime routing, per-app Neon data, creator authentication, publication and management. The original A–P ledger, clean self-host reproduction and successful real signup-to-publication video remain open. Real Gmail delivery credentials and a user model key have not been supplied; Cloudflare's actual Free entitlement remains unverified.

These new engine migrations have not been applied to the live database. Hosted admission, workers and connections remain disabled on the separate verification deployment. The original public availability deployment is unchanged. Keep PR18 draft and do not merge. Roll back this code by reverting the source/admission commit; preserve encrypted object versions, source history and accounting. Do not drop live source or database data to roll back code. If migrations are installed later, disable admission/dispatch first and use a reviewed forward correction rather than editing previously applied migrations.
