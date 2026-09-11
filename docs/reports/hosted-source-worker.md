# Bounded hosted source worker — implementation milestone, not beta release

Base: `bf51db3fae38f4a08e47f3b7a21ec19e41e1594a` on
`codex/production-integration` (draft PR18, itself based on draft PR8's
`codex/demo-delivery-baseline`). Work branch: `codex/hosted-source-worker`.
The integration owner explicitly allocated the worker, worker tests, the minimal
gate extraction and this additive report. Other worktrees and shared routes,
configuration, migrations and UI were not changed.

Tested source commit: `550a0462f0da780644463e252b8799df099c1d4c`.

## Implemented

- `engine/control/hosted-worker.ts`: `HostedSourceWorker implements
  BoundedControlStep`. It is disabled unless constructed with `enabled: true`.
  It uses canonical PostgreSQL jobs, scheduler receipts, leases, events,
  encrypted artifacts and provider accounting. There is no fixture worker or
  provider fallback, HTTP listener, generated-code execution or deployment.
  Enabled startup verifies the actual restricted login and hosted database
  environment; constructor tags alone are not sufficient. Failed checks are
  not cached as success and do not claim jobs.
- `QUEUED → PLANNING` is an atomic, replayable E1 transition. Plan generation
  creates/reuses an immutable catalog base, binds the admitted instruction,
  preset, model, credential revision and template/policy, and saves the accounted
  provider product before settling the step and stored plan review.
- Approved `GENERATING` work reconstructs prior batches from encrypted adopted
  products and makes at most one provider call per step. A nonfinal batch queues
  the next E1 step without changing the job state. A final batch passes required
  static scanning and the existing additive SQL validator, then atomically adopts
  candidate/diff metadata and enters `VALIDATING`. The candidate explicitly has
  `origin='hosted'`; it is not marked verified, preview-ready or published.
- Generated text source is read from immutable scoped artifacts and supplied as
  untrusted model context. Neither workflow messages nor job-progress responses
  carry the key or plaintext source archive.
- Every effect is tied to the current parent session, tenant, pinned key/model,
  policy, lease and deadline. Saved-product-to-settlement revocation races are
  checked in the final transaction. A changed catalog release is rejected before
  seeding objects or dispatching the model.
- `engine/control/hosted-generation-gate.ts`: extracted the existing checks,
  unchanged, into `assertCurrentInTransaction(tx, context)`. `withCurrent` still
  opens its scoped transaction and invokes these checks before the callback.
  This avoids a nested transaction or weaker duplicate checks during settlement.
- Busy work returns an error, not a misleading successful `continue` hint that
  would cause the scheduler to skip an unclaimed sequence. Replays return stored
  results; a started/unknown receipt is never automatically rerun.

## Exact composition interface

Construct `HostedSourceWorker` with:

```ts
{
  enabled: false, // remain off until integration and live gates pass
  db,            // restricted forge_control_worker, hosted environment
  store,         // existing encrypted PostgreSQL ArtifactStore
  catalog,       // immutable, separately qualified release TemplateCatalog
  registry,      // exact supported policies, current verified free allowance
  cipher,        // existing CredentialCipher with server-only recovery keys
  commandPolicy, // exact catalog-bound zero-spend policy
  templateGuidance,
  scan,          // required trusted independent static scanner; no default/no-op
}
```

The public method is `execute(command: Readonly<StepCommand>, signal:
AbortSignal): Promise<StepResult>`. Only the existing authenticated worker-step
handler may expose it. That handler supplies the transport deadline; the worker
also bounds its work to 44 seconds, the dispatch expiry, lease, policy and job
deadline. The scanner must honor its AbortSignal and must not execute generated
scripts. A thrown error after claim preserves durable uncertainty; it does not
prove zero usage, release a reservation or manufacture cleanup evidence.

Supported stages here are **QUEUED, PLANNING and GENERATING** only. Compose the
remaining validator/runner stages separately; do not mount this module alone as
an enabled end-to-end worker. Stored plan approval and a new authenticated
outbox dispatch must come from the canonical owner API, never this worker.

## Verification

`tests/engine/hosted-worker.native.test.ts` uses ephemeral native PostgreSQL,
restricted roles and the actual encrypted PostgreSQL object implementation.
Accounts, keys, free-entitlement evidence and template bytes are synthetic. The
actual hosted generation stage/accounting/adapter code runs with provider HTTP
intercepted in the **test module only**. A test-only catalog evidence discriminator
does not qualify a real template. No real model request or generated script ran.

