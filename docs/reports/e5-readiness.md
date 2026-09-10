# E5 private-alpha readiness — independent support implemented, release blocked

E5 is not complete: E4 has not passed real-system acceptance, D1–D8 remain open, and no live quality/load/restore campaign has run. No invited-user rollout, model activation, infrastructure purchase or public publishing occurred.

Implemented independent support:

- `engine/operations/readiness.ts`: strict frozen-corpus/release campaign inputs, duplicate rejection, fixture exclusion, complete attempt/outcome denominators, p95 values, admission ratio, Wilson confidence interval, exact integer cost aggregation and uncertain-liability reporting. Threshold calculations do not attest input provenance or enable a release.
- The same module evaluates recovery timestamps and exact artifact version/digest reference matches. Synthetic restore evidence cannot pass the deployed RPO/RTO target.
- `engine/operations/telemetry.ts`: strict content-free trace event schema and bounded operational health recommendations. Unknown fields such as prompts, credentials, source and raw errors fail validation. Operator/control wiring remains pending; recommendations do not themselves enforce quotas or disable execution.
- `docs/operations/private-alpha.md`: incident procedures for provider/DB/object/host failure, uncertain charges, template compromise, credentials, rollback, backup drill and capacity/quality campaign.
- `docs/reports/engine-decisions.md`: consolidated D1–D8 owner choices and concrete D2/D3/D4 proposals. Exact Node24.20.0/PostgreSQL18.6 scaffold compatibility, clean export and dependency inventory are linked; all remain candidate evidence.

Verification: eight operations tests passed, targeted strict typecheck and lint passed. [Test log](evidence/e2-e5/operations-tests.log). These use synthetic inputs, including numbers intentionally labeled live to test the calculator; they are not real capacity samples. No deployed backup system or alert destination was configured. The later local platform-candidate recovery drill restored21 immutable versions and two pre-backup rows after a fresh PostgreSQL18.6 restore/restart, rejected four damaged/missing backup cases and measured831ms local restore. See [recovery report](e5-recovery.md). This is not a deployed RPO/RTO, PITR, E1 control backup or capacity claim.

Quota/lease/session enforcement remains exclusively E1-owned; it is not duplicated here. Final acceptance and integrated verification evidence will update this report after worker review. E5 exit also requires ≥30 live-provider reference runs, measured load/fault results, deployed restore drill, operations owner and release sign-off.

## Integrated checkpoint

The offline provider evaluator adds16 targeted tests and a frozen30-slot reference-corpus proposal. It binds model/template/prompt/price/evidence, reports every missing/failed/denied attempt, preserves uncertain liability and never grants spending or release authority. See[e5-provider-evaluation.md](e5-provider-evaluation.md). It made no API call.

Final repository verification:532 passed,4 optional tests skipped; lint, strict TypeScript, default/enabled UI builds and standalone control compilation passed. The acceptance ledger hashes16 evidence artifacts, records E1 fixture-verified and A21 passed, and keeps E2–E5/A01–A20/A22 blocked. All D1–D8 remain open. Historical failures and unrun native browser accessibility checks remain explicit. No release or capacity milestone was advanced from supporting fixtures.
