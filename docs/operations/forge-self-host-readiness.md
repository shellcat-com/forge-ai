# Forge self-host release readiness

This guide is bound to Task 01's `efa13a9de63457d0daccde1cc1cda645d332b6ff` baseline (implementation `88a5a39daeabe088a119f871166333975588c1b1`). It reproduces the available platform and independent tests. **A complete self-hosted generation service cannot yet be configured from this commit.** Missing production composition is implementation work, not something an operator can solve by adding keys. See [the independent release report](../reports/forge-release/09-release.md) and [coordination](demo-delivery-coordination.md).

## Choose the intended behavior

| Mode | Available at this baseline | Boundary |
| --- | --- | --- |
| Keyless local platform inspection | Build and inspect public pages; ephemeral synthetic database/browser checks | No provider account, cloud subscription, Docker worker or generated-code execution is needed for these checks. |
| Existing local application | Next.js UI, application PostgreSQL history, local provider adapters and legacy Docker worker code | Preserved development workflow; it does not satisfy the approved release sandbox. This guide does not start that worker. Local-owner state is not real identity. |
| Public Forge website | A separately packaged, truthful availability page is deployed | The full authenticated builder, BYOK connection UI, private previews and Publish are unavailable there. |
| Self-hosted/hosted release engine | Provider, identity, storage, runtime and preview foundations with synthetic tests | Task 01 must connect their production authority, migrations, admission, accounting and lifecycle. Configuration alone cannot enable it. |
| Generated applications | Required first stack: Next.js App Router + strict TypeScript + PostgreSQL | Candidate template only; no qualified live generated app/export/publication was supplied. A static portfolio does not replace PostgreSQL task-board acceptance. |

## Fresh checkout without private configuration

Install **Node 24.20.0**, **npm 11.11.0**, Python 3, native PostgreSQL tools (`postgres`, `initdb`, `pg_ctl`, `psql`, `pg_dump`, `pg_restore`) and Google Chrome. Put the selected binaries on PATH and record their actual versions. The independent run used macOS arm64, PostgreSQL 14.18 and Python 3.14.6. PostgreSQL 14.18 supports these control tests; it is not qualification of the generated candidate's PostgreSQL 18.6 Linux image. No platform Docker installation was used.

```sh
git clone https://github.com/shellcat-com/forge-ai.git forge-ai
cd forge-ai
git fetch origin codex/demo-delivery-baseline
git checkout --detach efa13a9de63457d0daccde1cc1cda645d332b6ff
node --version
npm --version
postgres --version
npm ci --no-audit --no-fund
npm run verify
npm run test:db:control
npm run control:build
python3 scripts/check-baseline-browser.py
```

Run from a clean environment without `.env`, `.env.local`, inherited provider/database/auth/deployment variables or private npm configuration. The recorded reproduction used `env -i`, a new task-owned empty home directory and only explicit PATH, HOME, CI and NEXT_TELEMETRY_DISABLED. It installed a separate copy of npm 11.11.0 and its own dependencies, without symlinks to another checkout. Registry access is required for the initial install. `--no-audit` only suppresses the install audit request; it is not vulnerability clearance.

The browser harness refuses private environment files, creates a unique socket-only PostgreSQL cluster with synthetic rows, applies **application migrations twice**, starts the built server on a new loopback port and cleans up. Its local trust authentication is confined to that disposable test cluster; do not copy it into a real server. Tests use synthetic identities/provider/runtime results and skip unsupported live flows. Native PostgreSQL does not turn fixture generation into a live result.

After building, `npm start -- --port 3000` serves public pages at `http://127.0.0.1:3000`; `/hosting` displays the explicit unavailable state. Without database configuration, project operations are unavailable. Leave provider keys unset and do not start `npm run worker`, `runtime:build` or a generated export on the laptop to fill a release gate. The RFC API/worker CLI defaults disabled; explicit execution/preview enabling is rejected. Hosted application generation returns an unavailable error pending sandbox and budget verification. The preserved local Docker implementation must not be presented as an approved fallback.

