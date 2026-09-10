# Provider integration

**Current application path:** See [user-owned connections and orchestration](byok-orchestration.md). `src/server/byok` now owns live application dispatch; saved connections replace environment credential selection, including native OpenAI, Anthropic and DeepSeek adapters. The older registry described below remains regression/reference code and is not the application generation entry point. Hosted building remains disabled pending runtime acceptance.

## Historical server-configured registry

The Next.js application's `src/server/providers/registry.ts` registers **Gemini, Groq, OpenRouter and Ollama**. Each has implemented model discovery and generation code; Groq and OpenRouter are not deferred contract-only IDs. This inventory describes source code, not current account entitlement, universal model compatibility or live release qualification.

## Application adapters

| Adapter | Server configuration | Implemented boundary |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FREE_TIER_CONFIRMED` | Discovers models, restricts generation to the configured model and confirmation flag, normalizes text events. The flag is a software gate, not evidence of current pricing or free-tier eligibility. |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` | Discovers and selects the exact configured active model; implements streamed text and schema-constrained output only for its explicitly recognized strict-model set. |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_PAID_MODEL_CONFIRMED` | Restricts requests to the configured model, requires the paid-use confirmation flag, checks advertised structured-output support and streams normalized events. |
| Ollama | `OLLAMA_BASE_URL` | Requires a literal loopback HTTP origin; discovers installed models and selects an installed model without automatically downloading one or choosing a cloud fallback. |

The registry reports unconfigured providers as unavailable. Model discovery does not prove generation, pricing, cancellation, resource capacity or the complete app-building flow. Protocol support depends on each adapter and exact model; similar endpoints do not imply arbitrary model/stack compatibility. The required first generated stack remains Next.js + strict TypeScript + PostgreSQL.

Application transport has bounded request/stream parsing, cancellation/timeouts, controlled error messages and redirects disabled. Bounded retries before streaming must not be confused with the RFC accounting adapter's dispatch rules. Provider responses and unknown errors are not suitable raw diagnostics. Inspect `src/server/providers/transport.ts` and individual adapters for exact limits; do not extend them by configuring an arbitrary external URL.

## Credential and spending requirements

Keep application provider keys in ignored server configuration or an approved secret reference. Never paste keys into chat, browser-facing variables, client storage, generated source, preview content, exports, logs or public reports. Restart the local server after configuration changes. Hosted tenant BYOK needs authenticated TLS submission and scoped encrypted handling; environment-based local configuration is not that complete hosted flow.

Provider account/model entitlement and current prices must be verified before live use. A free/paid confirmation flag, a BYOK key or a successful catalog request is not a numeric spending authorization. Live tests require an applicable explicit budget and bounded usage. No credit sales, subscription checkout or Forge billing product is required by BYOK; abuse controls, liability retention and usage limits remain necessary. Provider credentials are separate from deployment credentials.

## Separate RFC source-generation composition

`engine/contracts/provider.ts`, `engine/providers/` and `engine/generation/` contain versioned source-generation contracts, an administrator-restricted registry, bounded chat-completions transport, encrypted versioned credentials and per-call accounting modules. The candidate `openai` policy restricts its source-code endpoint/model; that restriction is not a current model-availability or price claim. See the [RFC provider README](../engine/providers/README.md) and [combined provider matrix](operations/demo-readiness.md#provider-matrix-at-the-combined-source-audit).

These modules are not automatically registered with the application's provider registry or production worker. The actual production dispatch gate, current authority, shared migrations, credential routes, global/uncertain-liability cleanup and validated live source stage remain unconnected. The RFC entrypoint is explicitly fixture-only when enabled. Supplying a key cannot bypass that composition or authorize a real runner job. The optional loopback NVIDIA service remains text planning only.

## Validation and release status

Contract and native tests use clearly labeled synthetic providers, identities and accounting gates. Opt-in live tests remain separate, require approved configuration/budget, and must record exact source/model/policy and outcomes. A local inference request does not establish the full hosted generation, persistence, preview and publishing flow.

The [baseline report](reports/demo-delivery/task-01-baseline.md) records clean combined verification and its limitations. The [release board](operations/forge-release-coordination.md) owns the new staged-target and integration dependencies. Preserve existing implementation/evidence while keeping unsupported capabilities unavailable; do not promote fixtures or the Vercel availability page to live-provider acceptance.
