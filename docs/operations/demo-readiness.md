# Reproduce and evaluate the Forge demo

This guide describes the canonical Next.js application and the separate RFC engine. Consult [Task 09's acceptance report](../reports/demo-delivery/task-09-acceptance.md) for the exact tested commit and current outcomes. The required generated engine stack remains Next.js App Router, strict TypeScript and PostgreSQL. A public portfolio may be a website with no application database; it does not replace the task-board/priority/persistence corpus.

## Clean development setup

Use a fresh clone with Node 24.20.0, npm and native PostgreSQL test tools (`initdb`, `pg_ctl`, `psql`, `postgres`) on PATH. Record `node --version`, `npm --version`, `postgres --version`, the commit and lockfile SHA-256. Never copy another checkout's private environment or database into a reproduction.

```sh
git clone https://github.com/shellcat-com/forge-ai.git forge-ai
cd forge-ai
git checkout <reviewed-commit-from-the-task-report>
npm ci
npm run verify
npm run test:db:control
npm run control:build
python3 scripts/check-baseline-browser.py
```

The browser harness requires installed Google Chrome, starts disposable synthetic PostgreSQL and an isolated application listener, applies application migrations twice, and cleans up its resources. It supplies a synthetic local owner and no generation credentials or worker. Passing it verifies application compatibility, not hosted authentication or generation. The normal unit suite separately tests the RFC control service with disposable native PostgreSQL and explicit provider/runtime fakes.

For keyless public-page inspection after building, run `npm start -- --port 3000` and open `http://127.0.0.1:3000`. For editing, `npm run dev` starts the Next.js development server. Project storage needs the application database. The existing local workflow additionally uses `npm run setup:local`, `npm run db:migrate`, `npm run runtime:build`, then `npm run worker` and `npm run dev` in separate terminals. Review [local setup](../self-hosting.md) and [runtime boundaries](../runtime.md) first: setup creates a dedicated Docker PostgreSQL container/volume, preserves an existing private DATABASE_URL, and the local Docker workflow is not RFC microVM acceptance. Do not run this setup against an existing database merely to reproduce UI checks.

Engine migrations under `engine/migrations` and application migrations under `drizzle` are different authorities. `npm run db:migrate` applies only the application history. Do not route it to an RFC control database or mix the histories. Port, database and image names from old worktree reports are observations, not fresh-install defaults.

## Provider matrix at the audited baseline

This matrix reports implemented code paths, not live qualification. Check the eventual Task 04 report before updating any row to verified support.

| Provider/path | Implemented capability | Configuration and acceptance limit |
| --- | --- | --- |
| Gemini, application registry | Model discovery and generation adapter | Server `GEMINI_API_KEY`, exact model and free-tier confirmation; current account eligibility and generation quality were not tested by Task 09. A confirmation flag is not a numeric spending cap. |
| Groq, application registry | Model discovery and generation adapter | Server `GROQ_API_KEY` and exact `GROQ_MODEL`; no new live test or RFC per-call accounting acceptance. |
| OpenRouter, application registry | Model discovery and generation adapter | Server key/model and paid-model confirmation; no automatic spending authorization follows from that flag. |
| Ollama, application registry | Discovery/generation against configured local endpoint | Existing local workflow only; no automatic model download, no universal hosted BYOK endpoint allowance. Local compute still needs an envelope. |
| NVIDIA, historical loopback server | Text planning | Separate optional `server/` prototype; a planning response is not generated source or a live RFC adapter qualification. |
| RFC chat-completions transport | Bounded structured source adapter and failure tests | Exact configured provider/model/credential/policy are required; baseline source/control composition is explicitly fixture-only. |
| Other providers or arbitrary compatible URLs | Unverified | Reject unsupported capabilities/protocols. Similar JSON APIs do not prove streaming, cancellation, pricing, token bounds or destination safety. |

## BYOK security and limitations

BYOK is included in the delivery scope, but the baseline's environment-based local configuration is not a complete hosted credential connection service. Hosted enablement requires authenticated TLS submission, tenant authorization, encrypted versioned secret storage, destination binding, rotation/deletion and redacted read status. Keys must stay out of browser storage, public environment variables, model context, generated files, previews, exports, diagnostics and telemetry. Never paste a key in an issue, acceptance report or screenshot.

Arbitrary base URLs are an SSRF boundary: the administrator's destination policy must validate DNS and IPv4/IPv6, deny private/link-local/metadata destinations, reject redirects, and bind the credential to the exact approved destination. No user-entered URL may expand the runtime's network policy. Task 04 owns that implementation and negative evidence; Task 05 owns identity, Task 06 secret persistence and Task 01 the durable accounting bridge.

Before any billable dispatch, approve exact model/prices/token upper bounds and numeric per-job, workspace/day and global/day ceilings, plus a total campaign cap and separate runtime/storage/transfer allowance. Reserve each attempt, deduplicate settlement, retain uncertain charges and enforce the repair/call bounds. No paid fallback is automatic. Current Task 09 authorized new provider and infrastructure spending is **$0**; no live credential use follows from this guide.

## Vercel and public portfolio

Vercel is selected for website hosting with no purchased domain. Its [generated deployment URLs](https://vercel.com/docs/deployments/generated-urls) provide a platform URL. [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication) can require a Vercel login, so validate the exact advertised URL in a fresh browser context without cookies, bypass headers or account access. A deployment that works for its owner may still fail the public portfolio requirement.

Forge's long-lived workers, isolated generated-code execution, durable PostgreSQL/object storage, key management and private-preview gateway remain separate from a website deployment. Vercel Functions have [execution limits](https://vercel.com/docs/functions/limitations); placing the local Docker worker inside a Function does not meet the repository's hardened Linux/KVM contract. Any managed sandbox substitution needs Task 01's explicit architecture amendment and real containment/network/cleanup evidence. These links were checked on 2026-09-10 UTC; account-specific configuration and costs still require verification.

Task 08 owns deployment writes. Record the generated source manifest, exact lock/template/policy/runtime identities, clean export digest, deployment commit/ID, immutable deployment URL and current public alias. Keep the public website's protection decision separate from Forge owner access and the private preview's single-use tickets, short-lived sessions and revocation. Anonymous portfolio visitors receive no build authority.

## Owner demonstration and independent reproduction

1. Start from an approved owner identity, reviewed provider connection and numeric budget. Capture redacted readiness status and exact source/template/policy/runtime identities before generation.
2. Submit a new portfolio brief. Retain all provider attempts, errors, reservations, usage classifications and repairs. Show actual source review and required approval before execution; record externally produced checks. A scripted fixture or replay is labeled as such.
3. Demonstrate the generated website, then the required PostgreSQL task-board, additive priority migration, app-process restart and unchanged rows. Show a failed edit leaving the source head unchanged, source restoration creating history, and preview reset acknowledgment.
4. Export from the exact promoted source. In a clean approved isolated environment, inspect the archive for credentials, internal artifacts, caches, lockfile and licenses; install from the lockfile, migrate fresh and prior PostgreSQL, build and run. Record archive/source hashes and toolchain versions. Never execute unknown exported code on the operator host.
5. Publish only the reviewed website through Task 08's Vercel workflow. A separate anonymous browser visits the exact public URL, checks navigation/assets/responsiveness and verifies that no Forge or Vercel sign-in is needed. Retain deployment identity and source correspondence, not private account screenshots.
6. On the real generated preview, inspect light/dark at 390/768/1440px, keyboard CRUD/focus, browser-native 200% zoom and actual OS/browser reduced-motion settings. Record the settings mechanism and restore changed preferences. CSS `zoom`, viewport resize, `emulateMedia` and forced style overrides are simulations and cannot fill native-setting evidence.

No new generated app was reproduced by Task 09 at the baseline; runtime/provider/access prerequisites remain open. A successful platform-authored scaffold export is useful support, not this generated-app reproduction.

## Campaign envelope and evidence

Preserve `providerReferenceCorpus()` in `engine/operations/provider-evaluation.ts`: six cases with five independent repetitions each, task-board/priority/Pomodoro variants, at least 30 live attempts and a 90% completed-build target within two repairs. The portfolio is additional evidence, not a substitute corpus. Freeze corpus/model/prompt/template/image/command/scanner/price identities before the run. Retain failed, denied, cancelled, timed-out and uncertain-charge attempts. Report planned/attempted/admitted/dispatched counts, full success denominator, latency samples/missing counts/p50/p95, known cost samples/p50/p95 and uncertain maximum liability. Zero live samples means distributions are unavailable, not zero latency or zero average cost.

Local Task 09 checks have a $0 external-spend envelope: one test process or two loopback public-page request clients, at most 20 HTTP requests, no provider endpoint, no generation worker, no cloud access. This is a small compatibility observation, not the RFC A20 campaign. A20 still needs the declared 100-session/10-job/20-preview steady/burst/fault campaign or a reviewed amendment with affordable caps, measured hardware and actual results. Do not extrapolate local fixtures or capacity arithmetic into thousands or billions of concurrent builds.

`engine/validation/delivery-evidence.ts` checks exact canonical commit/source/template/policy/runtime/deployment identity equality, retains failures and rejects simulated controls as native support. `verifyDeliveryArtifacts` checks local artifact bytes and refuses path escapes. Neither labels nor hashes authenticate the collector: the result always reports `provenanceVerified`, `dispatchAuthorized` and `releaseReady` as false. Complete trusted attestations and RFC acceptance remain separate. Historical checkpoint ledgers must not be overwritten or relabeled.

## Public distribution and contributing

Preserve [MIT LICENSE](../../LICENSE). Bundled fonts retain their [upstream license notices](../../public/fonts/licenses). MIT does not automatically grant redistribution rights for third-party screenshots, videos, brands or generated artwork. Review asset rights and safe attribution before release. Record source hashes and methods without provider account IDs, signed URLs, private logs or personal paths. Preserve originals and historical failures in restricted storage where appropriate; sanitization creates a new artifact/digest and must explicitly supersede old public evidence.

The root package is `private: true`; no npm publication is intended. `npm pack --dry-run --ignore-scripts --json` still exposes the proposed archive inventory. Review both the Git archive and package inventory, nested ZIPs and generated source export; excluding a path from npm does not remove it from the public Git repository or history. Scanners are heuristic: text scans do not examine every screenshot/video frame or prove absence of obfuscated secrets. Never claim an exhaustive privacy/license clearance from a clean scanner result.

Follow [CONTRIBUTING.md](../../CONTRIBUTING.md) and [SECURITY.md](../../SECURITY.md). Use a focused `codex/` worktree based on the published canonical commit, preserve tests, provide exact reproduction and residual limitations, and route shared README/manifests/contracts/migrations through Task 01. Report private vulnerabilities through the security process, not a public PR containing secrets. Each Task 09 PR must separate code/test completion, first live demonstration, private-alpha acceptance and production readiness.
