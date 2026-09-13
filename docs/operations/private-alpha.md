# Private-alpha operating procedures (not a deployment)

All live capabilities remain disabled. These procedures are a reviewable operator handoff, not evidence that the referenced infrastructure exists. E1 owns actual durable admission, quota accounting, cleanup and kill switches; `engine/operations/` supplies strict telemetry and evidence calculations without a second scheduler or control database.

## Enablement sequence

Record D1–D8 decisions in the decision sheet. Validate owner-controlled configuration, identity revocation, narrowly scoped database roles, object version retention and signed runner release. Apply reviewed migrations explicitly to the intended environment; never use a command that discovers production credentials from the developer shell. Start with read/session access, then generation, execution and preview independently. Require A01–A19/A21 before E4 completion and A20/A22 plus owner sign-off before invited alpha. A feature flag cannot waive policy or authorization.

An execution security incident immediately disables new execution and revokes affected preview routes/sessions before teardown. Reads and explicit cancellation remain available. Preserve immutable evidence and uncertain cost reservations. Do not change a project head or discard audit/usage history as an incident workaround.

## Incident playbooks

| Trigger | Immediate action | Recovery and evidence |
| --- | --- | --- |
| Provider outage, rate limits or ambiguous completion | Pause affected model admission; honor bounded Retry-After. Mark dispatched unknown outcomes uncertain; no blind retry. | Reconcile provider request IDs/prices with durable attempts; retain unknown liability. Resume only after a known bounded probe is separately authorized. |
| Control PostgreSQL outage | Stop admission and new dispatch; fail authentication closed. Guests retain independent watchdog deadlines. | Restore from approved backup; apply retained WAL, verify RLS/roles, immutable reviews and event sequences, reconcile every operation before dispatch. Record RPO/RTO and object-version referential checks. |
| Artifact storage unavailable | Stop stages that need source; never substitute mutable local files. | Retry bounded reads of exact version/hash; sweep unreferenced quarantine only after grace/retention checks. DB references must resolve before resume. |
| Host loss or partition | Revoke routes; quarantine host; keep capacity reserved until termination or proven containment. | Reconcile operation IDs/epochs against host inventory. Never create a replacement preview at a stale hostname. Alert cleanup pending over 60 seconds and orphan inventory past five minutes. |
| Budget dispute / unexpected charge | Disable affected admission; preserve reservations and append-only ledger. | Reconcile request IDs and pinned price version; deduplicated adjustment only. Quota-period rollover cannot erase uncertainty. |
| Compromised template or isolation violation | Revoke template/policy, disable execution, revoke routes and isolate affected hosts. | Preserve evidence; rotate affected workload credentials, build a new independently reviewed release. Never silently resume old jobs on changed code. |
| Credential exposure | Revoke affected identity/key and sessions; restrict evidence access. | Rotate through approved secret manager; test old identity rejection and ensure no key entered source/events/export. Never log secret values. |
| Rollback | Disable new admissions; drain or cancel jobs using their pinned worker/template contracts. | Deploy previously verified compatible control version only after migration compatibility review. Source restore is a new reviewed job; preview data resets explicitly. |

## Telemetry and alert wiring

`telemetryEvent` accepts only named events, bounded integers and opaque UUIDs; arbitrary strings/unknown fields are rejected. Do not feed its validation exceptions containing raw objects into general logs. Job/request/operation IDs belong in traces, not metric labels. No prompt, source, credentials, stdout or provider body is accepted.

`healthActions` produces decisions for the operator/control integration. It does not actuate a kill switch. Wire queue age >120 seconds, cleanup unconfirmed >60 seconds, repeated provider failure, integrity violation, unhealthy routed previews, spend excess and resource pressure to the approved D8 destination. Exercise notification and on-call response before launch. Keep alert counts, acknowledged incident IDs and cleanup evidence in the operator system, without private source.

## Recovery drill

1. Use a distinct recovery environment with reviewed synthetic data first. Preserve exact backup/WAL and object versions; never restore over an active database.
2. Simulate a documented failure timestamp. Restore control DB through last recoverable commit. Recheck constraint/RLS/authorization suites using non-owner roles, replay cursor order and membership revocation.
3. Enumerate every available artifact reference from restored DB. Read its exact private object version, recompute byte digest, compare with stored digest; missing/mismatched versions fail the drill. Verify source heads and approvals without executing source.
4. Reconcile jobs/leases/preview route revocation and uncertain billing before allowing dispatch. Expired app data remains disposable; do not resurrect preview tickets or stale hostnames.
5. Submit actual timestamps/results to `evaluateRestore`. Target RPO ≤15 minutes, RTO ≤4 hours. Its result is a calculation, not a trusted attestation. A synthetic drill cannot pass the deployed recovery gate.
6. Record region, backup policy, key access, operators, full artifact denominator, broken references and cleanup. Delete only the recovery environment through the reviewed retention procedure.

## Capacity / quality campaign

Freeze corpus, model, prompt, template/image and policy digests. Run task-board creation, priority addition and Pomodoro-history variants. Obtain explicit spend approval first. Capture every attempted run including failures, timeouts, cancellations and admission denials; mark fixture samples separately. Run at least 30 real model attempts and at least 30 preview starts. Exercise steady load, burst admission, provider throttling, object/DB failure and host loss at a declared hardware/concurrency envelope.

`summarizeCampaign` rejects duplicate IDs and mixed release/corpus inputs. It excludes fixtures from live denominators; reports denial ratio, all admitted outcomes, p95 including failed attempts, unknown charges and Wilson 95% interval. Labeling an input live is not authentication: independently verify provider receipts and signed broker evidence. A threshold result never enables a model or establishes release readiness. Record 30-day availability separately; short campaigns cannot establish that SLO. No production scale claim is supported by local unit timings.
