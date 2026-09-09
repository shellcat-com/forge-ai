# Milestone 8 — Groq provider

Date: 2026-09-09. Parent: 7a3a91e. Branch: codex/forge-ai-local.

## Implemented

Promoted Groq from a deferred provider ID to a complete server-side adapter. Forge authenticates with a Bearer header, discovers only the exact `GROQ_MODEL` allowlisted in server configuration, and exposes Groq in provider selection, generation APIs, the provider panel, and project follow-ups. Credentials remain confined to ignored `.env.local` and never enter generated containers or client JavaScript.

The provider uses the OpenAI-compatible Groq Chat Completions endpoint. Ordinary connection checks stream SSE with usage reporting. File generation uses strict JSON Schema with `openai/gpt-oss-20b`; Groq's documented structured-output path does not currently support streaming, so Forge consumes one bounded response and emits it through the provider-neutral event contract. Full file-operation validation still completes before writes. Cancellation, 120-second provider timeouts, token limits, retries, sanitized errors, and explicit Ollama fallback for quota, availability, or timeout failures are preserved.

Project reloads now retain the latest generation provider and model for follow-up requests. This prevents a Groq-created project from silently displaying or using another globally preferred provider after the page is reopened.

References: [Groq API reference](https://console.groq.com/docs/api-reference), [supported models](https://console.groq.com/docs/models), and [structured outputs](https://console.groq.com/docs/structured-outputs).

## Live verification

- Authenticated model discovery returned active `openai/gpt-oss-20b` with a 131,072-token context window and 65,536 maximum completion tokens.
- A live SSE request returned `Forge is ready.` and terminal usage. A separate live strict-schema request returned `{"ok":true}`.
- A complete Spark Ledger website generation ran through Groq, produced validated file operations, installed only locked dependencies offline, built in the restricted container runtime, and promoted revision `bdc0587c-382e-40fc-bffc-40d8a1c46f03`.
- `npm run verify` passed lint, type checking, all 55 unit/contract/security tests, and the production build. Contract coverage includes strict and streaming Groq responses, allowlisted model discovery, bounded non-streaming response bodies, and explicit Ollama fallback.
- The browser suite passed 10 tests with three optional workflows skipped. It exercised the real Groq project after a worker restart, confirmed the restored isolated preview, verified the retained Groq follow-up model, saved and removed an item through the generated interface and isolated SQLite API, checked responsive provider views at 375, 768, and 1440 pixels, and saved `docs/evidence/groq-workflow-1440.png`.
- The live workspace and isolated preview were inspected directly. The generated website contains a responsive idea form wired to the existing SQLite items API and reports a live preview. The production provider panel also returned `Streaming verified: Forge is ready.` from its Groq control.

## Security and limits

The supplied key is stored only in ignored, mode-600 `.env.local`. `GROQ_MODEL` prevents arbitrary submitted model IDs, response bodies are excluded from provider errors, and the key does not appear in tracked files. Groq account pricing and rate limits remain external account settings; Forge does not enable billing.
