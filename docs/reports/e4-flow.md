# E4 connected flow — synthetic integration implemented, release blocked

E4 is not complete. Its exit requires A01–A19/A21 against the real required systems. D1–D8 remain OPEN. No live generation, execution or preview is enabled; no fixture result counts as live acceptance.

## One coordinated control service

E1 task `01a08894-4a5a-7f41-a577-5fc16f5d38bc` completed its fixture handoff and released the catalog, stage adapter, service, worker, guarded artifact locator extension and additive0003. Its45 native tests and frozen report/evidence remain unchanged. The E2 bridge (`20c4045`) injects a catalog and immutable source repository into that existing service. It does not create a second authorizer, job service or promotion authority.

Real candidate bytes now pass through complete manifest validation, exact immutable object adoption, unified diff review, source-file reads, source promotion/history/restoration and scanner-bound ZIP export. The integration factory uses the pinned platform scaffold and an explicitly synthetic provider response. Build/check/preview stages remain fixtures. Source reads reauthorize after object I/O; export replay keeps one adopted artifact per idempotent action and checks current membership, scanner policy, verification freshness and expiry.

HTTP routes add `/jobs/{id}/plan`, `/jobs/{id}/changes`, `/snapshots/{id}/files`, `/snapshots/{id}/file?path=...`, `/snapshots/{id}/exports` and `/artifacts/{id}`. The legacy scoped artifact JSON route remains. Attachments have no-store, nosniff, restrictive CSP and attachment disposition; filenames and internal storage locations are not accepted from source content.

## Optional UI and client

`VITE_FORGE_ENGINE_UI=true` enables `#/engine`; it defaults false. The route uses shared Forge components and scoped semantic CSS. Existing local projects, samples and loopback text planning remain separate and labeled. No local state creates a control identity. Without a configured server session, the route explains that the control service is unavailable.

The client loads authorized projects/jobs/history, verifies actual plan/manifest/diff/source/verification hashes with WebCrypto, and binds approval to the exact displayed review digest/state version. It retains action UUIDs and immutable request bodies after ambiguous failures, fences stale reads and navigation, aborts reader requests on departure, and keeps cancellation a separate server mutation. Source is escaped text. Private preview is disabled. Source export supplies a verified ZIP only when the scoped bridge permits it.

The static design fixture at `tests/harness/engine-view.html` explicitly says its buttons contact no service. Light/dark390/768/1440 and keyboard focus were inspected with no horizontal overflow. Native browser zoom and OS reduced-motion activation remain NOT-RUN in the available tool. Explicit CSS200%zoom and forced existing reduced-motion styles were separately inspected: engine content fits and transition/animation durations are0s; existing topbar overflows under CSSzoom because media breakpoints are unchanged. These simulations do not count as native behavior.

## Verification and limits

Worker evidence:18 native bridge cases plus45 E1 regressions passed; source/client/workspace58 targeted tests passed. The coordinator native HTTP/client test passed2/2 after fixing history pagination and promotion-project envelope mismatches (`evidence/e2-e5/connected-http-v4.log`). It starts at client project creation/admission. The native repair suite passed4/4 after fixing identical synthetic repair bytes, and91 browser client/flow/source/workspace tests passed, including revoked-session clearing and stable retries after refresh/navigation. Final `npm run verify`:532 passed,4 optional skips; lint/typecheck/build passed. Both default and enabled UI production bundles and standalone control compilation passed.

The headless synthetic flow runs with `npx vitest run tests/engine/e4-control-http.test.ts tests/engine/e2-control-integration.test.ts`. It starts a disposable native PostgreSQL cluster and existing HTTP service, consumes explicit fixture identity/provider/execution results, and cleans up. See [development instructions](../operations/engine-development.md).

## Remaining real integration

- D1/D5: approved OIDC, production database/object storage/KMS, deployment and retention/backup ownership.
- D3/D4: approved model/account/spend, real response and usage tests, durable per-provider-call reservations and uncertain-charge reconciliation. Current bridge permits one explicit zero-cost fixture product per stage.
- D2/D7: hardened Linux/KVM, actual executor/guest RPC/image build, reviewed release digests and real isolated template/database/security tests. The default runner remains unavailable; no host fallback exists.
- D6: separate preview site/TLS, atomic tickets in E1, trusted environment routing and private gateway. `engine/preview/policy.ts` is six tested policy helpers, not a running gateway.
- Complete real task-board/priority migration, bounded repair, private preview, restore and clean generated export acceptance. Broader commercial functionality remains deferred by RFC0001.

Remote publication also needs architectural reconciliation: E1 reported a separate engine/Next.js rewrite on remote master. Those changes have not been merged into this active implementation or included in its evidence.
