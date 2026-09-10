# Task 02 — isolated runtime implementation

Status: **implementation and local contracts delivered; D2/live execution disabled**. This is not a containment pass. No real KVM host, managed sandbox, provider run, generated portfolio execution or public/private runtime deployment occurred. The existing unavailable driver remains the default.

## Baseline, ownership and coordination

Own branch: `codex/task-02-runtime`; isolated worktree: `/tmp/forge-task02-runtime`, created with `git -C /tmp/forge-task01-clean-reproduction worktree add -b codex/task-02-runtime /tmp/forge-task02-runtime 881e9ac2b11f8f168cb7849b77c4ee7439e55458`. The shared original checkout was read only; its Git commands stalled, so Task 01's independent reproduction repository supplied the worktree. No conflicting baseline was reconstructed.

Verified origin: `https://github.com/shellcat-com/forge-ai.git`. This task's draft PR targets `codex/demo-delivery-baseline`, depending on Task 01 / [PR #8](https://github.com/shellcat-com/forge-ai/pull/8), Task 03 / [PR #13](https://github.com/shellcat-com/forge-ai/pull/13)'s image inputs/release, Task 07's authenticated preview registry and Task 06's private artifact sink. PR #7 is already merged. No merge/force-push/other PR closure was performed.

Read AGENTS.md, RFC 0001, E0/E1 reports, E2–E5 checkpoint, engine-decisions.md, current broker/client/signature/lease/tombstone/collector code and Task 01's published coordination board. Task 01 explicitly confirmed ownership and unchanged shared `HostDriver`, `LinuxExecutor`, broker and authority seams. No engine/control/contracts/migrations/manifests/lockfiles or UI were edited. Existing runtime tests and work were preserved.

Task 03 published image-input contract commit `b3fb6f6771c482a09fc0a431240e7d3c250172d6` / draft PR #13; no task-03 files are copied into this diff. Its canonical imageInputsDigest is `8f1eb9960174fb682ec53abd1eec7abc614f4448e20e5ad14eee376011864ed5`; the raw input file hash remains separately recorded. Task 03 and Task 01 agreed the image must use an independent `templateInputsDigest`; final E2 templateDigest includes imageDigest and therefore cannot appear recursively in the image preimage. Task 07 integrated against `requestApp` and the required separate DB+process `health` contract; generation/tenant/source/image resolution stays in its authenticated registry. BYOK, Next.js + strict TypeScript + PostgreSQL, Vercel website hosting, no purchased domain and the real portfolio requirement remain intact; none implies runtime admission.

## Delivered implementation

- `runner/host/linux-executor.ts` and `linux_helper.py`: fixed privileged helper calls, pinned Linux/KVM image checks, actual systemd/Firecracker/jailer launch, read-only image/metadata disks, bounded scratch, no NIC, per-attempt watchdog, fsynced fencing/tombstones, delayed-start masking, cleanup observations and retained uncertain capacity.
- `runner/guest/protocol.ts`, `agent.py` and guest unit/boot/network files: bounded authenticated vsock RPC, replay/source/image/attempt binding, chunked exact-source transfer, sealed `/workspace`, offline dependency materialization and direct approved build/test tools. Generated processes share root-controlled memory/CPU/PID quotas, cannot use AF_VSOCK and receive only their disposable app-role DB credential.
- Guest app-local PostgreSQL bootstrap/SCRAM provisioning, strict-parser approved migration transaction, app start/restart, app-role readiness probe and fixed-port HTTP access. No provider/control/deployment credentials are accepted in the guest interface.
- `runner/firecracker-driver.ts`: existing broker/lifecycle integration with exact source/review/command/migration hashes, current host fence checks before and after RPC, mandatory separate isolated external-check seam, bounded output collection and typed preview transport. No external check is marked successful from guest logs or a host-process fallback.
- `runner/image/contract.ts` and `assemble.py`: strict non-circular immutable bundle, offline packaging of an operator-prepared trusted Linux tree and actual input-byte receipts. No image tag/default digest or fabricated image artifact.
- `tests/engine/task02-runtime.test.ts`, `tests/runner/test_runtime_contract.py`: local transport/integration and explicit OS/guest fault simulations. `runner/guest/check_database.py`: opt-in temporary native PostgreSQL credential/grant/restart compatibility check.

