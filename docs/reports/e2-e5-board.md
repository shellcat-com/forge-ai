# RFC 0001 E2–E5 implementation board

Status: independent implementation checkpoint verified; E2–E5 real milestone exits remain blocked. Coordinator owns integration and this board. Last updated: 2026-09-10 UTC.

## Ownership and baseline

The shared checkout contained concurrent E0, cloud/auth, documentation and E1 changes before work began. Preserve them. Worker worktrees use one snapshot commit `b0031b621db8cd7bdf200bc138f2ab771e6d4ed1` recorded in `../forge-e2-e5-worktrees/baseline.json` outside the repository; the original index and branch are unchanged. Integrate only worker-owned changes after review.

E1 task **Implement E0 generation contracts**, ID`01a08894-4a5a-7f41-a577-5fc16f5d38bc`, completed its fixture handoff. Its report/native evidence is frozen;24 nonreleased files still match the E1 manifest exactly. Approved integration ownership covers catalog/stage/service/worker, HTTP routes, database artifact kind and additive0003 only. Shared E0 contracts,0001/0002, dependency manifests, identity, lease/accounting and cleanup foundations are preserved. See the handoff/commit log below.

| Task | Dependencies | Owner / worktree | Owned files | State / evidence / blockers |
| --- | --- | --- | --- | --- |
| E2 provider/context/source/artifacts | E0; E1 seam for integration | generation worker / generation | `engine/providers/`, `engine/artifacts/`, `engine/generation/`, dedicated E2 tests, `docs/reports/e2-generation.md` | Independent implementation integrated; 41 targeted tests passed. Live gate D3/D4/D5/D7 |
| E3 broker/runtime/template | E0; D2/D7 for real execution | runtime worker / runtime | `runner/`, `engine/runner-client/`, `templates/next-postgres-v1/`, dedicated E3 tests, `docs/reports/e3-runtime.md` | Independent broker/template implementation integrated; 42 targeted tests passed. Host watchdog/inventory and reviewed Linux configuration integrated;12 real local TLS fixture tests; exactNode24/PG18 candidate/export/recovery checks passed. Real executor unavailable |
| Independent harness/security validation | E0; integrates E2/E3 after delivery | validation worker / validation | `engine/validation/`, dedicated adversarial/harness tests, `docs/reports/e2-e5-validation.md` | Integrated strict SQL/dependency/secret validation and integration harness; 87 targeted/native synthetic tests passed. A01–A22 machine ledger implemented; 91 browser client/flow/source/workspace tests and independent review integrated |
| E1 integration / E4 flow | E1 interfaces and targeted tests; E2/E3 | coordinator, then reused workers | `src/engine/`, narrowmain/proxy/UIflag, approvedcontrolsourcebridge/HTTP, additive0003; preview policy helpers | E1 handoff complete; actualsource/HTTP/client review→fixturechecks→promotion/history/export integrated. Native transport2/2 and repair4/4 passed; real runner/privatepreview blocked |
| E5 operations and release evidence | E4 for milestone exit; harness work independent | coordinator, then reused workers | `engine/operations/`, coordinator tests, acceptance records, operations runbooks | Offline evaluation/telemetry/runbooks and real localcandidate recovery support integrated; release blocked on D1–D8 and live gates |

## Decisions and external gates

All D1–D8 remain unresolved; owner explicitly reconfirmed this. Existing NVIDIA/Neon experiments grant no engine authority. Owner requested concrete D2/D3/D4/D7 proposals and authorized local candidate toolchain tests. See [decision sheet](engine-decisions.md). D1 identity; D2 hardened Linux/KVM; D3 generation provider/model/entitlement; D4 prices and spend/quota envelope; D5 hosting/object storage/KMS/residency/retention/backups; D6 separate preview site/TLS/gateway; D7 exact template/toolchain/image and dependency review; D8 invites/operations/alerts/release sign-off. No purchase, paid provisioning, DNS change, public publishing or unapproved provider spending is authorized. No live execution without required isolation.

## Acceptance ledger

`passed`, `failed`, `blocked` and `not-run` refer to the exact evidence layer. Fixture/unit tests never close live acceptance. The machine-readable[evidence ledger](evidence/e2-e5/acceptance.json) and its[validation summary](evidence/e2-e5/acceptance-validation.log) are current: A21 passed; A01–A20/A22 blocked. E1 fixture exit is verified; E2–E5 real milestone exits remain blocked. Existing E0 test results are prior evidence only.

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

## E1 handoff and current ownership

E1 completed its independent fixture exit and explicitly released `control/catalog.ts`, `stage-adapter.ts`, `service.ts`, `worker.ts` and additive migration0003 to this coordinator's E2 bridge. Its45 native cases,45 E0 assertions and394-pass/2-optional-skip repository evidence are frozen under `docs/reports/evidence/e1/`; do not rewrite them. Historical E1 fixture completion does not close D1/D4/D5 or real acceptance.

New consistent integration snapshot: `b981ec6b1dfafdeacd32a3765479fd1613622c9a`, branch`codex/e2-e5-integration`, worktree`../forge-e2-e5-worktrees/integration`; metadata in`integration-baseline.json` outside the repository. Generation worker now owns the bounded catalog/StoredSource bridge plus`engine/integration/`, additive0003 and dedicated E2 integration tests/report. It must preserve0001/0002, default fixtures and all control fences. Coordinator retains shared configs and additive HTTP routing ownership; no second service.

