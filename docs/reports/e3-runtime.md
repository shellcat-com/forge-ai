# E3 runtime implementation and exact gates

Status: **independent implementation delivered; E3 exit blocked by D2/D7**. Baseline b0031b6. E1 control/migrations/shared contracts/root manifests untouched. No infrastructure provisioned and no provider output executed.

## Implemented APIs

- `runner/auth.ts`: Ed25519 descriptor/hash/expiry verification, certificate allowlist and response signature binding exact request nonce. No secret defaults.
- `SandboxBroker.dispatch(peer, request)`: create/status/renew/runCheck/collect/destroy only. Mandatory `authority` callback supplies freshly locked E1 review/approval/cancellation/revocation/epoch context. Exact template policy, approved manifest input, ordered checks and passing predecessors are enforced.
- `FileJournal`: fsynced atomic local checkpoints, durable intent before host work, bounded reads and fenced completion. Remote host calls execute outside the global writer lock. Authority reads have a five-second bound. Concurrent writers fail unavailable. Replayed ambiguous operations never blindly repeat. This is broker-local state, not a second E1 control service.
- Quarantined/uncertain resources retain capacity. Destruction requires both authenticated `resourcesDestroyed` and `fencePersisted`: the host must durably tombstone delayed create/renew, including across restart. The explicit fixture host tests this contract. Collection digest is persisted for idempotent retry. Broker sweeps supplement the mandatory independent host watchdog.
- `runner/http.ts` and `RunnerClient`: mTLS-only HTTP adapter, pinned certificate/client keys, fixed endpoint, bounded bodies, redacted errors, ten-second inbound body deadline and 250-second absolute client deadline. No listener enabled by import. Deployment HTTPS must use requestCert/rejectUnauthorized/worker CA/TLS1.3.
- `collectBuildOutput`: framed regular files only, approved output roots, actual-byte caps/hashes, path/alias/link/device/archive rejection, quarantine sink and no host extraction. Sanitized logs strip controls before known-secret redaction, including split/truncated canaries.
- `applyApprovedMigrations`: guest database identity, approved migration order/content/hash, strict parser canonical statements and bounded transactional RPC. Inject `engine/validation/migrations.ts:validateMigrationSql`; never inject a control-database connection.
- `compileGuestConfiguration`: strict Linux/KVM/jailer/seccomp/cgroup/network/watchdog configuration compiler. `UnavailableFirecrackerDriver` always refuses execution; booleans cannot enable a real executor.

## D7 candidate proposal

