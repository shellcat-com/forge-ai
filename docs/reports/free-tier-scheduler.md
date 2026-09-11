# Free-tier scheduler transport — implementation milestone, release incomplete

Date: 2026-09-10. Owner: `codex/free-tier-scheduler`. Canonical dependency:
`c9bbaa9788567aea6e6220228c7e2770f0549487` on `codex/production-integration`
([existing PR #18](https://github.com/shellcat-com/forge-ai/pull/18)).

This is a **partial delivery of task 4**, not acceptance of production workers or
the complete beta. The existing integration task owns accounts/UI, PostgreSQL
migrations, live composition and deployment. It requested an isolated scheduler
commit for review and integration into PR #18, not another competing PR. No
existing foundation, application or identity system was replaced. No generated
execution, model call, deployment, purchase or infrastructure provisioning was
performed by this scheduler task.

## Implemented files

- `engine/scheduling/protocol.ts`: strict versioned metadata, bounded UTF-8 JSON,
  exact operator origins, direction-separated HMAC transport authentication.
- `engine/scheduling/delivery.ts`: one authenticated E1-outbox delivery attempt;
  exact acknowledgement, disabled/rejected/unknown outcomes, no retry loop.
- `engine/scheduling/trigger.ts`: same-ID workflow creation and ambiguous-create
  lookup with finite deadlines; sanitized responses.
- `engine/scheduling/workflow.ts`: actual SDK-shaped bounded durable steps and
  sleeps; stable retry identity, deadlines, stop/approval handling.
- `engine/scheduling/handler.ts`: authenticated Node handler with an explicit E1
  authority port; no listener, mounted route, global worker dispatch or fixture
  fallback. Abort/deadline signals never claim an external operation stopped.
- `cloudflare/scheduler/`: real `WorkflowEntrypoint`, default-disabled Wrangler
  configuration, local bundle configuration and secret/generated-state ignores.
- `tests/engine/scheduler.test.ts`, `scheduler-delivery.test.ts`: explicit
  SDK/control/HTTP fixtures; no fixture result represents a live provider.
- `engine/scheduling/README.md`: exact port, integration obligations, configuration,
  capacity and release gates, reproduction and rollback.
- `eslint.config.js`: one integration-owner-approved exclusion for Wrangler's
  generated `.wrangler` directory. All source remains linted normally.

No migration, package manifest, source approval, existing job state machine,
fixture-only execution guard, hosted UI or runtime security boundary is changed.

## Verification evidence

Verified on canonical `c9bbaa9` plus this isolated scheduler change, Node 24.20.0,
npm 11.11.0 and native PostgreSQL 14.18. No secrets or production databases were
loaded for these checks.

| Check                                         | Actual result                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify` under the shared native lock | **PASS**: lint, both strict TypeScript configurations, **901 tests passed / 5 skipped**, production Next.js build                                       |
| Scheduler-specific cases within that run      | **68 passed** across two files; HTTP/SDK/control fixtures, not live cloud acceptance                                                                    |
| `npm run test:db:control`                     | **PASS**: empty native PostgreSQL 14.18 cluster, **45 constraint/RLS assertions**, synthetic fixtures rolled back                                       |
| `npm run control:build`                       | **PASS**: standalone control compilation; does not mount the new handler                                                                                |
| Wrangler 4.131.0 `deploy --dry-run`           | **PASS**: real `WorkflowEntrypoint` bundle, 12.43 KiB / gzip 3.91 KiB, disabled flag and workflow binding recognized; no upload                         |
| Wrangler 4.131.0 `dev --local`                | **PASS**: local workerd starts with the binding; GET/POST `/dispatch` both return `503`, `Cache-Control: no-store`, `{"error":"SCHEDULER_UNAVAILABLE"}` |

The full passing test phase took 78.61 seconds (67 files passed, 2 skipped). The
initial five failing native cases listed below passed on the serial rerun; no
test assertion, deadline or fixture guard was relaxed. Parent-directory
`expo/tsconfig.base` discovery produced a non-fatal Vitest warning outside this
repository. A scheduler-local TypeScript configuration avoids that warning in
Wrangler bundling without editing the parent workspace.

Local HTTP reproduction (leave the feature disabled; no model/provider keys):

```sh
cd cloudflare/scheduler
WRANGLER_SEND_METRICS=false npx --yes wrangler@4.131.0 dev --local --ip 127.0.0.1 --port 8897 --inspector-port 0 --show-interactive-dev-session false
```

In another terminal, `curl --max-time 10 -i -X POST http://127.0.0.1:8897/dispatch
-H 'content-type: application/json' --data '{}'` must return the disabled 503.
Stop Wrangler after checking. The test server was stopped after this run; hosted
Forge never depends on it. This smoke test proves disabled behavior in the local
Cloudflare runtime, **not a deployed service, durable replay or isolation**.

No browser-facing route or UI behavior was changed by this task, so visual and
hosted browser acceptance were not rerun or claimed here. The new handler's
Fetch/Request behavior is exercised in the explicit contract tests; real deployed
HTTP, tenant authorization and SSE belong to the missing live composition gate.

### Failures preserved and fix-and-retest history

1. Initial scheduler transport run: **43 passed**. Strict TypeScript then caught
   two TS2493 errors indexing a zero-argument test mock (`scheduler.test.ts`,
   former lines 92–93). Fixed the mock's typed metadata parameter; did not relax
   compiler settings. Expanded scheduler run: **53 passed**.
2. After adding the E1 delivery helper, explicit transport/SDK suites:
   **67 passed**, two files. These use real WebCrypto and Fetch objects with
   synthetic identities, clocks, SDK and upstream behavior.
3. First full run on `713f07899f81184208060c4cd744dc085ee48484` plus scheduler files,
   with `VITEST_MAX_WORKERS=1`, encountered existing integration timing failures
   while a separate BYOK verification task was running. Failing cases:
   - `e2-control-integration.test.ts`: rejects adoption after lease loss during
     object validation; replays saved candidate references after crash without
     repeating the stage product; blocks export replay after verification
     revocation/expiry.
   - `public-auth.test.ts`: reports the actual hosted build dependency after
     login and creates no jobs on retries; uses the same hosted error for
     existing-project changes while preserving owner authorization.
     The run stalled in teardown and was interrupted through its owned tool session
     (exit 130). **Not a passing run.** No unknown process was killed. Coordination
     found the other task also had native timing failures. Both tasks agreed to
     serialize native campaigns. The unchanged synthetic test inputs remain in
     those versioned test files. No assertion or timeout was weakened.
4. Fast-forwarded to reviewed canonical dependency `c9bbaa9`, which includes the
   integration owner's committed `maxWorkers: 1` configuration. The next full
   check stopped in lint with twenty errors in generated
   `cloudflare/scheduler/.wrangler/dry-run/index.js`. Root cause: flat ESLint
   configuration did not ignore Wrangler output. Added the narrow generated-only
   ignore with owner approval. Real scheduler source is still checked.
5. Added a regression for an endless stream of empty body chunks: bound chunk
   count as well as bytes/time, avoiding reliance on event-loop timer fairness.
   Full rerun uses the shared `/tmp/forge-native-verification.lock` after the
   competing task confirmed its database/browser campaigns stopped.

## Remaining gates and exact integration handoff

The [package handoff](../../engine/scheduling/README.md) specifies the required
transactional outbox, immutable ID binding, durable step result deduplication,
current tenant/session/key authority, stable external operation IDs and fenced
leases. It explicitly forbids wrapping global fixture `runOnce()`. The integration
owner must mount the bounded Node handler only after that port is implemented
and its native duplicate/restart/cancellation tests pass.

Before activating cloud scheduling, prove deployed Workflow replay/timeout/cleanup
behavior and independently verify current shared free allowances. Enforce one
active generation globally/per user and two sandboxes including previews in E1.
Reserve allowance for retries/reconciliation and fail closed on unknown capacity.
This transport library alone enforces none of those account-wide reservations.

The Vercel sandbox must still pass real isolation, egress, source/toolchain,
cancellation and cleanup qualification. Preview authorization, generated app
database persistence, publishing/rollback and a clean self-host rehearsal remain
separate acceptance gates. **No model account has been supplied for this task; real
generation and the final recording cannot pass yet.** Do not promote the builder,
claim cloud worker readiness or merge a release from these fixture tests.

## PR and rollback

Review the isolated commit against `c9bbaa9`; integrate only owned files into the
existing PR #18 after review. The correct dependency is PR #18's integration
branch, whose existing dependency ancestry must be preserved. Keep the release PR
draft while required live acceptance is blocked; do not merge unrelated work.
Record the resulting integrated head and require CI on that exact head. This
report does not claim a commit was pushed, integrated or CI passed before those
actions are verified.

Reproduction commands and operational rollback are in the package README. Before
activation, revert the isolated additions and leave the feature disabled; there
are no database changes or running resources to roll back. After a future live
activation, pause admission and reconcile outbox/leases/external effects before
disabling transport. Removing code never establishes that a running job stopped.