Coordinator UI scope: `src/engine/{view,workspace,source-client}.ts`, scoped workspace CSS, narrow`src/main.ts` routing/events, optional fixed-loopback development proxy in`vite.config.ts`, public default-false UI flag in`.env.example`, DESIGN specification and UI tests. The source-client adapter is pending actual bridge read contracts. Validation worker owns dedicated workspace tests and a clearly labeled deterministic browser design fixture. Approvals require the exact displayed review token, not a newly fetched unseen review.

Runtime`fcb5e68` integrated:20 OS-fixture watchdog tests. Runtime`33b521e` integrated:12 real local TLS tests with fixture authority/host; fixed confirmed HTTPS-agent connection reuse bypass of per-client certificate pinning. Fresh per-RPC TLS trust scope now used. Temporary PKI/listeners cleaned. Runtime worker is checking clean export/build of the platform-authored candidate only; no provider output is executed on the host.

Validation ledger commits`2e19191` +`a2724b7` integrated. The checkpoint retains the historical E1 audit failure until a successful current verification explicitly supersedes it; no evidence hash may be silently changed. Ledger supports E1 fixture-verified and A21 compatibility when their exact supporting checks are present; all other real acceptance remains blocked.

## Connected-source integration checkpoint

- Integrated generation`20c4045`: approved additive0003, immutable source adoption, exact plan/diff/file reads, hash-bound ZIP export/replay and guarded artifact locator. E1 native45 regression cases and18 bridge cases passed in worker worktree. Source I/O occurs outside lease transactions; adoption/read results are fenced afterward.
- Integrated source-client`e970377`: bounded same-origin attachments, canonical WebCrypto verification and shared in-memoryCSRF.58 targeted client/source/workspace tests passed in worker worktree.
- Integrated runtime`0da7c60`: actual pinned20-file platform scaffold roundtrip through local artifacts/export/clean extraction, offline install and exactNode24 lint/typecheck/test/build. No generated code executed on host.
- Coordinator optional UI/HTTP routes are connected for native transport verification. Initial combined test found history pagination envelope mismatch; validation worker owns its narrow repair. Do not claim a passed connected flow until the new native transport suite passes.
- Static UI inspected light/dark at390/768/1440 and keyboard focus; source probes render as text, no horizontal overflow. Browser nativezoom/reduced-motion emulation unavailable; explicitly not counted passed. Record:`evidence/e2-e5/engine-ui-browser.json`.
- Runtime worker owns local backup/restore drill; generation worker owns provider-evaluation input harness and read-onlydiff refactor; validation worker owns historypagination and independent UI/HTTP review.
- E1 task reports remote`master` moved to`6a8095e` through PR4 with a separate Next.js/server engine. It is publishing its checkpoint from a separate worktree; architecture reconciliation is unresolved. Coordinator requested no merge of competing control services and no overwrite of this active checkout. Remote changes are not silently included in local acceptance.

- Root connected transport`connected-http-v3.log`:2/2 native HTTP tests passed, exercising shared browserclient→E1 service→actualcandidate bytes through plan/execution/promotion reviews and ZIP export, plus foreignscope/CSRF/path/attachmentheaders. Earlier v1/v2 failures remain archived as evidence of fixed client schema mismatches; no live provider or runner used.
- Integrated runtime`bec6c7b`: real local PostgreSQL18.6 dump/restore/restart +21 DB-referenced immutable artifact versions,2 tests passed; local restore831ms. Synthetic platformdata only, not productionbackup/PITR acceptance.
- E1 publication PR[7](https://github.com/shellcat-com/forge-ai/pull/7) is open/conflicting; commit`09c193a828d99a1c0a811c0d3d5361bd67af283c` from separate`forge-e1-publish` worktree. It excludes the later sourcebridge/UI/HTTP changes. No merge or sharedindex edit occurred. Architectural reconciliation with remote PR4 remains a separate blocker.

## Final coordinated verification and resume point

All three workers completed their final bounded assignments. Generation`7caa0bb/944e748/2ada580` delivered offline provider evaluation, aligned proposal and read-onlydiff validation. Runtime`08cf216` plus the reviewed candidate-stage patch fixed unchanged repair source and added4 native repair tests. Validation`5d674f8/dd4aada/101c9c6/5c973fc` supplied pagination, promotion-envelope/retry/session regressions and explicitly labeled UI simulations. Root owns the narrow factory preset option, connected HTTP tests, route/UI state fixes and reports.

- `npm run verify`:532passed,4optional skipped; lint/typecheck/test/build passed. Log:`evidence/e2-e5/repository-verify-final.log`.
- Enabled UI production build and standalone control build passed; strict engine TypeScript passed.
- Root UI/repair integration95/95; native HTTP2/2. Worker final source/evaluation/nativebridge73/73. No provider or generated-code host execution.
- Ledger validates16 artifact hashes; A21passed,21blocked; historical supportfailure explicitly superseded. E1 preservation check confirms24 nonreleased files match frozenmanifest.
- Test Vite listener stopped and browser tab closed; viewport override reset. Temporary PostgreSQL clusters/TLS material/export/recovery directories were cleaned by harnesses. Compiled candidate tools remain only at recorded temporary paths.
- A local review checkpoint is prepared on`codex/e2-e5-checkpoint` in`../forge-e2-e5-worktrees/checkpoint`, from consistentE1-final baseline`b981ec6`. The external`checkpoint.json` records its commit/tree and root-index preservation; this local checkpoint is not published or merged. Resume from[engine-development.md](../operations/engine-development.md) and the[decision sheet](engine-decisions.md).