The root npm package is private and `npm pack` omits its lockfile. Use the exact reviewed Git checkout with `package-lock.json` for reproduction, not an npm tarball advertised as install-ready. Review source-distribution contents and historical media separately before distributing an archive.

## Services and configuration required for the release engine

Use [the names-only inventory](../examples/forge-release.env.names) as a configuration checklist, not as an executable environment file. No secret values, example credentials, selected provider model or paid enablement flags are supplied. Only names consumed by existing code are included. Some foundations accept injected interfaces rather than environment variables; inventing a variable will not wire them up.

| Requirement / owner | Operator input and acceptance | Current limitation |
| --- | --- | --- |
| Identity — 01/05 | Exact HTTPS origin; Better Auth secret reference; selected Google/GitHub OAuth client or verified email transport; approved invitations and two actual test accounts containing synthetic data | `FORGE_AUTH_MODE=hosted` selects application sessions, not a completed RFC identity bridge. Native OIDC/CSRF/role tests use synthetic issuer data. |
| PostgreSQL — 01/06 | Separate migration/API/worker/maintenance identities, TLS/host validation, region, backup and retention owner | `DATABASE_URL`/`DATABASE_DIRECT_URL` belong to the application. `npm run db:migrate` applies `drizzle` only. Engine SQL 0001–0003 is a separate history; 0004–0007 are reserved/proposals, not deployable canonical migrations. Never mix runners or copy privileged test roles. |
| Durable worker — 01/06 | Selected external process host, restart supervision, leases/fencing, queue/admission caps, shutdown/reconcile owner | `FORGE_DURABLE_WORKER=external-process` is a readiness input, not a deployed worker. The live stage/adoption and global accounting composition is missing. Do not run two workflows for the same scope. |
| Artifacts and secrets — 04/06 | Private immutable versions, separate encryption domains, approved key resolver/KMS, IAM/network/region, retention and restore references | Encrypted PostgreSQL object backend is implemented and locally tested; production adoption, lifecycle and recovery are not qualified. Secret resolver functions are server-injected; no generic public key variable enables them. |
| Provider — 01/04 | Exact endpoint/model policy, capabilities, credential secret reference, token bounds, dated price version, account limits, numeric job/workspace/global/campaign budget | Hosted credential routes and live dispatch authorization are not connected. An environment key or confirmation flag grants neither admission nor spend approval. |
| Runtime — 02/03 | Approved separate Linux/KVM host, signed immutable image/toolchain/source identities, guest RPC, jailer/network/cgroup setup, scoped app-DB credentials and independent watchdog | Actual containment, resource abuse, lease expiry, app restart and teardown tests are blocked on qualified infrastructure. No ordinary host process, Docker-only or Function substitute. |
| Preview — 01/05/07 | No-purchase exact site/origin/TLS arrangement, authenticated gateway, atomic tickets/sessions, exact healthy environment routing, revocation | Local TLS/browser tests do not verify public ingress, real runtime routing or deployed cookie separation. A public app URL does not replace private preview. |
| Publishing — 01/04/08 | Separate Forge and generated-app projects, trusted publication authority, approved source/check/usage/export receipt, scoped deployment credential | Static prebuilt connector tests exist. The production in-product Publish/rollback flow and genuine generated artifact are missing. Deployment keys never enter provider requests or guests. |

