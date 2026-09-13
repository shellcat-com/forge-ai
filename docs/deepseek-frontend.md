# Direct DeepSeek frontend experiment

This optional loopback flow adds a standalone frontend generator to Forge's local workspace. It does not provision a backend, authentication, checkout payments, execution environment or deployment.

## Run locally

In ignored `.env.local`, set `FORGE_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` to your server-side key. Never prefix credentials with `VITE_`. Start `npm run api` and `npm run dev`, then open http://127.0.0.1:5173. Enter the demo workspace, create a brief and choose **Generate website** in its Plan tab. The request sends the brief to the selected DeepSeek model. The local API preserves its Host/Origin checks, one-request concurrency limit, daily request budget, cancellation and redacted errors.

Models: `deepseek-flash` and `deepseek-v4-pro`, observed from the account's model-list endpoint during this integration. API protocol reference: https://api-docs.deepseek.com/api/create-chat-completion/ . The adapter uses a fixed https://api.deepseek.com endpoint and refuses redirects; NVIDIA remains the default when no provider is selected.

## Output boundary

A successful website response must be a complete HTML document, within the output limit and not truncated. That validation is structural, not a code-security certification. HTML source is escaped before display. The live preview uses `sandbox="allow-scripts"` without same-origin, forms, popups, downloads or top navigation. A policy inserted before generated content blocks network connections and forms and permits only inline styles/scripts and approved local marketplace images. Generated CSS is confined to the iframe. Provider output never runs on the API server.

**Download website** embeds the five approved marketplace WebP files when referenced. The exported HTML executes its own JavaScript when opened, so review it before hosting. Arbitrary additional assets are not packaged. Generated sources remain in tab memory; project briefs use the existing validated local storage. Download before refreshing or closing the tab.

## Respawn showcase

The original request/response, exported HTML, captures and edited film are in `output/respawn/`. The artifact is a frontend concept with functional in-memory interactions. Demo login only collects a display name; checkout creates a demo order without charging or submitting personal data. Generated artwork was produced with the built-in GPT image tool and compressed to WebP. See `public/marketplace/provenance.json` for prompts and byte sizes.
