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

## Limitations at the original milestone
Gemini was implemented and fixture-tested but not live-tested because `GEMINI_API_KEY` had not yet been configured. Google AI Studio was paused at terms acceptance. Free-tier pricing and availability remained account- and model-dependent; model discovery alone could not prove eligibility. No billing, purchase, paid fallback, publishing, or pushing occurred.

Groq and OpenRouter setup is deliberately deferred. The project generator, database, sandbox, and restore are not part of this commit. Historical foundation screenshots were preserved.

## Live Gemini setup update — 2026-09-09

The user supplied and authorized a Gemini key for the Forge project. Forge now stores it only in ignored, mode-600 `.env.local`, pins `gemini-flash-latest`, and enables the explicit Gemini-use gate. Authenticated discovery succeeded and returned the configured model with a 65,536-token output limit. The production interface lists Gemini as available and selects that exact model; all other discovered Gemini models remain disabled by the configured-model allowlist.

The first adapter and UI streaming checks reached Google but returned HTTP 429 `RESOURCE_EXHAUSTED`: the project's prepayment credits are depleted. This is an account billing state rather than an implementation or authentication failure. Full Gemini generation remains blocked until credit is added in Google AI Studio. Ollama remains the working offline generation path.

The supplied API-key screenshot is preserved at `.private/evidence/gemini-api-key-details.png`. The directory is ignored by Git and both the screenshot and `.env.local` use owner-only file permissions. No credential or key screenshot is present in tracked files.

After configuration, `npm run verify` passed lint, type checking, all 48 unit/contract/security tests, and the production build. The browser suite passed 9 tests with three optional real-workflow tests skipped, including responsive provider views at 375, 768, and 1440 pixels. The production provider UI was also inspected directly and showed Gemini Flash Latest selected before reporting the sanitized quota message from its live streaming control.
