# E5 private-alpha readiness — independent support implemented, release blocked

E5 is not complete: E4 has not passed real-system acceptance, D1–D8 remain open, and no live quality/load/restore campaign has run. No invited-user rollout, model activation, infrastructure purchase or public publishing occurred.

Implemented independent support:

- `engine/operations/readiness.ts`: strict frozen-corpus/release campaign inputs, duplicate rejection, fixture exclusion, complete attempt/outcome denominators, p95 values, admission ratio, Wilson confidence interval, exact integer cost aggregation and uncertain-liability reporting. Threshold calculations do not attest input provenance or enable a release.
- The same module evaluates recovery timestamps and exact artifact version/digest reference matches. Synthetic restore evidence cannot pass the deployed RPO/RTO target.
- `engine/operations/telemetry.ts`: strict content-free trace event schema and bounded operational health recommendations. Unknown fields such as prompts, credentials, source and raw errors fail validation. Operator/control wiring remains pending; recommendations do not themselves enforce quotas or disable execution.
- `docs/operations/private-alpha.md`: incident procedures for provider/DB/object/host failure, uncertain charges, template compromise, credentials, rollback, backup drill and capacity/quality campaign.
- `docs/reports/engine-decisions.md`: consolidated D1–D8 owner choices and concrete D2/D3/D4 proposals. Toolchain candidate evidence will be linked after review.

Verification: eight operations tests passed, targeted strict typecheck and lint passed. [Test log](evidence/e2-e5/operations-tests.log). These use synthetic inputs, including numbers intentionally labeled live to test the calculator; they are not real capacity samples. No actual backup system or alert destination was configured. No measured scale, uptime, RPO/RTO or provider quality claim is made.

Quota/lease/session enforcement remains exclusively E1-owned; it is not duplicated here. Final acceptance and integrated verification evidence will update this report after worker review. E5 exit also requires ≥30 live-provider reference runs, measured load/fault results, deployed restore drill, operations owner and release sign-off.
