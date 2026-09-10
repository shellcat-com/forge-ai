# Task 03 — Verified candidate template and toolchain

2026-09-10 UTC. **Implementation delivered; candidate only. D7 remains OPEN.** This task does not release an image, run a provider, publish a portfolio, authorize spending or close full-stack acceptance. Worktree `/tmp/forge-task03-template`, branch `codex/task-03-template`, based on Task 01's published worker commit `881e9ac2b11f8f168cb7849b77c4ee7439e55458`. PR base is `codex/demo-delivery-baseline` (Task 01 PR #8); real image integration depends on Task 02. The shared checkout was untouched.

Read AGENTS.md, RFC 0001, E0/E1 and E2–E5 checkpoint/reports, engine-decisions and the latest coordination board. Task 01 explicitly delegated template manifests/configs/release tests and the reference-corpus brief. Task 02 owns runner/image launch; Task 09 owns general acceptance; Task 08 owns publication. No root manifest/lock, shared engine contract/catalog, control migration, Forge UI or general runner infrastructure was changed.

## Delivered changes

- Preserved exact Next.js App Router/React/strict TypeScript/PostgreSQL dependency pins and lock bytes. Added the exact package manager actually bundled with the checked Node archive: `npm@11.19.0`. This corrects an omission; it is not a dependency upgrade. Package JSON SHA256 changed from `f0578b9ade57da65935585a217974c3ca486075677fb5b84dc8684d356de9b5d` to `b70d0d782d59c4789bf25de978ec6bf1c3d960f8999cefd8529a729c874d87f8`. Lock SHA256 remains `ce88882e5e2a00763896b4685bb964de44273905ba23d638fdeaac0b06157123`.
- Added protected Vitest configuration with a fixed platform-test include and no empty-suite pass. Release validation now requires protected build/check/bootstrap paths, exact candidate releases, direct dependency/lock agreement and current approval time. Existing authenticated real-evidence and 30-run benchmark gates remain enforced. Synthetic tests cannot activate this release.
- Added deterministic task-board/priority reference SQL with exact previous fixture bytes, plus an export-only transactional migration runner with role/database validation, advisory locking, hash history, idempotent replay and app-role denial on migration history. It is not the trusted general guest migration runner. Existing strict generated-SQL validation and reference CRUD/restart tests are preserved.
- Added `reference/portfolio.json` and its hashed entry in `tests/harness/reference-apps.ts`. Task-board/pomodoro definitions remain unchanged. A portfolio can be database-free; engine database acceptance remains mandatory. Task 09's separate frozen provider campaign is unchanged. No hand-authored portfolio is misrepresented as generated output.
- Added trusted package acquisition, offline cache materialization, deterministic cache packaging, image-input metadata and export instructions. Generated source cannot change the catalog's protected config, scripts, tests or dependencies, nor add root config/tests. Tests reject mutation/deletion of every protected entry.

## Official version/security review

All direct package versions were checked against registry metadata **and actual tarball package.json**, not merely availability labels. Retained candidates: Next/ESLint Next config 16.3.4, React/DOM 19.3.0, Node 24.20.0, npm 11.19.0, PostgreSQL 18.6, TypeScript 5.9.2, pg 8.23.0, ESLint 9.35.0, Vitest 4.1.11, Playwright 1.63.0; exact type packages are in the unchanged lock.