Focused pinned-toolchain run: **79 passed** (22 new worker tests, 25 existing
hosted-gate tests and 32 existing scheduler-outbox tests). Coverage includes
default-off and fixture rejection, exact release identity, replay, multiple
tenants, parent-session revocation, global concurrency, approval requirements,
encrypted plan storage, multibatch continuation on fresh worker instances,
unknown outcomes, stale leases, cancellation and static-scan rejection. Final
transaction tests revoke a key after model work and cancel before candidate
adoption; neither advances review/candidate metadata.

Two recovery tests explicitly simulate an independent reconciler: a durably
saved plan can be adopted without another call after a new authorized claim;
an earlier call lacking an adopted product cannot be replaced through a new
dispatch. **This is not a deployed or automatically implemented reconciler.**

Final pinned-toolchain verification on the source commit above:

- `npm run verify`: **PASS** — lint, both strict TypeScript checks,
  **1064 tests passed / 5 optional tests skipped** (75 files passed / 2 skipped),
  and Next.js production build. Test duration: 104.33 seconds.
- `npm run test:db:control`: **PASS**, native PostgreSQL **14.18**, 45
  constraint/RLS assertions from an empty disposable database; fixtures rolled back.
- `npm run control:build`: **PASS**.
- `git diff --check`: **PASS**.

GitHub CI and integration review are separate checks on the eventual PR head;
their status belongs to the PR, not to an inferred live-release result.

Reproduction (Node **24.20.0**, npm **11.11.0**, native PostgreSQL on PATH):

```sh
node --version
npm --version
# In a fresh independent clone, install the lockfile first:
npm ci --no-audit --no-fund
mkdir /tmp/forge-native-verification.lock || exit 1
trap 'rmdir /tmp/forge-native-verification.lock' EXIT
npx vitest run tests/engine/hosted-worker.native.test.ts tests/engine/hosted-generation-gate.native.test.ts tests/engine/scheduler-outbox.native.test.ts --maxWorkers=1
VITEST_MAX_WORKERS=1 npm run verify
npm run test:db:control
npm run control:build
```

Local development reused the canonical dependency directory via a symlink; no
install/upgrade or secrets were copied through it. Initial test failures exposed
an invalid synthetic key-reference name, an administrator test search-path
omission, extra claim fields passed to a strict artifact scope, an incorrect
test parent-session token and a lint-only import form; all were corrected without
weakening assertions. Review identified and fixed the candidate-origin default.
The shell's purported `node@24` symlink actually resolves to Node25.8.1: its
earlier 1060-test/build pass is supplemental only, not the pinned-toolchain result.
No browser feature was mounted or UI changed; browser/live acceptance was not run.

## Remaining integration and release gates

1. Mount the authenticated bounded step route and compose the complete stage
   router. Connect owner plan review/approval, resume dispatch, source views and
   resumable progress in the actual hosted interface.
2. Connect verified shared-account allowance reservations, durable outbox
   delivery, Cloudflare scheduling and reconciliation. Implement authorized
   resolution of started receipts, expired workflows and stranded reservations.
   This module deliberately does not reset receipts, discard uncertainty or retry
   a possibly accepted call using a new identity.
3. Integrate independent validation, execution review, qualified Vercel Sandbox,
   authenticated private previews, bounded repair and proven external cleanup.
   No runner capability or containment acceptance is established by this PR.
4. Install/reconcile reviewed hosted migrations through the integration owner;
   this work does not change or apply live migrations. Close real OAuth/session,
   free-provider qualification, quota, recovery-key and operations inputs.
5. Connect persistent generated-app databases and the separate owner-authorized
   publishing/update/rollback workflow. Preserve Forge's own deployment.
6. Pass the deployed, new-user generation-to-publication rehearsal and clean
   self-host reproduction. No deployment URL or LinkedIn demo is claimed here.

The PR remains draft while these required live gates are unmet. No merge,
production promotion, purchase, overage or cloud resource creation occurred.
Rollback is to leave source-worker composition disabled and revert only this
scoped implementation after downstream callers of the extracted gate are
reconciled. No schema rollback or deletion of user records is necessary.
