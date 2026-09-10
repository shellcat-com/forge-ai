# Bounded Cloudflare scheduling transport — disabled implementation milestone

This package does **not** install an engine route, create a second job authority,
run generated code, or enable hosted generation. It implements the metadata-only
transport between a future E1 transactional outbox, Cloudflare Workflows and an
explicitly composed trusted Node control step. PostgreSQL remains authoritative.
The existing fixture-only worker is unchanged and is not a valid live composition.

## Boundaries and contracts

| File                                   | Responsibility                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `protocol.ts`                          | Exact versioned metadata, bounded JSON, HTTPS operator origins and HMAC transport authentication                   |
| `delivery.ts`                          | One signed outbox delivery attempt; exact workflow acknowledgement or explicit uncertainty                         |
| `trigger.ts`                           | Authenticated workflow creation using the existing immutable dispatch ID; lookup after uncertain creation          |
| `workflow.ts`                          | Durable bounded steps/sleeps, short-lived authentication, bounded retries and metadata-only results                |
| `handler.ts`                           | Disabled-by-configuration Node request handler; explicit `BoundedControlStep` port; deadline/disconnect signalling |
| `../../cloudflare/scheduler/index.mjs` | Real `WorkflowEntrypoint` binding and private trigger entry point                                                  |

An admitted outbox intent is `{schemaVersion:1, dispatchId, workspaceId, jobId,
expiresAt}`. IDs are UUIDs; the expiry is an immutable canonical ISO timestamp
no more than fifteen minutes ahead. A step adds `sequence`, an integer from 0 to 29. No source, provider key, database URL, session, deployment token, log or user
instruction is permitted in these objects. The exact JSON key set is checked.

Results contain only `{schemaVersion:1, state, retryAfterSeconds}`. States are
`continue`, `complete`, `awaiting-approval`, `cancelled`, `blocked`; only `continue`
has a delay, between 5 and 60 seconds. These are scheduler hints, **not additional
E1 job states**. E1 persists the real state/events. An exhausted/expired workflow
does not fail, cancel or release a job by itself.

### Transport, not authorization

Two independent operator-generated 32-byte HMAC keys are required. Use lowercase
hex encoding in secret storage; never put values in configuration examples,
commits, workflow parameters, browser bundles or guest environments.

- `FORGE_SCHEDULER_TRIGGER_KEY`: trusted outbox issuer → exact scheduler origin
  `/dispatch`.
- `FORGE_WORKER_STEP_KEY`: workflow → exact Forge origin
  `/api/internal/worker-step`.

Signatures bind protocol direction, POST, exact URL, Unix timestamp and SHA-256
of canonical metadata. Receivers accept at most thirty seconds of clock skew.
Cookies, Origin headers, mismatched Host, query parameters and redirects are
rejected. JSON is limited to 2,048 bytes (including chunked bodies), valid UTF-8,
uncompressed JSON and five seconds of body reading. Authentication failures and
upstream exceptions are sanitized. Responses use `Cache-Control: no-store`.

Origins come exclusively from trusted operator configuration, never users,
source, logs or workflow payloads. HTTPS-only parsing rejects paths, credentials,
ports, IP literals and common private suffixes. This is **not DNS-rebinding
protection for arbitrary user-controlled domains**. Secure DNS/account ownership,
TLS and exact origin deployment configuration remain operator requirements.
Reverse-proxy mounting must reconstruct the canonical URL only from trusted
platform configuration, never attacker-supplied forwarding headers.

Replay protection is deliberately not an in-memory Set. Every valid replay reaches
the authority port. The HMAC authenticates the transport service, **not the end
user**, and cannot authorize a provider call, publication, migration or spend.

## Required E1 integration (integration owner; not implemented here)

1. In the existing admission/approval transaction, create an immutable outbox
   intent binding the dispatch ID to its owner, tenant, job, expiry and approved
   policy. Allocate migrations through the canonical owner; do not rewrite E0.
2. Persist delivery attempts/acknowledgements and `(dispatchId, sequence)` step
   outcomes under appropriate tenant constraints. Reject a dispatch ID reused
   with changed metadata, out-of-order new sequences, or a different actor/job.
3. `deliverDispatch` may only receive an already admitted intent. A 202 proves
   the workflow ID exists, **not** that the job ran or succeeded. `unknown` must
   retain reconciliation state. Rejection must surface an operational error;
   neither result authorizes a replacement ID or repeating an external effect.
4. Implement `BoundedControlStep.execute(command, signal)`: reacquire current
   membership, account/session revocation, job, source/approval, provider-key
   revision/destination, quota, capacity, cancellation and fenced lease authority.
   Claim only the specified admitted job. **Do not wrap global `runOnce()`**, remove
   fixture guards or let the workflow choose source/provider/hosting targets.
