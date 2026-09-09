# Milestone 7 — OpenRouter provider

Date: 2026-09-09. Parent: ae85d83. Branch: codex/forge-ai-local.

## Implemented

Promoted OpenRouter from a neutral deferred ID to a full server-side provider. It discovers the single configured model, authenticates with a Bearer header, streams OpenAI-compatible chat-completion SSE, supports cancellation and shared timeout/output budgets, and uses strict JSON Schema generation with `require_parameters` routing. Only `OPENROUTER_MODEL` can be submitted, limiting accidental use of arbitrary paid models. The UI and generation APIs now accept OpenRouter and show its explicit setup and model state.

Added an explicit `OPENROUTER_PAID_MODEL_CONFIRMED` gate. A key and model alone cannot send a request until the user confirms current pricing. HTTP 402 and streamed 402/429 failures become the existing actionable quota error; authentication, transient availability, malformed/truncated streams and token limits remain typed and sanitized. Optional attribution identifies the loopback Forge application without sending project content in headers.

The supplied key was pasted into chat and therefore treated as exposed. It was not written to the repository or `.env.local`, not used for model discovery, and not sent in a completion. The public official catalog confirmed `openai/gpt-4o` exists, advertises `structured_outputs`/`response_format`, and has nonzero prompt/completion pricing. Live authentication and paid inference remain intentionally unverified.

References: [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [models API](https://openrouter.ai/docs/guides/overview/models), and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

## Verification

- `npm run verify` passed: lint, type checking, 48 unit/contract/security tests, and the production build.
- Provider contract fixtures cover configured-only discovery, header authentication without URL leakage, structured SSE deltas, terminal usage, strict JSON Schema routing, unconfigured-model rejection, paid-use gating, and streamed credit errors.
- Existing Gemini/Ollama, local API, file validation, preview isolation, revision and browser tests remain passing. `npm audit --audit-level=moderate` reports zero vulnerabilities.
- The production browser suite passed 11 tests with one optional real Ollama inference test skipped. Production provider UI was inspected at 375, 768 and 1440 pixels and captured locally without credentials. Foreign-origin rejection, keyboard behavior, Monaco editing, live preview and revision rebuilding remain covered.
- Live OpenRouter completion is pending a fresh privately configured key and explicit paid-use confirmation.

## Required private setup

Revoke the exposed key in OpenRouter, create a replacement, and add these values directly to ignored `.env.local`:

```dotenv
OPENROUTER_API_KEY=<fresh replacement key>
OPENROUTER_MODEL=openai/gpt-4o
OPENROUTER_PAID_MODEL_CONFIRMED=true
```

The final value authorizes credit-consuming requests. Restart both the web server and worker, open Providers, and run Test streaming before selecting OpenRouter for generation.
