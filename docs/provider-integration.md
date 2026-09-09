# Provider integration

Gemini and Ollama implement the same ProviderAdapter contract: listModels and streaming generate with normalized delta/done events. Groq and OpenRouter are contract-only deferred provider IDs; no account setup is required for the first workflow.

## Local Ollama
Forge discovers installed models at http://127.0.0.1:11434. The smallest installed model is selected initially. No model IDs are hard-coded and no models are pulled. Requests are capped at 8192 output tokens, 180 seconds, and an 8192-token local context. Models unload after the request to preserve memory. Provider settings include a real streaming check. No cloud fallback occurs automatically.

## Gemini
Create a key only after explicit user confirmation in the official dashboard. The user enters it directly into ignored .env.local. Never paste it into chat or browser-facing variables. Forge reads GEMINI_API_KEY on the server; authentication uses a header rather than a URL query. Models are discovered from Google's API. After verifying the account has no billing and the chosen model is free for it, configure GEMINI_MODEL and GEMINI_FREE_TIER_CONFIRMED=true. Without this confirmation, generation is blocked. Model discovery does not establish pricing or account eligibility. Restart Forge after editing its environment.

Gemini is capped at 120 seconds and the requested/model output token limits. Only text parts that are not marked thought are emitted. No paid route is selected by fallback. Google's free-tier content/data-use terms apply. No Gemini live request has been verified without credentials.

Official references: https://ai.google.dev/api/models, https://ai.google.dev/api/generate-content, https://ai.google.dev/gemini-api/docs/pricing, https://docs.ollama.com/api/generate, https://docs.ollama.com/api/tags.

## Failure and security behavior
HTTP authentication errors, quota/rate limits, configuration errors, cancellation, timeout, malformed streams, and output limits have controlled messages. Provider response bodies and unknown error messages are never returned to the client. Transient pre-stream HTTP failures retry with bounded backoff; Retry-After over five seconds surfaces a quota error. No stream is silently restarted after partial output. Streams are capped at 2 MB. Cross-origin control requests and untrusted Host headers are rejected; redirects are disabled. Ollama endpoints must be literal loopback HTTP origins.

## Validation
Contract tests use synthetic fixtures. The live Ollama script prints only completion metadata, never raw model output or credentials. Browser tests include explicit opt-in LIVE_PROVIDER_TEST=1 for a real local inference request. This does not imply the full application-generation workflow is implemented.


## Unified application integration
The approved neutral interface in DESIGN.md is authoritative. Five design examples are optional. Hosted authentication, cloud execution, and publishing must be verified before being described as available. See docs/implementation-status.md.
