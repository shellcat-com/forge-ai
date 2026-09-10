# Local and self-hosted persistence

This is the Task 06 adapter runbook, not evidence of a deployed service. Forge's required generated stack remains Next.js, strict TypeScript and app-local PostgreSQL. The application database (`drizzle/`), RFC control database (`forge_control`), encrypted source objects (`forge_objects`) and generated-app databases have distinct authority. Never copy control, object, provider, identity or deployment credentials into a generated app, image, export or preview.

The existing approved hosted database direction is Neon. `postgres-encrypted-v1` is an optional implementation on existing PostgreSQL capacity, not a selected hosted object service. No AWS, Supabase, KMS purchase, storage purchase or new subscription is introduced. Hosted runtime/admission remains disabled pending integration and acceptance.

## Reproduce without external access

Use the root lockfile with Node 24, npm 11 and installed native PostgreSQL tools (`postgres`, `initdb`, `pg_ctl`, `pg_dump`, `pg_restore`). Do not point these tests at an existing database. The harness creates a private Unix socket cluster, applies accepted control migrations 0001–0003 plus the explicitly named SQL proposal, and destroys its disposable data.

```sh
npm ci --ignore-scripts
npx vitest run tests/engine/encrypted-objects.test.ts tests/engine/persistence-config.test.ts tests/engine/persistence.native.test.ts tests/engine/control.native.test.ts --no-file-parallelism
npm run test:db:control
npm run verify
```

No `.env.local`, provider key, hosted database URL or paid API is used. The native test uses random synthetic encryption keys passed to short-lived child processes through stdin; only digests and opaque artifact references are emitted. Retention time advances through migration-owner-only timestamp edits, explicitly a simulation. Role/RLS, transactions, process exit, encryption, pg_dump and pg_restore operations are real local operations.

The existing `npm run setup:local`, application `npm run db:migrate`, and local Docker worker are a separate preserved development path. Do not apply engine migrations with the application migration runner, replace its schema, or claim Docker is the RFC's isolated runner.

## Operator setup after Task 01 accepts the schema

`engine/artifacts/postgres-schema.proposal.sql` is **not an installed migration**. Task 01 owns publishing reserved engine migration 0006, checksums/order and adoption wiring. Do not run the proposal against a live database. Native tests deliberately apply it to disposable data only.

1. Use a migration owner that owns the control schema, can create the dedicated roles, and can temporarily transfer function ownership. The test exercises a non-superuser CREATEROLE identity with inherited control ownership. Managed Neon role capabilities have not been verified; lacking them blocks deployment, not an excuse to use an owner login at runtime. Unsafe existing role attributes, inheritance, ownership or ACLs cause rejection.
2. Keep `forge_objects` in the **same PostgreSQL database as `forge_control`**. Transaction advisory locks are database-local. Another database, connection or transaction cannot protect the E1 artifact INSERT.
3. Bind separate generated LOGIN secrets to exactly one NOLOGIN object role: reader, writer or maintenance. None gets schema ownership, SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, replication, control authority or the internal guard role. The guard receives only enumerated grants and fixed-search-path function ownership. Runtime logins cannot change policy, update ciphertext or delete tombstones. Keep the three E1 API/worker/maintenance logins separate too.
4. Explicitly configure `forge_objects.policy`: orphan grace (minimum one hour), project-deletion grace (minimum one day), and recovery window (minimum one day). These bounds are implementation constraints, **not a selected production retention policy**. Capacity, residency, operator and retention approval remain required. No policy row is inserted by schema setup, so writes fail closed until configured.
5. Select a stable key ID such as `artifact-key-v1` and resolve it using the server-only `EnvironmentObjectKeys` mapping to a `FORGE_OBJECT_KEY_*` secret. Provide an independently generated 32-byte secret through an approved injection mechanism. There is no default or automatic key creation. Do not print key material, put it in shell history, or pass it through `NEXT_PUBLIC_*`/`VITE_*`. Host secret-at-rest protection and recovery escrow are operational requirements; this adapter does not claim to encrypt an environment file or implement a managed KMS.
6. Instantiate `PostgresCiphertextTransport` with a bounded pool and the corresponding restricted role, call `check()`, then wrap it in `EncryptedObjectBackend` and `ArtifactStore`. No listener, migration, worker or live admission starts when these modules are imported.
7. Task 01 must call `lockObjectForAdoption(controlTransaction, ref)` inside the **same current leased worker transaction** as the artifact INSERT and state/event commit. The lock lasts through commit. Complete scope/lease validation and byte/hash verification first. Every durable-reference adoption path must use this port; there is no safe separate-connection shortcut. Live source integration remains blocked until this is wired and tested.

