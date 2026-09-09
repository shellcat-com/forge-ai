# Milestone 7 — OpenRouter provider

Date: 2026-09-09. Parent: ae85d83. Branch: codex/forge-ai-local.

## Implemented

Promoted OpenRouter from a neutral deferred ID to a full server-side provider. It discovers the single configured model, authenticates with a Bearer header, streams OpenAI-compatible chat-completion SSE, supports cancellation and shared timeout/output budgets, and uses strict JSON Schema generation with `require_parameters` routing. Only `OPENROUTER_MODEL` can be submitted, limiting accidental use of arbitrary paid models. The UI and generation APIs now accept OpenRouter and show its explicit setup and model state.

Added an explicit `OPENROUTER_PAID_MODEL_CONFIRMED` gate. A key and model alone cannot send a request until the user confirms current pricing. HTTP 402 and streamed 402/429 failures become the existing actionable quota error; authentication, transient availability, malformed/truncated streams and token limits remain typed and sanitized. Optional attribution identifies the loopback Forge application without sending project content in headers.

The user explicitly authorized local configuration and paid use of the supplied key. It is stored only in ignored, mode-600 `.env.local`; tracked files contain no credential. The authenticated catalog confirmed `openai/gpt-4o` exists, advertises `structured_outputs`/`response_format`, and allows 16,384 output tokens. A live five-token completion returned `Forge is ready.` through both the adapter and the actual provider UI.

The live catalog also exposed nullable metadata on unrelated models. Discovery now bounds the catalog as unknown entries, selects the configured ID, and strictly validates only that entry. This preserves malformed-target rejection without letting unrelated catalog records disable the configured model.

References: [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [models API](https://openrouter.ai/docs/guides/overview/models), and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

## Verification

- `npm run verify` passed: lint, type checking, 48 unit/contract/security tests, and the production build.
- Provider contract fixtures cover configured-only discovery, header authentication without URL leakage, structured SSE deltas, terminal usage, strict JSON Schema routing, unconfigured-model rejection, paid-use gating, and streamed credit errors.
- Existing Gemini/Ollama, local API, file validation, preview isolation, revision and browser tests remain passing. `npm audit --audit-level=moderate` reports zero vulnerabilities.
- The production provider/browser suite passed 9 tests with three optional real-workflow tests skipped. Provider UI was inspected at 375, 768 and 1440 pixels and captured locally without credentials. The live UI reported `Streaming verified: Forge is ready.` Foreign-origin rejection and keyboard behavior remain passing.
- A full structured GPT-4o revision reached OpenRouter but received its credit/quota response. Forge recorded the failed job and restarted the previous working preview, verifying recovery without applying a partial revision. The recovered interface and unchanged application are captured in `docs/evidence/openrouter-recovery.png`. The authenticated key metadata identifies the key as free tier with no configured credit limit, so full paid-model generation is blocked until the OpenRouter account has credit.

## Remaining external action

Add credit to the OpenRouter account that owns the configured key. No repository change is required. After credit is available, restart is unnecessary: submit the revision again with OpenRouter selected.

The local configuration is:

```dotenv
OPENROUTER_API_KEY=<configured locally>
OPENROUTER_MODEL=openai/gpt-4o
OPENROUTER_PAID_MODEL_CONFIRMED=true
```

The final value authorizes credit-consuming requests. The key value is intentionally omitted from this report.