[Next installation documentation](https://nextjs.org/docs/app/getting-started/installation) and the bundled guide require Node >=20.9; Node 24 satisfies that minimum. [Node's official release](https://nodejs.org/en/blog/release/v24.20.0) establishes the LTS archive. Actual binary/runtime versions were checked. [Next's August security release](https://nextjs.org/blog/august-2026-security-release) fixes critical issues in 16.3.3; retained 16.3.4 is later, and the protected config disables image optimization/remote patterns. This does not prove freedom from unknown vulnerabilities. [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/18/release-18-6.html) document security fixes and upgrade considerations; this template uses fresh disposable databases, restricted non-replication roles and no extensions.

**ESLint 9.35.0 is deprecated/unsupported in registry metadata.** [ESLint's support policy](https://eslint.org/version-support/) is a maintenance concern even though the current audit is clean. No silent upgrade was made. A maintained replacement needs a reviewed pin/lock change and reproduction before D7. Upstream archive SHA256 checks were verified against official HTTPS checksum documents; upstream GPG/signing-chain verification was not completed.

## Package bytes, provenance, hooks and licenses

[Dependency evidence](../evidence/task-03/dependencies.json) records **482 lock entries, 475 distinct tarballs**, 615,651,866 aggregate entry bytes (duplicates included), exact SHA512/SHA256, package identity, metadata hashes, license-file hashes, engines/platform constraints, signatures, attestation declarations and hooks. All byte/identity/lock checks passed. No package hook executed. Acquisition inspects archives without extracting or importing package code. Legacy single-root DefinitelyTyped archives are handled explicitly, with duplicate metadata/path checks.

[Registry signatures](../evidence/task-03/offline-materialization-macos.json): **482 verified** against pinned registry keys, using ECDSA over `name@version:integrity`; expiring keys use publication time as npm's inspected pacote implementation does. [npm provenance verification](../evidence/task-03/npm-provenance.log): **400 installed packages with verified registry signatures, 102 with verified attestations**, no invalid/missing registry signatures. Full-lock attestation declarations number 173; the whole graph does not have verified provenance. The distinction is explicit in the [review](../evidence/task-03/dependency-review.json). [npm's audit documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/) explains those separate checks.

The dated [advisory report](../evidence/task-03/npm-advisories.json) reports **zero known vulnerabilities** for 482 entries. It is not an OS/native-library SBOM scan. `unrs-resolver` has the only explicit postinstall in actual package metadata; its reviewed script delegates native preparation to `napi-postinstall`. It remains disabled, as do all recorded prepare hooks. Locked optional bindings sufficed for the observed macOS build. Linux execution still needs proof.

License policy remains **blocked for distribution approval**. Archive license declarations match the lock; 74 entries lack a conventionally named license file. The review inventories these rather than silently assuming permission. MPL/LGPL/native-library components require actual image/notice/corresponding-source review; [Mozilla's MPL guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) distinguishes use from distribution obligations. Source-only exports omit node_modules, but that does not waive notices for bundled code or authorize redistributing the dependency archive/image. Task 09/maintainer must also resolve licensing for original Forge/template code. No blanket legal compatibility sign-off is claimed.

## Image contract and exact identities

Agreed with Task 02 and corrected with Task 01 to avoid a hash cycle. `templateInputsDigest` is `canonicalHash({schemaVersion:1,files:[{path,mediaType,sha256,bytes}]})`, sorted lexically by path, using existing engine canonical JSON. It excludes the image and includes every reviewed exported file. Task 02 then computes `imageDigest = 'sha256:' + canonicalHash(runtimeImageSchema.parse(bundle))`; **only afterward** does the unchanged E2 catalog compute final templateDigest, which includes imageDigest. The signed descriptor binds both. Unit tests cover ordering, tampering and duplicates.

The bundle binds actual kernel/rootfs/Firecracker/jailer/seccomp/supervisor/cache/guest-agent assets plus independent input digests. No NIC/vsock, read-only `/workspace`, immutable `/opt/forge` and disposable `/scratch/build` are Task 02's implementation direction. Independent browser/preview transport and prior-state migration evidence are not waived. No shell or model-selected command replaces the existing exact policy.

| Input | Actual SHA256 / identity |
| --- | --- |
| Node Linux x64 archive | `2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2` |
| PostgreSQL source archive | `555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f` |
| Dependency manifest bytes | `13ff37def06dcc040dc02d594c2b5576ec3127e7fc36e56676d4bc88837da2cf` |
| Registry-key document | `faf23d8753d5bb79df250f10391ac89b63ecf7743e48487a544a99c847f9c8df` |
| Actual Linux-target content-cache tar | `e6beda8f3532eccd3c961d9c51000edf3a1dce442275a8095fa1509c4cea9afd` (180,377,600 bytes) |
| Independent template inputs | `3b1dad1467bb41c2c8bb472ebf9bc8d632e558386045f8a34c4f554b6d951388` |
| Canonical image-input JSON object | `8f1eb9960174fb682ec53abd1eec7abc614f4448e20e5ad14eee376011864ed5` |
| Clean scaffold source archive | `eee2157954f59ba0e54e9a70c8a9f075bd331372826160f5d71577f135898d96` |
| Real image / final released catalog | **Unavailable**; candidate input JSON uses null, never a fabricated digest |

[Archive evidence](../evidence/task-03/toolchain-archives.json), [cache packaging](../evidence/task-03/cache-archive.json), [image inputs](../../../templates/next-postgres-v1/toolchain/image-inputs.json). The two cache archives were byte-identical with fixed PAX metadata; this is reproducible content packaging on macOS, not independent Linux image-build reproducibility. The actual cache archive is available locally at `/tmp/forge-task03-linux-cache.tar`; no third-party binaries were committed. Acquisition can recreate exact bytes from the lock; disposable downloaded tarballs were removed after hashing to relieve shared disk pressure.

## Reproduction and observed results

Use exact Node 24.20.0/npm 11.19.0, Python 3/curl, and PostgreSQL 18.6 native binaries for the opt-in database test. Fresh root `npm ci` is an integration prerequisite. Local root checks here used a read-only symlink to Task 01's already clean-installed node_modules with matching root manifests; this is supporting evidence, not another clean root install.

```sh
npm ci
npm run verify
python3 -B templates/next-postgres-v1/toolchain/test_acquire.py
npx --no-install vitest run tests/engine/template-toolchain.test.ts tests/engine/e3-release.test.ts
FORGE_POSTGRES18_CANDIDATE_TEST=1 npx --no-install vitest run tests/engine/e3-postgres-candidate.test.ts
python3 templates/next-postgres-v1/toolchain/acquire.py /absolute/new/bundle
# Use hashes from the reviewed image-input/evidence manifest, not freshly trusted output:
node templates/next-postgres-v1/toolchain/materialize.mjs /absolute/new/bundle \
  13ff37def06dcc040dc02d594c2b5576ec3127e7fc36e56676d4bc88837da2cf \
  faf23d8753d5bb79df250f10391ac89b63ecf7743e48487a544a99c847f9c8df \
  /absolute/node/lib/node_modules/npm /absolute/new/cache darwin-arm64
FORGE_RUN_CANDIDATE_EXPORT=1 FORGE_CANDIDATE_NODE24=/absolute/node/bin/node \
  FORGE_CANDIDATE_CACHE=/absolute/new/cache FORGE_CANDIDATE_REPORT=/absolute/new/export.json \
  npx --no-install vitest run tests/engine/e3-candidate-export.test.ts
```

Use `linux-x64` for the Linux cache, then `python3 templates/next-postgres-v1/toolchain/package-cache.py CACHE NEW.tar`. `npm ci --offline --ignore-scripts --no-audit --no-fund --os=linux --cpu=x64 --libc=glibc` in a fresh directory with exact package/lock installed **399 packages** on macOS without executing them. [Target-selection evidence](../evidence/task-03/linux-target-materialization.json) records native GNU binding versions. The install also passed after deleting the original cache and reconstructing it solely from the deterministic content archive ([replay](../evidence/task-03/linux-archive-replay.log)); no npm cache indexes or ambient cache were needed. Task 02 must execute them on Linux. No provider credentials, paid APIs, Linux host or Vercel account were used.

| Check | Observed result / evidence class |
| --- | --- |
| Root `npm run verify` | PASS: lint, both TS checks, 592 tests / 4 optional skips, production build; shared baseline dependency install; [log](../evidence/task-03/root-verify.log) |
| Final changed-code validation | PASS strict engine TS, focused ESLint, 90 tests / 1 opt-in export skip; [tests](../evidence/task-03/template-tests.log). This follows final release-validator changes. Full final CI is reported in the PR. |
| Python acquisition/cache tests | PASS 5 synthetic tests: identity/metadata/path rejection, hook inventory, cache tampering and deterministic output |
| Clean 25-file scaffold export | PASS: immutable fixture storage/scanner/ZIP, fresh cache-only install, lint, strict TS, protected test, build, cleanup; macOS Node24.20/npm11.19; [exact command/output evidence](../evidence/task-03/clean-export.json) |
| Native PostgreSQL18.6 | PASS fresh/prior/default privileges/denied DDL-role-file access/restart/export replay/changed-history rejection/cleanup; [native evidence](../evidence/task-03/native-postgres.json). Socket-local trust; guest SCRAM provisioning NOT RUN. |
| Actual Linux runtime/image/generated export | BLOCKED; no approved host/access, no downgrade to host execution |
| Browser/UI | No UI files changed. Historical scaffold browser evidence retained but not rerun or promoted. Real DB-backed app-process/browser/preview evidence remains required. |

The first cache-packaging attempt used USTAR, which cannot hold npm's long SHA512 filenames; corrected to deterministic PAX and compared two outputs. Initial archive parsing rejected legitimate DefinitelyTyped top-level folders; it now validates the single-root layout and actual package identity. An expired signing-key check was corrected to npm's publication-time semantics before recording verification success. An initial npm `--prefix` attempt selected the wrong context and failed lock sync; the subsequent clean install ran in the export/audit directory with the unchanged lock. Shared disk pressure caused an explicit first Linux-cache ENOSPC failure, [retained here](../evidence/task-03/linux-cache-first-failure.log); only this task's disposable caches/dependencies were cleaned before successful retry. No failure or simulation is counted as live acceptance.

## Remaining inputs and handoff

D7 needs approved isolated Linux/KVM access through Task 02; actual OS/compiler/kernel/rootfs/launcher/agent inputs and signing/security review; independent build reproducibility; guest SCRAM credentials, browser/CRUD/app-process persistence, fresh/prior migrations and containment/cleanup; actual generated-source clean export; complete distribution/license/provenance treatment; reviewed maintained ESLint pin; and budget-authorized live reference evidence. No applicable paid budget was supplied.

The portfolio brief is available to Tasks 08/09. A separate static `output:'export'` profile is a documented proposal, **not an approved profile**; Task 08 keeps publication disabled pending actual source/runtime/build-output evidence. Vercel default HTTPS hosting and no domain purchase remain the user-selected direction. This portfolio cannot substitute for PostgreSQL acceptance.

Final source/config diff review passes. Raw verification logs retain their original terminal whitespace. Gitleaks flagged six items: four SHA256 values named for registry keys and two published npm verification public keys; all were reviewed, with no real credentials identified ([disposition](../evidence/task-03/secret-review.json)). No unrelated source changes or private artifacts were staged.

Task 01 receives owned commits and exact hashes for integration; Task 02 consumes independent inputs and the actual cache archive; Task 09 receives the candidate/license/provenance/export evidence. Draft PR remains appropriate. No merge, force push or credential/private-data publication is authorized or performed.
