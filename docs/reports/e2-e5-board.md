# RFC 0001 E2–E5 implementation board

Status: implementation in progress; no E2–E5 milestone exit claimed. Coordinator owns integration and this board. Last updated: 2026-09-10 UTC.

## Ownership and baseline

The shared checkout contained concurrent E0, cloud/auth, documentation and E1 changes before work began. Preserve them. Worker worktrees use one snapshot commit `b0031b621db8cd7bdf200bc138f2ab771e6d4ed1` recorded in `../forge-e2-e5-worktrees/baseline.json` outside the repository; the original index and branch are unchanged. Integrate only worker-owned changes after review.

E1 is owned by Codex task **Implement E0 generation contracts**, ID `01a08894-4a5a-7f41-a577-5fc16f5d38bc`, currently implementing E1. Coordination message sent requesting adapter seams and additive integration requirements. E1 is not assumed complete. Reserved to E1: `engine/control/`, control migrations and E1 tests/report. Shared contracts and dependency manifests remain serialized. E1 explicitly released `tsconfig.engine.json` and `eslint.config.js` to the coordinator for narrow runner/template/test inclusion; those changes are integrated. The agreed catalog/artifact bridge waits for E1 final tests/report and explicit release of control ownership.

| Task | Dependencies | Owner / worktree | Owned files | State / evidence / blockers |
| --- | --- | --- | --- | --- |
| E2 provider/context/source/artifacts | E0; E1 seam for integration | generation worker / generation | `engine/providers/`, `engine/artifacts/`, `engine/generation/`, dedicated E2 tests, `docs/reports/e2-generation.md` | Independent implementation integrated; 41 targeted tests passed. Live gate D3/D4/D5/D7 |
| E3 broker/runtime/template | E0; D2/D7 for real execution | runtime worker / runtime | `runner/`, `engine/runner-client/`, `templates/next-postgres-v1/`, dedicated E3 tests, `docs/reports/e3-runtime.md` | Independent broker/template implementation integrated; 42 targeted tests passed. Worker implementing separate host watchdog/inventory and reviewed Linux configuration; real executor unavailable |
| Independent harness/security validation | E0; integrates E2/E3 after delivery | validation worker / validation | `engine/validation/`, dedicated adversarial/harness tests, `docs/reports/e2-e5-validation.md` | Integrated strict SQL/dependency/secret validation and integration harness; 87 targeted/native synthetic tests passed. Worker preparing A01–A22 machine ledger |
| E1 integration / E4 flow | E1 interfaces and targeted tests; E2/E3 | coordinator, then reused workers | `src/engine/client.ts`, `src/engine/flow.ts` and their tests; preview policy helpers | Client + headless flow integrated (flow commit5cafb61;16 worker tests). Awaiting E1 final handoff for catalog/artifact bridge |
| E5 operations and release evidence | E4 for milestone exit; harness work independent | coordinator, then reused workers | `engine/operations/`, coordinator tests, acceptance records, operations runbooks | Independent support integrated; release blocked on D1–D8 and live gates |

## Decisions and external gates

All D1–D8 remain unresolved; owner explicitly reconfirmed this. Existing NVIDIA/Neon experiments grant no engine authority. Owner requested concrete D2/D3/D4/D7 proposals and authorized local candidate toolchain tests. See [decision sheet](engine-decisions.md). D1 identity; D2 hardened Linux/KVM; D3 generation provider/model/entitlement; D4 prices and spend/quota envelope; D5 hosting/object storage/KMS/residency/retention/backups; D6 separate preview site/TLS/gateway; D7 exact template/toolchain/image and dependency review; D8 invites/operations/alerts/release sign-off. No purchase, paid provisioning, DNS change, public publishing or unapproved provider spending is authorized. No live execution without required isolation.

## Acceptance ledger

`passed`, `failed`, `blocked` and `not-run` refer to the exact evidence layer. Fixture/unit tests never close live acceptance. Full machine-readable A01–A22 evidence will accompany integration. Current release-level status is blocked for A01–A20/A22 on pending prerequisites; A21 awaits final repository and browser verification. Existing E0 test results are prior evidence only.

## Integration and restart procedure

1. Read AGENTS.md, RFC 0001, E0 report, this board, current E1 report/task and worker milestone reports.
2. Inspect shared `git status`, worktree list and baseline record. Do not reset/stash concurrent changes or commit them as worker output.
3. Review each bounded worker diff and targeted evidence. Transfer only owned files; serialize shared configuration changes with E1.
4. Run targeted integration checks, `npm run verify` and affected browser flows. Record failures and exact limitations; never enable live capabilities from fake results.
5. Reuse workers for ready integration, security and operational work. Keep E4 incomplete until A01–A19/A21 pass against real systems; E5 additionally requires A20/A22 and D1–D8 closure.

Deferred commercial scope remains RFC §2: public deployment/custom domains, GitHub/import, arbitrary packages/stacks, production app auth/data, payments/email, external connectors, collaboration/mobile and image generation. It is not part of this implementation's acceptance denominator.

## Coordinator independent work / review log