The [runtime deployment contract](../../../runner/host/RUNTIME.md) defines exact schemas, digest preimages, paths/modes, command/network/lifecycle behavior, preview API, one-time requirements and the complete NOT RUN live campaign.

Important limits: the real control authority/stage bridge, signed allocation and image for the additional isolated external/browser/prior-seeded harness, durable private artifact callbacks, final release image and guest boot integration are not configured. `IsolatedExternalChecks` remains a required dependency; absence throws. No generic host Playwright process fills that gap. Task 01 owns shared integration; missing live access does not prevent the delivered implementation/tests, but they are not an end-to-end runnable hosted service.

## Vercel Sandbox evaluation (official documentation, retrieved 2026-09-10 UTC)

Vercel website hosting is not D2. Vercel's Sandbox project documents Firecracker microVM isolation, making it a plausible **managed** alternative, not a Vercel Function/container substitution. [Official repository](https://github.com/vercel/sandbox).

The current firewall supports `deny-all`, including DNS, and runtime policy updates; the documented default is `allow-all`, so an adapter must explicitly set deny-all before any untrusted code. This is compatible in direction with Forge's egress requirement. [Firewall documentation](https://vercel.com/docs/sandbox/concepts/firewall).

Images support exact digest references and custom registry images. That could bind an approved offline toolchain, but it is a different identity/measurement contract than Forge's kernel/rootfs/jailer bundle and needs an architecture amendment. [Image documentation](https://vercel.com/docs/sandbox/concepts/images).

The SDK documents automatic session expiry, stop confirmation and CPU/memory observations. It also documents persistent sandboxes defaulting to automatic snapshots on stop: a disposable adapter must explicitly disable persistence and verify deletion/retention. The reviewed SDK pages do not establish Forge's required independently fenced delayed-create/destroy semantics or host-enforced per-job PID/disk limits and cleanup evidence. That is an unresolved mapping, not a claim those features cannot exist. [SDK reference](https://vercel.com/docs/sandbox/sdk-reference).