`PostgresCiphertextTransport` is a trusted service port. It derives RLS context from a server object key; that is not authentication. Public reads must first use `ControlDatabase.resource` with a current opaque session, load a DB-owned artifact reference, and pass the authorized scope to `ArtifactStore`. Never expose arbitrary keys, SQL, object URLs or the raw transport to callers. The native test exercises valid-session reads, another tenant's denial and removal of membership.

## Version integrity and cleanup

Each create assigns one UUID version and one permanently unique quarantine key. PostgreSQL rejects duplicates even after purge. AES-256-GCM authenticates a domain tag, full tenant/project/job/object key, immutable version and encryption-key ID. `ArtifactStore` additionally verifies the DB reference's exact byte length and SHA-256 on reads and before adoption. Object availability grants no source promotion or execution authority.

Rotation changes the active encryption-key ID for new writes. Existing versions keep their original key ID; old decryption keys must remain recoverable while any object or retained backup needs them. Deleting a provider credential uses Task 04's independent credential CAS/tombstone/encryption domain. Provider credentials never become source artifacts. Artifact key rotation and provider credential rotation are distinct operations.

External maintenance calls `sweep(cursor)` in bounded pages of 100 and persists the returned cursor. Start a fresh pass from `''` after `next=null`; retry failed pages in the next pass. Multiple processes are safe under the per-key transaction lock. No process-local timer or filesystem is the durable schedule. Without a selected external maintenance process, automatic cleanup is unavailable.

Orphans cannot retire before their grace. Any referenced object is retained while its project is active. Referenced retirement requires project deletion past grace and no unfinished jobs. Retirement immediately prevents normal reads/adoption while retaining ciphertext through the recorded recovery deadline. Purge rechecks references and current recovery policy; increasing recovery retention extends protection, and decreasing it cannot shorten a recorded deadline. It erases only ciphertext and retains a permanent key/version tombstone. Failed or uncertain operations retain their durable state for retry. This does not physically purge E1 append-only audit, accounting, events, source metadata or identity records; their reviewed retention mechanism remains Task 01 work.

## Backup and separate-target restore

The PostgreSQL object option places encrypted bytes and control references in one MVCC database dump, avoiding cross-service snapshot skew. Take an authenticated, encrypted off-host backup of the entire control database (both schemas), role/grant setup, migration digests and external key-version inventory. Keep decryption keys in a separately controlled recovery system, never in the dump. A local pg_dump file is not an off-site backup. No backup scheduler, WAL archive, hosted PITR policy or managed key recovery has been configured here.

Restore into a **new target**, with admission/worker/preview disabled and no public routing. Authenticate and verify backup inventory/digests before SQL execution; restore the reviewed roles and full dump transactionally with `pg_restore --exit-on-error --single-transaction`. A dump without `forge_objects` is incomplete for this backend. Verify every live control reference against the exact decrypted version/bytes/digest, then recheck restricted roles, current membership, replay cursors, job state, leases and unresolved charges before any dispatch.

Objects already retired at the backup point remain unreadable after restore. Deleted projects are not automatically reactivated. A pre-deletion backup contains its own encrypted bytes, so later source-database purge cannot remove those backup bytes, but the original key version is still required. Restoring an old backup must also replay any separately retained deletion/revocation ledger before routing or worker enablement; otherwise it could resurrect access. Such a ledger/PITR service is not configured and remains hosted acceptance work.

There is no user or maintenance API to reactivate a retired version. To recover an authorized still-live project, select a backup where its exact referenced versions were available, restore that backup and the matching old key IDs into the isolated target, and verify the complete reference inventory. If the only retained backup has retired/purged versions, stop with an incomplete recovery result. Do not flip states or invent replacement versions. A separately reviewed operator recovery/import workflow would be needed; retaining ciphertext by itself does not prove that workflow or a recovery guarantee.

The native drill restores two E1 synthetic jobs, all available encrypted object versions, and all live references backed by this adapter. It deliberately loses one post-backup object. It uses separate databases in one disposable local cluster, fresh writer/reader processes and real PostgreSQL backup/restore. It does **not** test an independent failure domain, encrypted off-site backup transport, WAL replay, a PostgreSQL server crash, power loss, managed Neon restore, KMS recovery or deployed backup acceptance. Report measured local restore duration and backup age with these exclusions; do not present them as deployed RTO/RPO.
