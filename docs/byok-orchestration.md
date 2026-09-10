# User-owned connections and task orchestration

## Release boundary

Forge supplies no model keys, credits or paid fallback. Users connect their own accounts and pay providers directly. This change implements connections, capability checks, task routing and durable model dispatch in the Next.js application. Hosted generation remains disabled in both admission and worker startup. Public deployment and other application stacks are separate work.

This branch starts at merged master `42a3763` and incorporates draft PR #8 (`4afc9cb`) without rewriting its commits. It reuses the foundation's authenticated credential cipher, destination address classification, stream framing and exact accounting arithmetic. The dirty Vite checkout is not part of this change.

The production application path is `Next.js API → PostgreSQL jobs/runs → worker/index.ts → RoutedGeneration → RunExecutor → ModelAdapter`. The RFC `engine/control` entry points remain their explicitly gated fixture/runner harness; they do not form a second live BYOK generation service. The legacy `/api/providers/test` no longer dispatches operator credentials. Old queued generation jobs require a new authorized routing snapshot.

## Data and authority

`drizzle/0006_byok_orchestration.sql` adds tenant-owned connections, account/project routing profiles, immutable run snapshots and durable task attempts. Connections have independent IDs even when several use the same provider. Each holds multiple exact model IDs. Listing is searchable and cursor paginated at 50 connections; model discovery is not proof of entitlement or tool support.

The connection stores an encrypted envelope or an explicit self-hosted environment reference, never a returned key. Each run freezes its source revision, routing policy, selected model profiles and credential revisions. Each attempt records its task, connection/model, request digest, result artifact, usage, provider request ID when reported and financial reservation. The unique `(run_id, stage_key)` prevents duplicate dispatch. JSON results serve as durable handoff artifacts, not provider-specific conversation state.

Better Auth supplies hosted session identity. Requests enforce same-origin checks before reading mutations. The store verifies the session ID, owner and expiry again inside every transaction, including immediately before dispatch. Forced PostgreSQL row policies bind queries to the transaction's `forge.byok_owner`; use a non-superuser role without BYPASSRLS for the application. Owner-scoped advisory locks serialize admission, rotations and reservations. Existing project access checks remain in force.

A saved model cannot grant itself verified capabilities through the public API. Text, structured JSON and research require separate explicit paid tests. Coding, review, repair and Auto routing require a tested structured response; planning requires tested text. Research currently requires a tested native OpenAI Responses web-search model. Listing an arbitrary model is not a promise that every Forge role works with it.

## Providers and research

| Provider | Wire protocol | Notes |
| --- | --- | --- |
| OpenAI | Responses | `store:false`; research explicitly enables web search, requires source citations, permits at most one search tool call |
| Anthropic | Messages | Native headers, content blocks, stop reasons and usage; JSON is validated before use |
| DeepSeek | Chat completions | Exact model ID, documented endpoint, disabled thinking parameter for the implemented plain-text/JSON path |
| Gemini | Native generateContent | System instruction, generation configuration, response JSON mode and Gemini usage |
| Groq | Chat completions | Exact model ID; completion and usage events |
| OpenRouter | Chat completions | `allow_fallbacks:false`, `require_parameters:true`; Forge never silently selects another model |
| Ollama | Native API | Explicit local/self-hosted connection; native streaming and usage |
| Custom | Declared supported protocol | Public HTTPS in hosted mode; tested capabilities and user-supplied exact model ID |

Adapters fail on truncated output, missing terminal events, refusal, invalid required JSON and unsupported tool calls. They never apply a partial file response. Unknown usage remains unknown. Provider errors are converted to safe actionable messages without returning response bodies or keys. Generated text and URLs are escaped by React; source links permit only HTTP(S), without URL credentials.

Official references reviewed September 10, 2026:

- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search): search is an explicit integration, and citations must accompany the resulting answer.
- [Anthropic native API guidance](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk): use the native Messages API for full production behavior.
- [DeepSeek API](https://api-docs.deepseek.com/) and [JSON output](https://api-docs.deepseek.com/guides/json_mode): do not assume model aliases or output behavior are stable.
- [Gemini API](https://ai.google.dev/gemini-api/docs/text-generation), [Groq API](https://console.groq.com/docs/api-reference) and [Ollama API](https://docs.ollama.com/api): separate protocol handling and explicit capability evidence.
- [OpenRouter routing](https://openrouter.ai/docs/guides/routing/provider-selection): fallback is enabled by default upstream; Forge disables it.

A source URL is evidence of what the provider returned, not independent verification that every claim is true. Research artifacts are passed as untrusted reference data. Models have no authority to expand providers, budgets, runtime permissions or secrets access.

## Routing and bounded execution

Account defaults apply to new projects; saving project settings creates an override. Manual assignments are authoritative. Auto uses the user's chosen router and eligible lists. Its structured proposal must select an allowed connection/model for each enabled role, and cannot enable research when the saved policy disables it. The resolved map is persisted before the first task.

The workflow is optional research, planning, file generation, isolated build, Node acceptance tests/start, model review and up to two repairs. All calls, including router, research, review and fallback attempts, share the maximum of 12 calls. Users can lower these limits and output-token limits. The worker serializes source-changing jobs, checks cancellation and base revision, preserves the prior working revision, and promotes only the validated candidate.

Fallback lists default to empty. Only a known non-executed rejection (rate limit or unavailable credits) can advance to the next explicitly saved fallback. Network failures, incomplete streams and uncertain remote outcomes do not automatically repeat. On restart, completed matching stages replay their saved results. Interrupted dispatched stages become unknown and pause the job, retaining reservations. A new run is an explicit user action that may incur another charge.

## Credential operations

Configure `FORGE_BYOK_ACTIVE_KEY` and `FORGE_BYOK_KEYRING` privately on the server. The latter maps version names to independent 32-byte hexadecimal keys. Keep this separate from the database and browser environment; never prefix it with `NEXT_PUBLIC_`. AES-256-GCM binds the ciphertext to the owner namespace, connection, credential revision, provider and destination. DNS is resolved again before requests, every returned address must be permitted, and the validated address is pinned into a new TLS connection with original hostname verification. Redirects are rejected. Keys are never sent to a destination selected by model output.

Hosted endpoints must be public HTTPS on standard ports. Self-hosters may explicitly allow exact private bases through `FORGE_BYOK_PRIVATE_BASE_URLS`; the default loopback Ollama endpoint is local-only. Hosted `localhost` would refer to the server, not the user's computer, and is rejected.

Rotating a connection increments its credential revision and clears capability evidence. Queued snapshots using the old key fail before dispatch. A call already dispatched may still finish and be billed; rotation cannot recall a remote request. Deletion tombstones the connection and clears its credential reference and ciphertext. This does not revoke the provider key: revoke it with the provider too if required. Old encrypted values may remain in database backups until backup retention expires.

Wrapping-key rotation: add the new keyring version, set it active, run `npm run byok:admin -- reencrypt OWNER_ID` for each owner, verify reads, and retain prior wrapping keys securely for the backup-retention period. Rewrapping does not change provider credential revisions. Do not delete old keyring material while retained backups still depend on it.

Legacy environment keys are never shared with hosted users. In protected self-hosted mode, `npm run byok:admin -- import-env` creates explicit local connections referencing the configured variables. Discover and test the models and save assignments afterward. Changing an environment reference's value also requires rotating/retesting its Forge connection before using existing queues; drain jobs first.

## Accounting

Tokens and provider usage are measured only when reported. Cached input, cache creation, reasoning output and search tool calls are normalized separately; reasoning already included in output is not charged twice. Calculated dollars are based on the saved server price policy, not a provider invoice. Missing or out-of-bound usage retains its entire reservation and displays unknown cost.

Token/call mode requires explicit acknowledgement that dollars are not capped. Dollar mode fails closed without an exact destination/provider/model price policy that remains valid through the request window. `FORGE_BYOK_PRICES` is a JSON array using this schema (rates are integer microdollars per million tokens; $1 = 1,000,000 microdollars):

```typescript
{
  connectionProvider: string, baseUrl: string, modelId: string,
  version: string, expiresAt: string, // ISO timestamp
  inputMicrosPerMillion: number, outputMicrosPerMillion: number,
  cachedInputMicrosPerMillion: number, cacheWriteMicrosPerMillion: number,
  searchMicrosPerCall: number, inputTokenCeiling: number
}
```

Administrators must verify all billable rates and a conservative input ceiling for the exact model, including search context. Forge reserves that full input ceiling, output limit and maximum one search call before dispatch. Policies for aggregated/custom providers must cover every possible upstream charge; otherwise use token/call mode. No example price is silently installed. Financial guarantees depend on correct provider billing information and supported usage semantics; unknown charges are never presented as zero cost.

For the authorized internal campaign only, set `FORGE_BYOK_TEST_BUDGET_MICROS=10000000` on an isolated database and every process. All diagnostics and jobs must use dollar mode. A shared database row serializes reservations across accounts; settled amounts release only the unused portion once. Uncertain attempts retain liability. Campaign membership is stored on each attempt so changing process configuration cannot release the wrong reservation. Do not reset the ledger to obtain more budget.

## Local runtime and migration

Stop admission and drain current jobs before switching workers. Back up PostgreSQL and wrapping keys separately. Apply `npm run db:migrate`; migrations are additive and preserve project history. Start only one worker for the local runtime. Old queued model jobs cannot inherit server credentials; create a new run after configuring connections.

New applications use Next.js, TypeScript and a separate PostgreSQL sidecar. Build the new `forge-workspace:local` runtime image and install the configured `FORGE_APP_POSTGRES_IMAGE` before starting a build; job execution never pulls images. Image IDs are pinned in each revision. The candidate database is on its private internal network with no published port or host mount, bounded resources, dropped capabilities and a non-superuser application role. Generated `lib/generated/tests/*.ts` tests run with Node after the build, within the same sandbox and a 30-second limit; the starter includes a rolled-back PostgreSQL CRUD test. These checks do not prove complete product correctness. Only the candidate database URL enters generated code; Forge/model secrets do not. Backups use `pg_dump`/`pg_restore` as the restricted application role. Existing SQLite revisions retain their old pinned runtime, data format and restore path; moving their data to PostgreSQL requires a separate explicit migration.

The Docker adapter is a protected self-hosted development runtime. Local Docker tests do not establish hosted multi-tenant isolation. The existing hardened runner/hosted control integration still needs environment acceptance and an authenticated tenant-safe preview route before enabling hosted generation. No deployment engine is added by this change.

## Verification

`npm run verify` runs lint, both TypeScript checks, tests and a production build. Native PostgreSQL tests exercise non-superuser forced RLS, session revocation, competing rotations, duplicate dispatch, cancellation, unknown outcomes, Auto validation, recovery and atomic campaign reservations. Adapter tests use synthetic responses and do not certify live providers.

`npm run test:byok:browser` starts an isolated native PostgreSQL instance, a synthetic provider and a production Next.js server. It verifies connection persistence, model tests, routing and revocation plus light/dark layouts at 390/768/1440px, keyboard movement, reduced motion and a CSS zoom reflow simulation. Screenshots and logs remain in ignored `.private/byok-browser`. `npm run test:runtime` is the separate actual Docker build, CRUD, snapshot/restore and network-boundary check.

Before release, configure privately owned OpenAI, Anthropic and DeepSeek keys, current exact-model dollar policies and the shared $10 cap. Complete real research → code → review/repair → isolated verification, inspect citations and generated behavior, and retain redacted attempt/accounting evidence. Keep the PR draft until that campaign and hosted runtime acceptance pass. Other providers remain untested live unless explicitly recorded in the release evidence.