Vercel provides [generated deployment URLs](https://vercel.com/docs/deployments/generated-urls), so no custom-domain purchase is required. Its [Function execution limits](https://vercel.com/docs/functions/limitations) do not qualify Forge's durable worker or sandbox. The selected deployment account, infrastructure operator and provider account each retain their own access, resource and billing responsibilities. A self-hoster supplies or pays for required identity/email, database, workers, storage, keys, sandbox, backup and hosting capacity; existing owned infrastructure may satisfy these needs. BYOK avoids a Forge model-credit checkout, but provider calls and infrastructure are not inherently free. No account purchase, paid service or budget is authorized by this guide. Official service references checked 2026-09-10 UTC.

## Provider and model support

The application registry implements Gemini, Groq, OpenRouter and local Ollama adapters. Their configuration names are in the inventory; discovery is not model-quality, billing or release qualification. Ollama uses the configured local endpoint and does not download a model automatically. Keep the separate NVIDIA loopback **text planner** distinct from source generation.

The RFC registry implements `chat-completions-json-v1`: nonstreaming structured plan/files/repair, no tools/images/audio, no automatic retry/fallback. Its `openai` policy is restricted in source to `gpt-4.1-2025-04-14` at the exact OpenAI chat-completions endpoint. This describes checked code, not current account entitlement or a recommended purchase. No default policy is installed; `liveEnabled` remains false. Other endpoints require an administrator-installed exact destination/model policy and their own verification. Similar API shapes do not establish universal model compatibility. See [the provider boundary](../../engine/providers/README.md).

Self-hosted credentials resolve from server-owned environment/secret references. Browser requests cannot choose those reference names. Hosted connections require authenticated TLS, current tenant authorization, encryption at rest, rotation, deletion and redacted status. Reject browser-public prefixes (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`), logging of request bodies, private/metadata/IPv6 destinations and redirects. Bind the credential to its exact approved destination. Do not put model, database, control or deployment credentials into source archives or runtime guests; app-local database credentials are separately provisioned.

## Limits, upgrades and recovery

Preserve the RFC's caps and acceptance targets. Source validation limits include 200 files/10 MiB, 256 KiB per generated text file and 100 proposal operations; provider accounting allows at most 12 calls and two repairs. Monetary ceilings require an approved exact price/token policy. Local application's 10 daily requests and single active owner job are not equivalent to global monetary reservations or measured hosted capacity. Readiness inputs cap some database pools and rotate SSE, but configuration is not observed performance.

Before upgrades, disable new admission and reconcile active leases, previews and uncertain charges. Record the old commit, migrations, lock/template/image/policy versions and deployment receipts. Back up application and control databases, immutable object versions, encryption-key versions and recovery metadata under separate access controls. Restore to a **new isolated target**, verify referential/object hashes, tenant permissions and job state, then measure data loss and elapsed recovery. A successful dump is not a restore drill; see PostgreSQL's [SQL dump documentation](https://www.postgresql.org/docs/current/backup-dump.html). Never test recovery on the only live copy.

Apply only reviewed additive migrations in their own namespace with a migration identity, verify schema/role compatibility, deploy pinned artifacts, test fresh-session authorization and recovery, then enable bounded admission after release approval. Keep a compatible prior application artifact for rollback; rolling back code does not reverse schema/data changes. Generated source restoration creates history and is separate from app-data recovery and public deployment rollback. Keep live source, data and deployment identities explicit. No complete engine upgrade command exists before Task 01 publishes the production composition.

For key revocation: block new dispatch, revoke/rotate at the provider, tombstone or rotate the Forge connection, invalidate relevant sessions/preview access, reconcile dispatched/unknown-charge calls, and verify old revisions cannot authorize another request. Deleting a Forge connection does not revoke the provider's key or erase backups. Retain prior wrapping-key versions only as required for approved recovery/re-encryption; destroying them early can make retained data unreadable.

For project/account deletion: revoke access and preview routes, cancel/fence jobs, confirm VM/volume/app-credential destruction or quarantine with an alert, then apply the approved artifact/database/backup retention policy. Append-only audit/accounting and backup copies need an explicit retention/legal policy; no immediate physical-erasure guarantee is implemented. Record remaining retained data and verify that a restore cannot resurrect revoked access. Current local synthetic recovery tests do not close deployed deletion/PITR acceptance.

## License and release status

The existing MIT license is preserved byte for byte. All four bundled font notices match the installed Fontsource license files in this reproduction. An owner approval reference for MIT, dependency compatibility review and historical artwork/media distribution clearance remain unverified; package license declarations do not resolve those gates. No license was selected or changed.

The release report lists every A01–A22 and additional demo/self-host gate with status, evidence and owner. A passing source suite, public availability page or platform scaffold cannot sign off a live app-building demonstration. Keep generation unavailable until the actual staged composition and real acceptance evidence are supplied.
