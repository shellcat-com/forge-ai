# Durable scheduler outbox — disabled integration milestone

2026-09-11 UTC. Based on canonical `301418a`, branch
`codex/durable-scheduler-outbox`. The existing production integration owner
allocated engine migration **0008** to this task. Engine **0007** remains their
reserved preview integration; **0009** is their hosted generation composition.
No old migration, shared manifest, authentication implementation, UI, hosted
configuration or unrelated work was changed.

## Implemented

- `engine/migrations/0008_scheduler_outbox.sql`: immutable admitted metadata,
  one unresolved dispatch per job, forced tenant RLS, restricted runtime grants,
  bounded delivery epochs, append-only transport receipts and fenced step receipts.
  The exact initiating session is stored internally and revalidated through the
  current Better Auth/E1 authority, never sent to Cloudflare. The migration
  requires current identity migration 0004 and does not enable any service.
- `engine/scheduling/outbox.ts`: enqueue inside the caller's existing authorized
  admission/approval transaction; bounded delivery claims; same-ID uncertainty
  reconciliation; exact-job claims; stable operation identities; resumable stored
  outcomes; atomic stage/outcome transactions. No global fixture worker wrapper.
- `engine/scheduling/outbox-delivery.ts`: one durable claim, one signed HTTP
  delivery outside database transactions, then one fenced acknowledgement.
  No automatic HTTP retry after a failed acknowledgement write.
- `tests/engine/scheduler-outbox.native.test.ts`: real disposable PostgreSQL with
  explicit synthetic users/jobs/allowance and transport fixtures. No provider,
  Cloudflare account or generated code is used.

The worker lock order is original child/parent session, account and membership
authorization → global settings → project → job → dispatch → step/receipt.
This matches the authenticated API's parent-first transaction boundary. Global
running counts come from a narrowly granted guarded function, not a tenant-RLS
query that would miss other users. New scheduler claims allow at most one active
step globally and one per actor, while expired leases still occupy capacity.
Hosted settings must also retain `max_running=1`; do not enable an unrelated
legacy worker with larger limits alongside this composition.

Each new sequence reserves the existing E1 step lease and deterministic operation
identity once. An already-started receipt is **unresolved**, not permission to
execute again after restart or lease expiry. Settled outcomes replay only after
the original session is reauthorized. Sequence gaps, changed metadata, expired
leases, cancellation, account/session revocation, policy revocation and shutdown
fail closed. Scheduler success/approval hints must match committed E1 job state.

Delivery is at most three same-ID attempts, each preceded by an explicit
transactional allowance reservation. There is no default allowance gate.
`acknowledged` means the workflow identity exists, not that generation succeeded.
An unknown delivery remains in the database; a stale attempt cannot overwrite a
newer result. Bounded maintenance discovery returns identifiers/expiry only and
does not release reservations, retry effects, delete artifacts or close jobs.

## Integration still required — not live acceptance

1. Review/install allocated 0007 before adding 0008 to the canonical migration
   sequence. The readiness check intentionally rejects a numbering gap. Do not
   insert an empty 0007, alter accepted migrations or weaken that check.
2. Call `enqueueDispatch(c, principal, jobId, metadata)` within real E1 admission
   and post-approval transactions, after the canonical free-budget/key/source
   authority checks. Reuse the same intent for repeated delivery requests.
3. Compose a real `SchedulerAllowanceGate.reserveDelivery` that reserves verified
   shared Cloudflare/Vercel allowance including retries and reconciliation, without
   HTTP inside the transaction. Unknown/stale entitlement must refuse admission.
4. Compose `BoundedControlStep` with `begin` and `settle`. Each real provider/build
   effect still requires current source approval, credential revision/destination,
   per-call budget and dispatch authority. `begin` is a lease, **not** that full
   authorization. `settle`'s callback is trusted database-only stage persistence;
   no model/build/hosting request may run inside it.
5. Implement provider-specific recovery of started receipts using durable source
   products/actual external operation evidence and the canonical reconciler.
   This milestone deliberately does not invent an exactly-once external API or
   turn timeout into proof of failure. There is no automatic step-recovery executor
   or expired-intent closure here; unknown work must remain blocked until resolved.
6. Wire the authenticated internal route, cloud trigger/outbox polling and cleanup
   scheduling only after qualified account allowances and full authority pass.
   Cloudflare must not receive source, keys, database URLs, session hashes or logs.
7. Qualify Vercel Sandbox, private preview origins, generated app databases,
   publishing, restart/revocation and the real deployed rehearsal separately.

No user model key has been supplied. No real generation, sandbox build, preview
or publishing result is claimed. No migration was applied to Neon; no cloud
deployment, spending, release merge or public-builder promotion occurred here.

## Verification

The focused suite passed **100 tests**: **32 native outbox cases** and 68 existing
scheduler protocol/delivery cases. `npm run lint`, `npm run typecheck`,
`npm run control:build`, and `git diff --check` passed. The native E0 migration
check passed **45 constraint/RLS assertions** on PostgreSQL 14.18. Reproduce with
Node 24 and PostgreSQL 14+ in the serial native-test slot:

```sh
npx vitest run tests/engine/scheduler-outbox.native.test.ts tests/engine/scheduler.test.ts tests/engine/scheduler-delivery.test.ts --maxWorkers=1
npm run lint
npm run typecheck
npm run verify
npm run test:db:control
npm run control:build
```

The full integrated suite and CI must run after the missing canonical 0007
dependency is reconciled. Earlier 961-test CI is not evidence for this new source.
This worktree uses the integration owner's identical dependency installation
through its approved read-only symlink; this is not fresh-clone self-host evidence.

Initial failures were fixed rather than hidden: synthetic fixture UUID/text SQL
parameter ambiguity; fixture setup missing current identity migration 0004;
strict dispatch parsing mistakenly receiving the step sequence; and JSONB key
ordering in duplicate result comparison. The five-argument cancellation test
call was corrected to the existing four-argument API. No deadlines, assertions,
RLS, identity validation or fixture provenance boundaries were weakened.
An added E1-state/result consistency check caught a test transition missing its
required failure reason; the fixture now uses the real transition API correctly.

## Handoff and rollback

Submit the scoped commit to the existing integration owner and PR #18, based on
`codex/production-integration` (itself dependent on PR #8). Keep draft while
migration/composition/live acceptance dependencies remain. Do not create a
competing release or merge unrelated work.

Before activation, leave routes and flags disabled. Code rollback does not undo
SQL or erase audit records. If ever activated, pause new admission, retain all
receipts and liabilities, revoke transport access, then reconcile real external
operations before closing intents. Never reset an unresolved sequence, fabricate
a replacement dispatch ID, clear a lease or delete a reservation to make progress.
