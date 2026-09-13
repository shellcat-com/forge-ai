# E2–E5 implementation checkpoint

The repository now has an integrated, explicitly synthetic source-building flow through the existing E1 control service. The RFC private-alpha engine is **not release-ready**. E2–E5 real milestone exits remain blocked; all D1–D8 are OPEN. No paid provider call, service purchase, public deployment or sandbox downgrade occurred.

## Delivered and verified

- E2: bounded provider adapter and context assembly, structured source proposals, protected template/manifest/migration validation, immutable artifact storage, hash-bound diffs/reviews, scoped file reads, scanner-bound export and source restoration. The agreed E1 bridge adopts exact references under its existing lease/tenant/state fences. Revalidation does not write comparison artifacts.
- E3: signed/mTLS sandbox broker and client, strict command/resource/network policies, immutable result collection, cleanup/expiry journal, host inventory/watchdog and candidate host configuration. Real local TLS tests found and fixed pooled-socket pinning bypass. The unavailable driver remains the default.
- E4: optional server-session UI, actual source/plan/diff display and browser-side hash verification; exact displayed approvals; retained retry identity; session/stale-navigation protection; fixture build/check/repair stages; promotion/history/restoration and ZIP export. The native HTTP test starts at project creation and admission. Repair tests enforce changed source/diff, fresh approval, two-repair limit and cancellation/epoch fencing. Private preview remains disabled.
- E5: adversarial/fault fixtures, acceptance ledger, content-free telemetry schema, recovery/capacity calculations, offline provider-quality evaluation and operating/restart procedures. A real local PostgreSQL18.6/scaffold recovery drill restored21 immutable versions and pre-backup rows after a fresh restore/restart; it is not deployed backup evidence.

`npm run verify` passed lint, TypeScript, **532 tests**, and production build; **4 explicit optional tests skipped**. The enabled engine UI build, standalone control build and strict engine compile also passed. Optional scaffold export/PG18/recovery/native migration drills have separate successful evidence. Normal light/dark390/768/1440 and keyboard focus were inspected. CSS200%zoom and forced reduced-motion styles are explicitly simulations; native browser zoom/OS activation are NOT-RUN. Existing topbar overflows in the CSSzoom simulation, while engine content fits.

The [acceptance ledger](evidence/e2-e5/acceptance.json) validates16 evidence hashes: A21 compatibility passed; A01–A20/A22 blocked. Historical failures remain recorded and explicitly superseded. E1's fixture exit is preserved;24 nonreleased files match its frozen manifest. See the [board](e2-e5-board.md) for ownership, commits and evidence.

## Run and resume

Use [engine development instructions](../operations/engine-development.md). The native synthetic connected check is:

```sh
npx vitest run tests/engine/e4-control-http.test.ts tests/engine/e2-control-integration.test.ts tests/engine/e4-repair-integration.test.ts
```

`VITE_FORGE_ENGINE_UI=true npm run dev` exposes `http://127.0.0.1:5173/#/engine` through a fixed loopback API proxy. It shows unavailable state without a configured control session; the flag creates no identity or runtime authority. Default CLI startup remains E1's fixture composition. The trusted test harness injects candidate source dependencies explicitly and cleans up its temporary native database/objects. It is not an authentication service for real users.

A local review checkpoint is on `codex/e2-e5-checkpoint` in `../forge-e2-e5-worktrees/checkpoint`; external`checkpoint.json` records its commit and consistent baseline. The shared checkout/index and unrelated changes are preserved. This checkpoint has not been pushed or merged.

## Exact remaining blockers

1. **D1 identity:** choose and configure the engine OIDC/invite/session authority and real two-user access. Only fixture identity is wired. Existing Neon and NVIDIA experiments are not approvals.
2. **D2/D7 execution:** supply an approved hardened Linux/KVM host, exact maintained Firecracker/jailer/kernel/rootfs/toolchain releases, privileged host setup and workload identity. Actual LinuxExecutor/guest RPC/image builder and end-to-end signed runner integration remain absent. No source executes on an ordinary host as a substitute. Real containment, offline preparation, app-local SCRAM credentials, migration/browser/restart and neighbor/resource/cleanup tests remain unrun.
3. **D3/D4 generation and billing:** approve exact endpoint/model/account limits, server secret reference, dated prices and spend ceilings. Prove billable token bounds; extend the single E1 accounting seam with durable per-call reservations/settlement before live multi-call generation. No provider corpus or usage/cancellation/capacity evaluation ran. The current source bridge is deliberately zero-cost/fixture-only.
4. **D5 persistence/operations:** select deployed control PostgreSQL, versioned object store/KMS, residency/IAM/retention and backup ownership. Current artifact backend is local synthetic storage; production version/authorization/cleanup and control-data restore/PITR are not implemented or verified against a selected service.
5. **D6 private preview:** choose separate registrable preview site/TLS and trusted routing. Policy helpers exist; atomic E1 ticket consumption, live gateway/environment routing and private browser-cookie/revocation/SSRF tests still depend on the approved control/runtime interfaces. No working preview URL is supplied.
6. **D8 release:** nominate operations/alerts/invite owners and approve runbooks/envelopes. Wire deployed telemetry and alerts; run the full security/fault/restore/capacity campaign and at least30 live-provider reference runs before sign-off. Calculators and synthetic labels grant no release authority.
7. **Repository reconciliation:** E1 reported a separate Next.js/server engine on remote master (`6a8095e`). Its checkpoint [PR7](https://github.com/shellcat-com/forge-ai/pull/7) is open/conflicting. That remote architecture is not merged here. Resolve ownership/contracts explicitly; do not merge two competing control services or discard either task's work silently.

The [decision sheet](engine-decisions.md) consolidates owner choices, required access, candidate costs and verification gates, including the locally tested pinned D7 candidate. All proposals remain unapproved. Public deployment/custom domains, GitHub import, arbitrary stacks/packages, production app auth/data, payments/email, connectors, collaboration/mobile and image generation remain separate RFC-deferred commercial work.