The actual Next App Router scaffold includes layout, theme-scoped responsive CSS, reusable component, process health route, protected environment loader/test, five-connection pg pool, strict configs, pinned lock, placeholder env, database bootstrap/HBA/config and README. Candidate: Next16.3.4 / React19.3.0 / Node24.20.0 / PostgreSQL18.6. npm metadata was inspected; Next requires Node>=20.9. Primary references: [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Node releases](https://github.com/nodejs/node/releases), [PostgreSQL18](https://www.postgresql.org/docs/18/). None closes D7.

Lockfile259094 bytes is below E0's262144-byte text cap. Installation used --ignore-scripts --no-audit --no-fund. No postinstall ran. npm reported ESLint9.35 deprecated; dependency/license review is still required. No image/cache/release evidence hashes were fabricated.

`validateTemplateRelease` requires lock/release identity, exact direct dependencies and npm integrity. Every authenticated, non-revoked evidence report binds template/image/lock/policy/check kind, expiry and24-hour freshness. Benchmark evidence requires exact operator-selected corpus digest, >=30 attempts and >=90% success. The evidence store must authenticate provenance; JSON labels alone are insufficient. Owner-approved releases, template paths, dependencies/assets and real evidence remain absent.

## D2 proposal and absent production components

Dedicated patched Linux/KVM host, Firecracker+jailer, immutable root-owned images/cache, per-environment unprivileged UID/GID, cgroupv2/seccomp and default-deny IPv4/IPv6/DNS/metadata/lateral networking. Reserve host overhead before admitting guests; limits remain unmeasured. Required access: owner-approved host and controlled identities/network. Cost drivers: dedicated CPU/RAM, idle headroom, disk/IOPS, artifacts and patch/operations ownership. No vendor purchase selected.

**Still absent:** production Firecracker process supervisor/image builder, guest agent/framing transport, host network/cgroup/disk enforcement, actual OS integration/enforcement for the implemented watchdog and tombstones, host inventory/quarantine, trusted isolated browser harness, guest PostgreSQL credential provisioning/destruction, real artifact transfer and certificate/key deployment. The compiler/protocol are not real isolation enforcement. These depend on D2 access and D7 image/toolchain review. No ordinary container/host fallback exists.

Before execution, run real metadata/private-network/DNS/IPv6 denial, path/link/escape, CPU/OOM/disk/process abuse, hung-command, neighbor responsiveness, crash/watchdog/tombstone, revocation and inventory-cleanup suites. Managed isolation requires an RFC amendment.

## Evidence and acceptance

- PASS:42 explicit-fixture/unit tests: signature/peer/expiry, durable replay, policy/input/order, quotas, uncertain create, stale epoch/cancellation/late result, tombstones, idempotent collection, collector threats and canaries. JSON: `runner/evidence/unit-tests.json`.
- PASS: engine strict TypeScript and targeted ESLint.
- PASS: candidate lint/typecheck, one protected environment test and Next16.3.4 webpack production build on **macOS/Node25.8.1 and exact Node24.20.0**. The latter official archive SHA256 was checked before running; evidence is `runner/evidence/candidate/node24.json`. Compatibility only; PostgreSQL not connected and network isolation not enforced.
- Candidate browser JSON and six screenshots: `runner/evidence/candidate/`. First pass found390px/200%-zoom overflow; CSS now wraps long words and final run passes all six cases plus process health. These are real local scaffold browser checks, not generated-app/microVM acceptance.
- BLOCKED: real contributions to A01/A02/A04/A09/A10/A12/A13/A15/A18/A19/A22. Unit fixtures do not pass RFC acceptance. Remaining matrix belongs to coordinator integration.
- NOT RUN HERE: full repository verify (coordinator owns integrated run), actual mTLS network/trickle campaign, native guest PostgreSQL, power-loss durability, isolated abuse/capacity.

## Resume

Run `npx vitest run tests/engine/e3-runtime.test.ts tests/engine/e3-collector.test.ts tests/engine/e3-release.test.ts`, `npx tsc -p tsconfig.engine.json` and targeted ESLint. Candidate README contains install/build commands. For scaffold-only browser reproduction, start its production server on127.0.0.1:3103, set FORGE_CANDIDATE_CHROMIUM to a local approved Chromium and run `node runner/candidate-browser-check.mjs`; no arbitrary app URL is accepted. Stop listener afterward.

Keep execution off. Remove writer.lock only after fencing old broker process/host; reconcile durable intents and inventory first. Quarantine retains resources and requires an operator alert until destruction+tombstone evidence confirms cleanup. Expired renewal cannot revive stopped environments. This track closes none of D1–D8.

## Follow-on host lifecycle implementation

`runner/host/` now provides a fsynced singleton host inventory, permanent operation/environment tombstones, independent lease-watchdog scheduler, durable epoch/clock fencing and bounded revoke→stop→wipe→observe cleanup through the narrow LinuxExecutor interface. OS calls run outside inventory transactions. Both launch and cleanup calls retain singleton ownership until they actually settle; hanging calls are not duplicated. Reservations survive uncertainty and restart. Cleanup cannot release from a pre-launch absence observation that arrives after a delayed launch settles; it requires a fresh pass and post-invocation observation timestamps.

Read-only Linux preflight validates KVM/cgroup/BPF facts and root-owned immutable operator-pinned assets using streaming no-follow hashes. The systemd/network/cgroup artifacts are uninstalled review candidates, not an enabled supervisor. Their syscall adapters, real guest lifecycle, guest process limits and actual namespace/cgroup/systemd compatibility still require D2/D7. Successful preflight never enables execution. See `runner/host/README.md` for integration and recovery requirements.

PASS:20 additional explicit OS-fixture tests (`tests/engine/e3-host.test.ts`, machine evidence `runner/host/evidence-tests.json`), strict engine typecheck and targeted lint. They add controller evidence only; real isolation/watchdog acceptance remains blocked.

Coordinator-provided additional compatibility evidence: official PostgreSQL18.6 source was checksum-verified and built privately in `/tmp` without global installation; the real platform-authored template bootstrap/default privileges, parser-reviewed fresh/prior migrations, restricted-role denials and PostgreSQL restart persistence passed. Root evidence is `docs/reports/evidence/e2-e5/postgres18-source.json`, `postgres18-candidate.json` and `postgres18-tests.log`. This is local platform-fixture PostgreSQL compatibility. Generated app-process/UI persistence, guest SCRAM provisioner and isolated PostgreSQL remain unverified.