Published Hobby allowances include 5 active CPU hours/month, 420GB-hours memory, 5,000 creations, 20GB transfer and 45-minute sessions, with creation paused at exhausted quotas. Pro is metered; default iad1 rates shown are $0.128 CPU-hour and $0.0212 GB-hour, plus creation/transfer/storage charges. Account plan, remaining quota, entitlement and spend controls were not supplied or inspected; no free entitlement or spend authorization is inferred. [Pricing and quotas](https://vercel.com/docs/sandbox/pricing).

**Decision: retain dedicated Linux/KVM; do not adopt a managed adapter in this PR.** Sandbox merits a later amendment if exact image/network/resource/lease/deletion/private-preview controls are demonstrated and the account/budget is feasible. No service was created or billable call made. No architecture amendment was submitted because this implementation preserves the selected contract. Website deployment remains Task 08 and never closes D2 by itself.

## Reproduction and evidence

Stored text logs normalize terminal carriage returns/trailing whitespace; original local logs remain under `/tmp/forge-task02-*`. Final focused Python tests also cover the post-verification packager/cache and watchdog-exit refinements. Staged diff scan with `gitleaks stdin --redact` found no secrets; `git diff --cached --check` passed after log normalization. See `runner/evidence/task-02/manifest.json` for exact code/input/evidence hashes and evidence classification. Image/source hashes for a real generated execution are **null/unavailable**, because no real image/candidate ran; local code file hashes must not be mistaken for such a receipt.

```sh
# Clean reproduction after fetching this branch (Node 24 required):
npm ci
npm run verify
npm run test:db:control
npx vitest run tests/engine/task02-runtime.test.ts tests/engine/e3-runtime.test.ts tests/engine/e3-host.test.ts --maxWorkers=1
python3 -m unittest discover -s tests/runner -v
python3 runner/guest/check_database.py
```

Local dependencies were reused **read only** from Task 01's frozen `/tmp/forge-task01-clean-reproduction/node_modules` via symlink because concurrent tasks exhausted disk. No install/ci ran against that path. This is supporting workspace verification, not a clean independent install. Root lockfile stayed byte-identical. A `/tmp/forge-native-verification.lock` directory serialized later shared-resource checks; only this task's acquired lock was removed.

| Check | Result/classification |
| --- | --- |
| Initial `npm run verify` | Failed on three attributable type-only import lint errors; corrected. No test/build pass claimed for that attempt. |
| Focused runtime tests | 47 passed in the final focused run; explicit fixtures/native Unix framing only. The new file contributes 16 tests; original e3-runtime (11) and e3-host (20) remain passing. |
| Python simulations | 21 passed: launch intent before spawn, delayed launch failure/tombstones, stop-before-create, attempt adoption, expiry/epoch rejection, unsafe cleanup retention, systemd mask/kill ordering, no-NIC launch plan, hard quota argv, watchdog fencing, RPC MAC/replay, hostile paths/commands, credential separation, exact prepared cache/archive comparison and malformed cache rejection, unsafe/symlink jail ancestors, existing attempt ownership and expired RPC frames with no handler/epoch side effects. No privileged OS operations. |
| Native app DB compatibility | PASS on PostgreSQL 14.18 macOS: fresh bootstrap, SCRAM logins, app CRUD grants, denied DDL/superuser/wrong password, prior-row additive migration, DB-server restart persistence, stopped/removed temporary cluster. Not PostgreSQL18 guest proof or app-process restart. |
| Initial native app restart | Timed out because pg_ctl restart inherited a captured pipe; fixed by redirecting restart logs to the temporary log file. Cleanup ran; the successful rerun is separate evidence. |
| Full verification with Homebrew `node@24` path | PASS: lint/typecheck, 606 tests + 4 existing skips, Next.js production build. The path actually reported Node25.8.1, so this is labeled Node25 compatibility. |
| Pinned Node24.20.0 full verification | PASS: lint/typecheck, 606 tests + 4 existing skips, Next.js production build. Uses the previously checksum-verified exact archive, not the misleading Homebrew path. |
| Native control database | PASS: PostgreSQL14.18, 45 constraint/RLS assertions; temporary cluster cleaned. Control schema compatibility only. |
| Browser/live guest/native Linux checks | NOT RUN: no real guest/application endpoint. No UI change requires Forge visual screenshots; browser framing tests here do not prove generated-app usability. |

## Open inputs and acceptance

Required once: approved dedicated x86_64 Linux/KVM host and access, region/patch/operations owner, explicit applicable infrastructure/test budget, final immutable image/cache/seccomp/toolchain assets, quarantined real-host qualification, private signing/mTLS keys via secret system, fresh locked control authorization/stage bridge, separately isolated external-test environment, durable artifact sink and Task 07 registry/gateway. Do not paste credentials into the repository or report. See the deployment contract's exact configuration/installation checklist and review-before-admission procedure.

All real acceptance scenarios remain NOT RUN: signed launch/build/DB readiness; app-process restart; cancellation; expired lease; delayed create/destroy; CPU/process/memory/disk exhaustion; blocked Internet/metadata/DNS/private/control destinations; neighbor responsiveness; crash/restart cleanup. Each live row must bind exact candidate source manifest, final template, image bundle/assets, policy, lease/attempt and before/after resource evidence. **D2, D7 runtime acceptance and containment are not passed.** Public portfolio execution still depends on Tasks 02–08's real integrations and Task 09 acceptance.

## Coordinator review follow-up

Task 01 found missing jail-ancestor validation and missing guest-side expiry rejection in the initial published `31e0ee5`. Both are fixed: lstat-based protected ancestor traversal, exclusive attempt creation with durable ownership, guarded fd-relative cleanup, and authenticated frame deadline rejection before state/handler effects. Final focused verification passes 47 TypeScript tests and 21 Python simulations; live filesystem/clock behavior remains unqualified. Initial-head GitHub CI passed on Node24.20.0; final-head CI is tracked on PR #16. No new root/dependency/SQL files were changed by this follow-up.
