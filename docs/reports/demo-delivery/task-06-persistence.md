# Task 06 — Persistence, Vercel control integration and backups

Date: 2026-09-10 UTC. Status: **independent adapters and local native tests implemented; hosted acceptance and shared adoption wiring blocked**. No service provisioned, infrastructure purchased, paid model request issued or Vercel deployment written. BYOK, Vercel website hosting, no domain purchase and the required Next.js + strict TypeScript + PostgreSQL generated stack are preserved. A real generated portfolio remains Task 08's separately evidenced deliverable.

## Provenance and coordination

Branch `codex/task-06-persistence`, isolated worktree `/tmp/forge-task06-persistence`, exact canonical parent `881e9ac2b11f8f168cb7849b77c4ee7439e55458`. Verified origin is `https://github.com/shellcat-com/forge-ai.git`; this task's draft PR targets `codex/demo-delivery-baseline` and depends on Task 01's PR #8. Read the reconciled AGENTS.md, RFC 0001, E0/E1/E2–E5 reports, engine-decisions and current coordination board (`e533afe` publication metadata). The original shared checkout was investigated read-only and preserved.

Task 01 approved the optional PostgreSQL encrypted object implementation/proposal and owns reserved migration 0006, root manifests, shared schema and control wiring. Task 04's credential AES-GCM envelope/rotation/CAS remains separate; both use versioned 32-byte server key resolution without sharing encryption domains or artifact access. Task 05 preserves current `ControlDatabase.resource/session` authorization and transaction-local tenant scope. Task 08 owns all external deployment writes and reports the existing Vercel team has Hobby billing. This task made no account-level write or live storage probe.

## Implemented scope

| Area | Result |
| --- | --- |
| `engine/artifacts/encrypted-backend.ts` | AES-256-GCM private versioned envelope, exact key/version/tenant/job AAD, strict size/key/version parsing, safe read/write errors, defensive byte copies, server environment key references and retained old-key resolution. No default key or service. |
| `engine/artifacts/postgres-backend.ts` | Durable PostgreSQL ciphertext transport with bounded pools/transactions, explicit restricted identities, privilege/schema check and broken-client disposal; exact-version reads; reference-safe retirement, bounded sweeps, delayed purge and permanent tombstones. |
| `engine/artifacts/postgres-schema.proposal.sql` | Additive **proposal only**, separate `forge_objects`; explicit retention policy, RLS, reader/writer/maintenance/guard roles, temporary ownership-transfer grants, per-key transaction locking and guarded lifecycle functions. Existing migrations and application schema untouched. |
| Adoption port | `lockObjectForAdoption(c, ref)` runs on the existing leased worker transaction before its artifact INSERT. Same database/transaction lock protects adoption against orphan cleanup. Task 01 has not yet installed it in the source bridge; live integration remains unavailable. |
| `engine/hosting/persistence-config.ts` | Exact HTTPS/same-origin API validation, server-only secret checks, fixed approved PostgreSQL host with certificate verification, conservative Function/SSE limits and explicit missing worker/storage/verification blockers. Pure preflight, not wired deployment or dispatch authority. |
| Operational runbooks | [Local/self-hosted setup and recovery](../../operations/persistence-local.md); [Vercel handler assessment and hosted handoff](../../operations/persistence-vercel.md). Distinguish website, durable workers, generated runtime, application/control schemas and key/storage/backup requirements. |

Raw object transport is trusted internal infrastructure: key-derived RLS context does not authenticate a caller. Tests exercise fresh E1 session/resource authorization, another tenant's denial and membership-removal denial before ArtifactStore reads. Source reads also reject wrong project/key/version/hash. Available source objects do not grant execution or promotion rights.

Referenced objects survive while their project is live. Retirement requires expired orphan grace or project deletion past retention with no unfinished jobs; it prevents further reads/adoption. Purge waits through the original/current recovery window and rechecks authoritative references. It removes ciphertext but preserves immutable key/version tombstones. No event, audit, billing, membership or source-metadata append-only protection is removed. Their physical retention remains shared work.

## Reproduction and actual results

Use Node 24.20.0, npm 11 and installed native PostgreSQL tools. The native fixture creates its own private socket cluster and reads no `.env.local` or hosted database credentials. These commands do not call providers or provision services:

```sh
npm ci --ignore-scripts
npx vitest run tests/engine/persistence.native.test.ts tests/engine/encrypted-objects.test.ts tests/engine/persistence-config.test.ts tests/engine/control.native.test.ts --no-file-parallelism
npm run test:db:control
npm run verify
```

Actual local dependency installation completed with zero audit vulnerabilities but inherited Better Auth peer/deprecation warnings. It initially used Node 25.8.1 and warned about the root Node-24 engine constraint; all recorded verification thereafter used the existing pinned Node 24.20.0 binary. Due shared disk pressure, this task removed only its own 839-MB dependency installation and used a **read-only symlink** to Task 01's frozen, exact-lock dependencies for supporting checks. This is not an isolated clean dependency/build reproduction. No shared dependencies, lockfile or other task files were changed; the symlink is not committed.

