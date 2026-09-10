# E4 connected flow — integration in progress, release blocked

E4 is not complete. Its exit requires A01–A19/A21 against real required systems. D1–D8 remain open, as explicitly confirmed by the owner. No live generation/execution/preview is enabled, and no fixture result is counted as real acceptance.

## Current interface coordination

E1 task `01a08894-4a5a-7f41-a577-5fc16f5d38bc` owns `engine/control/` and additive control migrations. Its `StageAdapter` receives a claimed immutable stage input with job/step/epoch/operation/input identity. Only E1 authorizes actors, commits state/version/lease CAS, adopts source references and promotes history. E2 provides source generation and artifact operations through this seam. E3 supplies broker admission and authenticated check evidence; it has no project-head authority.

The current E1 implementation intentionally accepts only fixture stage results, fixture catalog digests and inline fixture blobs. It cannot yet adopt arbitrary immutable artifact versions or admit a real model policy. The coordinator requested a documented catalog/read-port/artifact-adoption resolution; E1 files will not be changed concurrently. No duplicate control service will be built.

## Connected client logic

`src/engine/client.ts` and `flow.ts` now implement same-origin cookie/CSRF transport and the current E1 fixture API projections. The flow loads sessions/capabilities/projects/jobs/history; submits exact review digests/state versions; retains immutable action IDs/request bodies after ambiguous errors; coalesces duplicate actions; protects against out-of-order session/project/job/history responses; refreshes authoritative state during SSE and after terminal events; and supports explicit promotion/restoration acknowledgement. Reader disconnect never cancels the server job. A retained-cursor410 exposes replay-required because the current E1 job projection lacks a new checkpoint cursor.

The client has7 tests and flow has16 worker tests. They are synthetic HTTP tests, not authenticated production browser evidence. The modules remain dormant: no UI route imports them yet. Actual preview/source-export endpoints are marked `ENDPOINT_UNAVAILABLE`; no clickable fake preview or generated download is supplied.

## Independent gateway policy implementation

`engine/preview/policy.ts` contains strict validation for exact host and fresh control grants (at most 30 seconds), session/idle/absolute expiries, one-use launch request shape, reserved host cookie handling, same-origin guest mutations, normalized request paths, credential/header stripping, reserved/Domain/duplicate-cookie rejection and restrictive response headers. Six targeted synthetic tests passed initially; these are policy helper tests only.

The module is not a ticket store, authorizer, router, HTTP proxy or running gateway. Ticket consumption must be atomic in the existing control service, and the eventual proxy must resolve upstreams solely from trusted environment records. DNS/TLS, a separate registrable site, real session revocation, browser-cookie behavior and round-trip health remain D6/E1 integration work. No source is served publicly.

## Remaining connected flow work

1. Review E1 report/native tests and freeze catalog + stage/artifact read/adoption ports with its owner.
2. Integrate E2 generation, reviewable manifest/diff and export operations through existing durable stages; persist provider uncertainty and reservations before dispatch.
3. Integrate E3 signed broker calls, exact candidate evidence, cancellation and cleanup. Real Linux host, release image and template checks remain D2/D7 gates.
4. Connect frontend review/approval/repair/preview/history/restore/export to the actual authorized API; preserve local/sample/loopback behavior. Read Forge UI skill and perform full visual/browser matrix when UI changes occur.
5. Run real task-board plus priority migration, source restoration, clean export and private preview acceptance only after gates are satisfied. Report blocked scenarios explicitly.

See [implementation board](e2-e5-board.md), [decision sheet](engine-decisions.md), and forthcoming E2/E3/validation reports for worker evidence and restart instructions.
