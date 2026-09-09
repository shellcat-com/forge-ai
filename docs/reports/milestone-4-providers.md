# Milestone 4 — Provider contracts and streaming

Date: 2026-09-09. Branch: codex/forge-ai-local. Parent: 87befb3. This report accompanies the provider commit.

## Implemented
Gemini and Ollama share provider/model/request/event contracts. Groq and OpenRouter are deferred IDs only. Added local-only model discovery and bounded streaming-test APIs, actual model selection in the provider panel, cancellation, output limits, typed sanitized failures, and bounded pre-stream retry handling. Gemini sends its key only in an HTTP header and requires an explicit server-selected model and free-tier confirmation. Ollama discovers only installed models at a validated literal loopback endpoint; it never downloads software or models.

## Measured verification
- npm run verify passed: lint, strict types, 18 unit/contract tests at production build time. An additional regression test was then added for Next.js URL normalization; lint, types, and all 19 tests passed.
- Browser suite: 6 passed, 1 explicit live-inference test skipped by default.
- Real Ollama adapter request: llama3.2:latest selected through discovery, four deltas, successful completion, five output tokens.
- Actual computer use: opened Providers, inspected discovered local models, clicked Test streaming, observed “Streaming verified: Forge is ready.” This independently verifies the API-to-browser path.
- Provider-panel screenshot saved locally in docs/evidence/providers.png and visually inspected.
- Initial browser testing found a legitimate local request rejected after Next.js normalized request.url. Host/Origin validation was corrected and regression-tested without relaxing the loopback or cross-origin boundary.
- .env.local remains ignored; all three provider credential variable names are absent from generated client JavaScript. No real provider key was read, logged, shown, or created. Error tests use synthetic sentinel values and confirm sanitized messages. No screenshots contain credentials.
- Complete implementation/configuration/documentation diff reviewed; git diff --check passed. npm dependency audit reports zero known vulnerabilities.

## Limitations and user setup
Gemini is implemented and fixture-tested but not live-tested: GEMINI_API_KEY is not configured. Google AI Studio was previously paused at terms acceptance. User-controlled authentication and explicit confirmation before key creation are still required; the user must enter the secret privately in .env.local, choose a discovered free-tier model, confirm eligibility, and restart Forge. Free-tier pricing/availability is account- and model-dependent; model discovery does not prove it. No billing, purchase, paid fallback, publishing, or pushing occurred.

Groq and OpenRouter setup is deliberately deferred. The project generator, database, sandbox, and restore are not part of this commit. Historical foundation screenshots were preserved.