| Check | Observed result / evidence |
| --- | --- |
| Focused encryption/config/native tests | 9 passed; exact-version/tamper/cross-scope/key rotation, HTTPS/DSN and unavailable configuration tests. [Targeted results](../evidence/task-06/targeted-tests.json). |
| Sequential owned + E1 native tests | **54 passed, zero failed/skipped**, including all 45 existing E1 job/idempotency/quota/lease/restart/SSE tests. [Native JSON](../evidence/task-06/native-tests.json), [log](../evidence/task-06/native-tests.log). |
| Final scoped checks | PASS: strict engine TypeScript and scoped ESLint; final 9-test repeat passed after role-grant review. |
| E0 native constraints | PASS: 45 accepted migration/constraint/RLS assertions on disposable PostgreSQL 14.18; [log](../evidence/task-06/e0-native.log). |
| Native schema/role migration | Accepted 0001–0003 plus proposal applied on disposable PostgreSQL 14.18. Object proposal applied using non-SUPERUSER CREATEROLE migrator with inherited control ownership; rejected privileged runtime login. No managed Neon migration performed. |
| Concurrent cleanup tests | Separate actual clients observed waiting on PostgreSQL advisory locks. E1 reference INSERT commits in the adoption transaction; competing retirement retains it. A retirement holding the lock makes later adoption reject; purge waits and honors retention. Tombstones reject delayed create after ciphertext purge. |
| Process persistence | Real writer child exits; two fresh reader children retrieve exact hash/length. No warm object Map or temporary source file supplies data. No PostgreSQL server-crash/power-loss claim. |
| `npm run verify` | **FAILED due shared disk ENOSPC** during four native suite `initdb` setups. Lint and TypeScript passed; 570 tests passed, 33 skipped/unexecuted; four suite setups failed. Build was not reached. [Full attempt log](../evidence/task-06/verify.log). This failure is not relabeled success by the sequential run. |
| Browser/hosted acceptance | No UI/routes were edited. Native authenticated HTTP/SSE checks ran in the E1 suite; no new browser or deployed API/storage flow was exercised. Live browser/deployment acceptance belongs to Tasks 01/05/08. |

Initial focused testing found and corrected a Buffer-slice alias: clearing encryption scratch could mutate the caller's hash input. Independent copies now preserve source and key buffers. No evidence counts those earlier failed checks as passes.

## Recovery measurements and limits

[Machine-readable recovery evidence](../evidence/task-06/recovery.json) records the local/native/synthetic origin and `hostedBackupAccepted:false`. A full custom-format pg_dump includes both control and encrypted object schemas. pg_restore uses `--exit-on-error --single-transaction` into a **separate database in the same disposable local cluster**. Tests do not overwrite the source. Dump files and cluster are removed after shutdown; cleanup is confirmed in the evidence.

The final focused run restored two actual E1 synthetic job records, decrypted all four available encrypted versions and verified all three live control references backed by this adapter. Fixture inline plan payloads are preserved separately by the full dump, not miscounted as encrypted object references. One intentionally committed post-backup object was absent after restore: **expected loss 1, observed loss 1**. Local restore plus verification took **148 ms**; backup age at simulated loss was **88 ms**. Retention aging uses migration-owner-only synthetic timestamp changes.

These are tiny local timing analogues, not deployed RTO/RPO. They exclude failure detection, operator response, provisioning, network/KMS repair, WAL/PITR and a separate failure domain. No scheduled, off-site, deployed Neon or production backup acceptance is claimed. The primary server remains running during the separate-target drill; process restart evidence concerns independent artifact clients. Retired versions remain unreadable after restore; old key IDs must remain recoverable and an authorized recovery must choose an available-version backup. Ciphertext retention alone does not implement deleted-project resurrection.

## Open integration and access blockers

1. Task 01 must publish migration 0006 and wire the same-worker-transaction adoption port everywhere a durable reference is inserted; apply the reviewed live identity/accounting/source composition. No fixture-origin guard was widened here.
2. Neon target/region, actual restricted-role capability, pool/network envelope, object backend capacity/retention/residency and hosted credentials have not been verified. PostgreSQL encrypted objects are an optional self-hosted adapter, not an implicitly selected hosted storage service.
3. No persistent worker/maintenance host, durable workflow service, managed KMS/key escrow, off-site backup/WAL schedule, deletion/revocation recovery ledger or deployed restore operator is configured. Old encryption-key retention and disaster access require explicit operational acceptance.
4. Task 08 must supply exact Vercel target/origin and test same-origin handlers, HTTPS and missing-service screens. Bounded Node request handlers are feasible; current loopback servers/infinite workers are not deployed Function entry points. SSE needs bounded rotation plus a distributed per-session cap, and large exports need a tested download path.
5. No live provider spending envelope or real generated portfolio evidence is supplied by this task. No new subscription/infrastructure purchase or billable API run is authorized by BYOK.
6. Clean combined verification and CI remain separate gates from the documented local supporting run. CI status belongs to the draft PR's checks; local full verification is explicitly resource-blocked.

Only owned adapters/configuration/tests/docs/evidence are included. Root manifests, accepted migration bytes, shared API/worker/identity integration, existing app UI and generated-app runtime remain preserved. Final commit/PR and CI outcome are returned with the task handoff; no merge or force-push is performed.