- `engine/operations/readiness.ts`, `telemetry.ts`, `tests/engine/operations.test.ts`: 8 tests passed; targeted strict typecheck/lint passed. Synthetic calculations only; no measured provider/capacity/recovery result. [Evidence](evidence/e2-e5/operations-tests.log).
- `engine/preview/policy.ts`, `tests/engine/preview-policy.test.ts`: host/grant lifetime, launch, cookie, CSRF and header policy; 6 synthetic policy tests passed, targeted typecheck/lint passed. No running gateway, DNS, TLS or E1 ticket integration claimed.
- [Operating procedures](../operations/private-alpha.md): enablement, provider/DB/object/host/budget incidents, rollback, credential rotation, recovery and capacity campaigns. Alert wiring remains D8.
- E1 confirmed StageAdapter inputs will carry immutable job/step/epoch/persisted context; adapter outputs commit through E1 CAS. Fixture-only DB needs a reviewed additive integration migration; no second service. Await concrete interface and E1 native tests.
- E2 review requested real restart-persistent local synthetic artifact backend in addition to explicit memory fake.
- E3 review requested external calls outside global journal lock, bounded hangs, fenced immutable collection and cancellation epoch tests.

## Integrated worker commits and current evidence

- E2 `0331f7b` + `eb8d676`: provider/context/catalog/source/diffs and immutable memory/local synthetic artifacts; 41 tests. Credential lookup has a deadline; brief hash matches exact E1 UTF-8 instruction bytes.
- E3 `bf2130c` + `f5a8670`: broker, journal, signed transport, collector, app database port, template and strict release evidence; 42 tests. Real Linux executor remains unavailable. Follow-up host watchdog assignment is active.
- Validation `447b5a1`, `765bf9a`, final owned diff `37ccd7d..801d897`: SQL/dependency/secret validation plus actual E2/E3 integration, pinned template catalog/export checks; 87 tests including native **synthetic** PostgreSQL drill. Reference dependency commits were not applied twice.
- Coordinator: operations 8 tests, preview policy 6 tests, dormant client 7 tests. Independent review corrected recovery RTO origin, path/header filtering, telemetry error redaction and client abort/deadline/SSE handling.
- **Integrated independent check: 191/191 passed, zero skipped**, with `FORGE_NATIVE_MIGRATION_TEST=1`; [JSON](evidence/e2-e5/integrated-tests.json), [log](evidence/e2-e5/integrated-tests.log). This includes real native PostgreSQL executing reviewed synthetic migration SQL, not guest PostgreSQL or generated source.
- Candidate scaffold: exact Node24.20.0 archive checksum checked; local lint/typecheck/environment test/production build pass. Worker six light/dark390/768/1440 browser cases and keyboard/reduced-motion/CSS200% zoom pass after overflow fix. [Candidate evidence](../../runner/evidence/candidate/) is platform-authored local compatibility evidence only. Local listeners stopped.
- Candidate lock audit: zero reported known vulnerabilities across482 packages at retrieval; license metadata inventory has482 packages and no missing declarations. [Audit](evidence/e2-e5/candidate-npm-audit.json), [inventory](evidence/e2-e5/candidate-license-inventory.json). This is metadata triage, not legal/security approval or a released image.
- Root strict engine typecheck passed with runner/template policy/release included. Final repository verification and affected Forge browser flow remain pending E1/E4 integration. E1 owner is resolving its own final lint/test findings.

## Agreed next integration boundary

E1 remains the single session/admission/lease/CAS/metering/promotion authority. After its handoff, add injected catalog and scoped immutable artifact ports to that service/worker. Preserve default E1 fixtures; candidate-catalog synthetic mode retains `origin: fixture`, zero paid cap and disabled generation/execution capabilities. Immutable content must be read/validated outside lease transactions and exact object versions/hashes adopted under E1 fencing. No real multi-call provider integration can be claimed until per-attempt durable reservations and D3/D4 policies exist. Candidate image hashes are not invented to enable a runner.

## Latest checkpoint

- First shared `npm run verify`: lint/typecheck passed;331 tests passed,1 failed,1 skipped. E1 native recovery failed on missing `audit_events.actor_id`; E1 owner acknowledged and is fixing it. Combined reruns are paused at its request to avoid racing edits/build. Keep the failed record until superseded by a successful final run.
- Existing Forge browser compatibility: synthetic local brief creation, sample advancement/file labels, preset package download, brief export and test-brief cleanup exercised. Original local projects preserved. [Browser record](evidence/e2-e5/forge-browser-compatibility.json). Download bytes were not independently inspected by that browser check; repository archive tests supply separate support.
- PostgreSQL18.6 candidate: official source checksum verified, temporary prefix compilation, actual app bootstrap/default privileges/restricted roles, fresh/prior-seeded migration and database restart passed. Two native tests passed; [JSON](evidence/e2-e5/postgres18-candidate.json), [log](evidence/e2-e5/postgres18-tests.log). This is platform-authored local compatibility, not guest or generated-app evidence. Clusters stopped and removed; binaries remain in the temporary prefix recorded in source evidence.
- Runtime review found a stale absence observation/late launch cleanup race; worker is adding fencing and a regression case before delivery. Metadata preflight must also reject malformed BPF state.