5. Use short database transactions for claims and fenced outcome writes, not a
   transaction held open over a provider call. Persist each external operation's
   stable identity before dispatch. Reconcile uncertain provider/sandbox/deployment
   outcomes; do not rely on a provider honoring an invented idempotency header.
6. Mount the handler on a trusted Node route only after this real port is ready.
   Allocate enough platform request duration for five-second body authentication
   plus a maximum fifty-second step, within verified free account limits.
   Long builds must submit/check an independently bounded sandbox operation;
   no infinite loop or generated build script belongs in this route.
7. Persist step results in E1 so concurrent/restarted requests return the same
   result without duplicating effects. Signal abort is best effort, **not proof
   that work stopped**. Fencing and external reconciliation remain mandatory.
8. Reconcile stranded outbox intents, sleeping/terminated/exhausted workflows,
   leases and orphan runtimes without the developer's Mac. Resume only through
   a newly admitted E1 intent after previous uncertainty is resolved. Workflow
   completion/retention cannot replace PostgreSQL job and event retention.

Each workflow has at most thirty durable control steps, two retries per step,
twenty-nine sleeps and a fifteen-minute dispatch deadline. Retries keep the same
`dispatchId` and sequence while refreshing the transport signature. A step has a
one-minute SDK timeout and a 55-second HTTP deadline. Trigger creation has a
ten-second timeout, followed by at most a five-second same-ID lookup. Outbox
delivery has a 25-second HTTP deadline and no internal retry loop.

## Configuration and free-tier release gates

The supplied Wrangler configuration has `FORGE_SCHEDULER_ENABLED=false`, no route,
no account identifier, no cron, no public workers.dev URL and no preview URL.
It does not provision or deploy anything when committed. Configure only after
review, using the existing authorized accounts and verified free entitlement.

| Setting                       | Meaning                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `FORGE_SCHEDULER_ENABLED`     | Must remain `false` until the gates below pass                               |
| `FORGE_SCHEDULER_ORIGIN`      | Exact approved HTTPS trigger origin                                          |
| `FORGE_CONTROL_ORIGIN`        | Exact approved HTTPS trusted Forge backend origin                            |
| `FORGE_SCHEDULER_TRIGGER_KEY` | Secret reference/value in platform storage; shared with the E1 issuer only   |
| `FORGE_WORKER_STEP_KEY`       | Different secret reference/value; shared with the trusted step endpoint only |
| `FORGE_DISPATCH`              | Workflow binding declared in `wrangler.jsonc`                                |

Do not paste secrets into tool prompts or terminal history. Key rotation requires
pausing admission and draining/reconciling old deliveries; no fallback to old keys
is implemented. Losing a transport key does not authorize losing PostgreSQL jobs.

The release policy is one active generation globally, one per user, and at most
two sandboxes including previews. **This library does not enforce those caps.**
The E1 composition must reserve them atomically and fail closed when real shared
Cloudflare/Vercel/Neon allowances are unknown, stale or insufficient. Account
authentication or a pricing page is not proof of remaining free capacity.

Reserve for the worst case, including up to ninety control HTTP attempts per
dispatch, sleeps, workflow creation/lookup/retries, reconciliation, preview
traffic and storage. Verify the platform's actual metering; these constants are
not a claim about billable free-step counts. Pause generation before allowance
exhaustion. Keep project access/export available. No paid fallback, upgrade,
unbounded retry, deployment or model spending is authorized by this package.

No provider account has been supplied. Live generation, managed sandbox isolation,
private preview revocation, public publication, database recovery and final demo
acceptance remain blocked. SDK compilation and synthetic HTTP tests do not close
any of these gates.

## Reproduce and review

Use Node 24 and the repository's locked npm dependencies:

```sh
npm ci --no-audit --no-fund
npx vitest run tests/engine/scheduler.test.ts tests/engine/scheduler-delivery.test.ts --maxWorkers=1
VITEST_MAX_WORKERS=1 npm run verify
npm run test:db:control
npm run control:build
cd cloudflare/scheduler
WRANGLER_SEND_METRICS=false npx --yes wrangler@4.131.0 deploy --dry-run --outdir .wrangler/dry-run
```

`deploy --dry-run` bundles locally; **do not omit `--dry-run`**. It neither proves
account entitlement nor live Workflows behavior. The scheduler tests use explicit
HTTP/SDK/control fixtures. Native repository tests use disposable PostgreSQL and
synthetic identities; they do not prove this missing E1 port or live providers.
See the scoped [verification report](../../docs/reports/free-tier-scheduler.md).

Rollback before activation: leave both scheduler and control route disabled and
revert this isolated addition; no migration or running resource was created.
After future activation: first pause admission, retain outbox records, revoke
transport access and reconcile in-flight effects/leases. Removing a deployment
does not prove that a sandbox or publication stopped.

SDK contract references:
[trigger Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/),
[sleep and retry](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/),
[Workflow entry point](https://developers.cloudflare.com/workflows/get-started/guide/).
