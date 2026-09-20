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
- NOT RUN HERE: full repository verify (coordinator owns integrated run), production PKI rotation and remote-host mTLS deployment, native guest PostgreSQL, power-loss durability, isolated abuse/capacity.

## Resume

Run `npx vitest run tests/engine/e3-runtime.test.ts tests/engine/e3-collector.test.ts tests/engine/e3-release.test.ts`, `npx tsc -p tsconfig.engine.json` and targeted ESLint. Candidate README contains install/build commands. For scaffold-only browser reproduction, start its production server on127.0.0.1:3103, set FORGE_CANDIDATE_CHROMIUM to a local approved Chromium and run `node runner/candidate-browser-check.mjs`; no arbitrary app URL is accepted. Stop listener afterward.

Keep execution off. Remove writer.lock only after fencing old broker process/host; reconcile durable intents and inventory first. Quarantine retains resources and requires an operator alert until destruction+tombstone evidence confirms cleanup. Expired renewal cannot revive stopped environments. This track closes none of D1–D8.

## Follow-on host lifecycle implementation

`runner/host/` now provides a fsynced singleton host inventory, permanent operation/environment tombstones, independent lease-watchdog scheduler, durable epoch/clock fencing and bounded revoke→stop→wipe→observe cleanup through the narrow LinuxExecutor interface. OS calls run outside inventory transactions. Both launch and cleanup calls retain singleton ownership until they actually settle; hanging calls are not duplicated. Reservations survive uncertainty and restart. Cleanup cannot release from a pre-launch absence observation that arrives after a delayed launch settles; it requires a fresh pass and post-invocation observation timestamps.

Read-only Linux preflight validates KVM/cgroup/BPF facts and root-owned immutable operator-pinned assets using streaming no-follow hashes. The systemd/network/cgroup artifacts are uninstalled review candidates, not an enabled supervisor. Their syscall adapters, real guest lifecycle, guest process limits and actual namespace/cgroup/systemd compatibility still require D2/D7. Successful preflight never enables execution. See `runner/host/README.md` for integration and recovery requirements.

PASS:20 additional explicit OS-fixture tests (`tests/engine/e3-host.test.ts`, machine evidence `runner/host/evidence-tests.json`), strict engine typecheck and targeted lint. They add controller evidence only; real isolation/watchdog acceptance remains blocked.

Coordinator-provided additional compatibility evidence: official PostgreSQL18.6 source was checksum-verified and built privately in `/tmp` without global installation; the real platform-authored template bootstrap/default privileges, parser-reviewed fresh/prior migrations, restricted-role denials and PostgreSQL restart persistence passed. Root evidence is `docs/reports/evidence/e2-e5/postgres18-source.json`, `postgres18-candidate.json` and `postgres18-tests.log`. This is local platform-fixture PostgreSQL compatibility. Generated app-process/UI persistence, guest SCRAM provisioner and isolated PostgreSQL remain unverified.


## Real local mTLS transport verification

PASS:12 integration tests in `tests/engine/e3-transport.test.ts` use real loopback TLS1.3 sockets and temporary OpenSSL3.6.3-generated Ed25519 CA/server/worker certificates. The actual broker HTTP adapter and RunnerClient exchange signed descriptors and nonce-bound signed responses; the authority and host remain explicit fixtures. Machine-readable evidence: `runner/evidence/transport-tests.json`. Every listener/socket is closed and the temporary certificate/key directory is removed. No external network, generated code or microVM is involved.

Coverage: authorized idempotent roundtrip; absent/untrusted client certificate; CA-trusted worker outside the certificate allowlist; hostname and certificate-pin mismatch; descriptor/response/signing-key/nonce tampering; request and response caps; malformed replies; redirect refusal; continuous-response trickle under an absolute deadline; transport cancellation; inbound-body trickle deadline; and rejection of deadline configurations that remove or broaden production bounds. Cancellation here stops the HTTP client's wait, not a durable job or guest.

The real test found and reproduced a certificate-pinning bypass: Node's shared HTTPS agent reused an existing authenticated connection for a new client with a different expected pin, bypassing that client's checkServerIdentity callback. The transport now snapshots its TLS configuration and uses a one-shot agent per request, so an unrelated client's socket or TLS session cannot satisfy the pin. The failing scenario is a passing regression test after the fix. New optional deadlines may only shorten the existing250-second client and10-second body limits. The handler also avoids writing replies to already-destroyed connections.

Strict engine typecheck and targeted ESLint passed. This closes the previously unrun **local transport** checks, not production certificate distribution/rotation, D1 authentication, host isolation, guest cleanup or real A09/A10/A13 acceptance. Those deployment gates remain unchanged.

## Clean exported platform scaffold compatibility

PASS: the actual20-file platform-authored candidate at33b521e passed a clean source export and build using exactNode24.20.0/npm11.19.0 on macOS arm64. `tests/harness/candidate-export.ts` pins each reviewed file's SHA256, creates the E2 immutable template catalog, persists and reopens its synthetic local object backend, invokes the concrete source-secret scanner and source-export API, rereads the stored archive, and checks its exact file set, bytes and canonical regular-file ZIP representation. Changed/missing/extra files, oversized entries and link/noncanonical metadata are rejected before extraction. No provider or caller-supplied source is accepted for host execution. Dependency implementation came from coordinated integration baseline b981ec6.

The new empty temporary source directory received only validated files using exclusive writes. `npm ci --offline --ignore-scripts --no-audit --no-fund` installed400 packages from the existing cache in about5seconds; lint, clean typecheck, the protected environment test and Next production webpack build passed. Build output explicitly reported no existing build cache. The run took about23seconds. No template source modification was needed. An initial harness invocation failed because npm rejects using the same `/dev/null` file for both global and user config; separate isolated configuration paths fixed that harness setup before the recorded passing run.

Machine evidence `runner/evidence/candidate/export.json` records all exact commands, exit codes, durations, bounded output, hashes and deleted temporary paths. Source and object directories were removed after execution; no listener was started. Child commands have finite deadlines and process-group cleanup, and receive a minimal environment without ambient provider/database credentials or Node options. Installs have no network fallback and no lifecycle scripts. This is **platform scaffold compatibility with fixture artifact storage**, not A04 generated-app clean export, real image execution, database/UI persistence, cloud durability or D7 release approval. ESLint9.35 deprecation and the existing dependency/license/image review gates remain unresolved.

Reproduce after reviewing the pinned source: `FORGE_RUN_CANDIDATE_EXPORT=1 FORGE_CANDIDATE_NODE24=/path/to/reviewed/node24.20.0/bin/node npx vitest run tests/engine/e3-candidate-export.test.ts`. Without the explicit opt-in, only inert export validation runs and the host build test is skipped. The exact Node archive used here remains under `/tmp/forge-e3-node24.UZHrx7`; its previously verified official checksum is recorded in `runner/evidence/candidate/node24.json`. No global toolchain installation occurred. A missing cache entry or changed source pin causes failure rather than a network install or unreviewed source execution.
