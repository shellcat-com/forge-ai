# E5 independent local recovery drill

Status: **local candidate drill passed; E5 milestone and live recovery acceptance remain blocked.** This exercises platform-authored PostgreSQL18.6 fixture data and the local immutable artifact backend. It does not restore the E1 control schema, a production service or a generated application. No infrastructure was provisioned and no generated source was executed.

## Implementation and provenance

`tests/harness/candidate-recovery.ts` requires explicit `FORGE_RUN_CANDIDATE_RECOVERY=1` and an operator-selected local PostgreSQL bin directory. The run verifies exact18.6 versions of postgres, pg_dump and pg_restore. The source archive was previously checked against the official SHA256 and compiled locally with ICU/readline disabled; see `evidence/e2-e5/postgres18-source.json` and `postgres18-candidate.json`. Neither the local binaries nor this configuration are an approved guest image.

The source cluster uses a private0700 directory and Unix socket with TCP disabled. It applies the actual SHA256-pinned template bootstrap and parser-approved, platform-authored task/priority migrations. Two synthetic rows are committed before backup. The reviewed20-file scaffold is persisted through the E2 immutable artifact store, with its StoredSource metadata recorded in a dedicated `fixture_recovery` table. This table deliberately has fixture provenance and does not replace any E1 schema or control service.

A PostgreSQL custom-format dump and21 immutable versions (20 source blobs plus source manifest) form the backup. A final inventory records every file size and hash. Its digest is retained outside the backup and checked before restore, along with file caps, exact inventory and rejection of links/non-regular files. The original artifact directory is deleted before restoration. A fresh target cluster receives the reviewed role bootstrap and a single-transaction, exit-on-error pg_restore. Copied artifact bytes preserve immutable version headers. After target stop/start, restored database metadata resolves all source blobs through ArtifactStore and validateStoredSource, with exact source-manifest and template digest checks.

The run confirms the two original rows and restricted NOLOGIN/non-superuser role flags. It also observes the loss of exactly one deliberately committed post-backup row. This is an operational fixture drill, not the product's source-restore action: RFC0001 keeps alpha preview data disposable and defers production data-preserving upgrades/backups.

## Measured evidence

Evidence: `../../runner/evidence/candidate/recovery.json`, recorded2026-09-10T02:02:22.081Z on macOS26.3.1, arm64 Mac15,12,16GiB RAM,8logical CPUs. Other coordinator work was active; this is one tiny local sample using the existing OS/filesystem caches.

| Measure | Recorded result | Scope |
| --- | ---: | --- |
| Backup payload | 284759bytes | One database dump plus21 artifact versions |
| Backup creation and validation | 36ms | pg_dump, local artifact copy, inventory/hash validation |
| Restore and restart | 831ms | Fresh target initialization through restarted DB/source integrity verification |
| Backup age at simulated loss | 155ms | Backup-start-to-source-stop interval; conservative age bound for this controlled snapshot |
| Rows before simulated loss | 3 | Two pre-backup rows and one deliberate later commit |
| Rows recovered / deliberately lost | 2 / 1 | Exact expected states checked after restart |
| Artifact versions resolved | 21 | Original object directory removed before recovery |

The831ms duration is a **local RTO analogue**, measured from confirmed source shutdown through successful target verification. It excludes detection, operator response, infrastructure/KMS/network repair and subsequent drill cleanup. The155ms interval is a **local recovery-point age bound**, not a scheduled production RPO. There is no WAL/PITR or off-site backup in this drill. These numbers cannot establish RFC§14's control-DB RPO≤15minutes or RTO≤4hours, A18 recovery, A20 load/fault acceptance or A22 live-provider benchmark acceptance.

## Faults and checks

PASS: corrupted database dump, corrupted artifact, missing artifact and changed backup manifest each failed validation before pg_restore. Additional inert tests reject unexpected inventory and symlink entries. The good backup is revalidated after fault injection before any restore. No bad backup was passed to a SQL executor.

PASS: two targeted tests with the opt-in enabled, engine strict TypeScript and scoped ESLint. Without opt-in, the inert validation test passes and the real local drill is skipped. The existing ancestor Expo tsconfig warning was emitted by Vitest; it did not affect these results. Full integrated verification remains coordinator-owned.

Every subprocess has a25second timeout and bounded output. The command environment excludes ambient provider/database credentials and uses trusted, socket-only administration; this is not a credential/authentication test. Cleanup checks pg_ctl status, stops active clusters, and removes the private root only after shutdown confirmation. A status3 evidence entry means a source cluster was already stopped. Unconfirmed shutdown preserves files and raises an error instead of claiming cleanup. The passing run stopped both clusters and removed the recorded root; no listener or backup remains.

## Reproduce and remaining gates

Run from the integrated repository:

```sh
FORGE_RUN_CANDIDATE_RECOVERY=1 \
FORGE_CANDIDATE_PG18_BIN=/var/folders/y8/bczj85r901sgf3cl21ntxjym0000gn/T/forge-pg18-candidate-r5yy4wxo/install/bin \
npx vitest run tests/engine/e5-candidate-recovery.test.ts
```

The binary directory is a temporary, previously reviewed local build; if it is absent, rebuild through an independently reviewed toolchain procedure. The harness never downloads or provisions a replacement. It accepts no caller SQL, backup archive or source tree for execution.

D5 remains open: production control DB/object storage/KMS/backup ownership, authenticated backup catalogs, retention/residency, encryption, off-site availability and scheduled restore drills are unselected. Still unverified: real E1 control data and artifact references, backup expiration/deletion, backup credentials and key rotation, interrupted/partial backup publication, power-loss durability, WAL/PITR, concurrent-writer consistency, disaster access, production detection/recovery times and realistic dataset sizes. Local file hashes model integrity against corruption; they do not authenticate a cloud backup or defend against a hostile same-UID process racing the drill. D2 guest isolation and D7 release-image gates also remain unchanged. Broader commercial data-recovery features stay deferred by the RFC.
