# E4 bounded repair integration evidence

Status: **four local integration tests passed; E4/A16 live acceptance remains blocked.** The tests use native PostgreSQL18.6, actual E1 ControlWorker/ControlService/Reconciler and the E2 CandidateStageAdapter/source repository/immutable artifact APIs. Identity, provider products, verification, provisioning, preview and cleanup confirmation are explicit fixtures. No generated code executes, no provider/runner service is called, and no API spending occurs.

## Regression found and corrected

At integration baseline20c4045, CandidateStageAdapter emitted the same page bytes for GENERATING and REPAIRING because the fixture content included only the job ID. Its admitted source baseline stayed fixed, so the repaired unified diff also stayed identical. Fresh random artifact IDs changed the manifest digest without demonstrating changed source. A regression test failed at the assertion that the repaired page SHA256 must differ from the original page SHA256 (2026-09-10T02:13:13Z,1failed/3unselected).

The coordinated narrow fix to `engine/integration/candidate-stage.ts` requires the failed candidate manifest for REPAIRING and adds an explicitly synthetic repair comment binding that manifest digest, the reserved operation ID and the existing FIXTURE_CHECK_FAILURE diagnostic. Successive repair attempts now produce different reviewed source bytes and diffs through the actual E2 pipeline. This does not implement model-driven diagnosis or pretend to correct an actual generated application bug.

The worker's read-only dependency overlays came from20c4045. To avoid adding an existing integration file as a new file on this isolated branch, its narrow implementation diff was delivered separately as `/tmp/forge-e4-candidate-stage-repair.patch`; the coordinator applies it under shared ownership. The test/report commit depends on that patch. No E1 service, contract, migration, manifest or root configuration is modified by the test commit.

## Scenarios and evidence

`tests/engine/e4-repair-integration.test.ts` wraps the actual CandidateStageAdapter only to inject a typed fixture verification failure. It does not replace candidate generation, repair generation, transition logic or review construction.

| Scenario | Observed result |
| --- | --- |
| One verification failure, repair, then fixture success | Failed fixture resources marked destroyed; changed page SHA256 and diff SHA256; new review digest/revision; old approval rejected with STALE_APPROVAL; worker dispatch remains idle until fresh execution approval; fixture verification and promoted head bind the repaired manifest |
| Every verification attempt fails | Three verification failures; exactly two repairs; three different source diffs; exactly four reserved provider fixture operations: one plan, one generation and two repairs; cleanup leads to FAILED; five later worker polls dispatch no additional operation; no verified snapshot |
| Cancellation immediately before repair adoption | Cancellation advances the running repair epoch; late source result leaves the previous candidate/snapshot count unchanged; fixture cleanup reaches CANCELLED; no repeat repair dispatch |
| Epoch advances immediately before repair adoption | Stale worker cannot adopt repaired artifacts; previous candidate/snapshot count stays unchanged; subsequent cancellation/fixture cleanup reaches CANCELLED |

Final run:2026-09-10T02:13:51Z,4/4tests passed in4.89seconds on native PostgreSQL18.6. Engine strict TypeScript and scoped ESLint passed. The existing ancestor Expo tsconfig warning was emitted; no check failed because of it. Harness shutdown stops/removes the socket-only native database and deletes the immutable-artifact temporary directory.

Reproduce from the integrated repository after applying the coordinated candidate-stage patch:

```sh
PATH=/var/folders/y8/bczj85r901sgf3cl21ntxjym0000gn/T/forge-pg18-candidate-r5yy4wxo/install/bin:$PATH \
npx vitest run tests/engine/e4-repair-integration.test.ts
npx tsc -p tsconfig.engine.json --pretty false
npx eslint tests/engine/e4-repair-integration.test.ts engine/integration/candidate-stage.ts
```

The bin directory is the previously reviewed temporary local PostgreSQL18.6 build. No packages, services or infrastructure are provisioned by these tests.

## Limits and remaining gates

These tests add fixture integration evidence relevant to A05/A09/A10/A16. They do not pass those live acceptance gates. The injected error is the existing typed verification-stage fixture error, not an observed compiler, browser, database or sandbox check failure. The successful receipt and preview are also fixtures. The zero-cost provider ledger verifies bounded fixture operations, not real billing, uncertain charges or the separate12-call maximum under live provider batching/retries.

Still blocked or unrun: real provider diagnostics and source repair quality, isolated build/test failure followed by bounded repair, real guest cleanup during repair, broker/control cancellation under host partition, last-passing-state presentation in the connected UI, live cost/budget exhaustion, and private-alpha release acceptance. D1–D8 remain open; E4 prerequisites and the consolidated A01–A22 ledger remain coordinator-owned.
