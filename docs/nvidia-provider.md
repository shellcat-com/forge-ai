# NVIDIA hosted plan generation

Status (2026-09-09): the local adapter path has been smoke-tested with a development key, and the enabled models returned HTTP 200 and nonempty plans through the local API. This is a local single-user prototype, not a deployed service for 1,000 users.

## Setup

1. Open [NVIDIA API keys](https://build.nvidia.com/settings/api-keys) and create a development key for local testing. Follow the access terms shown by NVIDIA for your account.
2. For a fresh installation, create a development key. One NVIDIA key can authenticate requests for multiple entitled models; separate keys do not establish additional quota.
3. Copy `.env.example` to `.env.local` and set `NVIDIA_API_KEY`. Keep this file private; it is ignored by Git. Use `chmod 600 .env.local`. Never put credentials in `VITE_` variables or browser storage.
4. Run `npm run api` in one terminal and `npm run dev` in another. Open `http://127.0.0.1:5173`.
5. Reload Forge, create or open a saved project, choose a model in AI planning, and generate a plan. A loaded key is not proof of entitlement; the first successful generation verifies access for that model.

The API server uses Node's `--env-file-if-exists=.env.local`. Restart it after replacing a key. Revoke expired/unneeded keys in NVIDIA settings. No billing details, payment method, paid subscription, or enterprise trial were added by this integration.

## Enabled models

The following cards were visibly marked **Free Endpoint** in NVIDIA Build:

- `deepseek-ai/deepseek-v4-flash-0731`
- `deepseek-ai/deepseek-v4-pro-0813`
- `nvidia/nemotron-3.5-lightning-30b-a3b`

The allowlist is in `server/provider.mjs`. It does not include partner endpoints or download-only models. Add entries only after verifying current hosted free access and a compatible text chat response. The catalog label is not a guarantee of account entitlement, continuing free availability, or capacity. There is no automatic paid fallback.

NVIDIA documents `POST https://integrate.api.nvidia.com/v1/chat/completions` in its [LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis). Its [quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart) explains multi-model key use. [Developer access documentation](https://docs.api.nvidia.com/nim/re/docs/run-anywhere) describes free hosted endpoints for prototyping; it does not establish capacity for a 1,000-user public application.

## API contract

- `GET /api/provider`: `{ provider, configured, models: [{id,name}], dailyLimit, scope }`. Contains no credential. `configured` only means a nonempty key is loaded.
- `POST /api/generate`: JSON `{name,prompt,template,model}`. Templates: `Next.js + Postgres`, `React + Express`, `Vue + FastAPI`.
- Success: `{text,model,truncated}`. Error: `{error}` with an appropriate HTTP error status.
- Output is a reviewable Markdown plan and optional code snippets. The server never executes model output, writes generated application files, or deploys applications. Clients must render output as text, not untrusted HTML.

## Boundaries and limits

- API binds to `127.0.0.1:3001`; Vite binds to `127.0.0.1:5173` and proxies `/api` with `changeOrigin: true`.
- Rejects unapproved Host/Origin headers and cross-site browser requests. These controls do not replace multi-user authentication.
- Fixed HTTPS NVIDIA destination, redirect refusal, no client-provided base URLs.
- One in-flight generation, 120-second deadline, client disconnect cancellation, 4,096 maximum requested output tokens, and bounded brief length.
- `FORGE_DAILY_REQUEST_LIMIT` defaults to 100 attempts/day. This is an in-memory local safeguard, resets at midnight UTC or process restart, and is not an NVIDIA quota or durable billing control. Provider errors still count as attempts.
- No automatic retries; a retry could consume additional quota. Rate limits and unavailable models return actionable errors.
- Prompts and API keys are not logged. Provider response error bodies are never reflected to the client.
- Existing Docker/Nginx configuration remains static-only and does not run or proxy this API. Do not treat `npm run preview` or the static container as a working provider deployment.

## Verification

`npx vitest run server` covers 19 cases: fixed destination, credentials, allowlist, error redaction, malformed/empty responses, truncation, cancellation, absent credentials, Host/Origin restrictions, input validation, local request budget, timeout, and concurrency. The HTTP tests use a stubbed upstream and do not prove NVIDIA account access.

Before key setup, the initial workspace was checked in the browser against the running API: it listed the three allowed models, showed “Key needed”, and disabled generation without a credential. `npm run verify` passed during the provider milestone; Vite reported an unrelated ancestor `tsconfig.json` warning about missing `expo/tsconfig.base`.

Live integration results on September 9, 2026, using a short task-list planning brief through `POST /api/generate`:

| Model | HTTP status | Output | Truncated |
| --- | --- | --- | --- |
| DeepSeek V4 Flash 0731 | 200 | Nonempty plan | No |
| DeepSeek V4 Pro 0813 | 200 | Nonempty plan | No |
| Nemotron 3.5 Lightning | 200 | Nonempty plan | No |

These are individual smoke-test observations, not benchmarks or throughput guarantees. `.env.local` is Git-ignored and should use mode 0600. Keys must never be placed in client source, browser storage, or logs. No billing information is required by Forge.

Browser end-to-end verification also passed: created a local connection-check brief in the redesigned Forge UI, selected DeepSeek Pro, generated through the Vite proxy, and observed a task-list implementation plan under “AI-generated plan”, with the explicit “Text only. No files created or checks executed.” notice.

Pending: verify actual account quotas. Public operation for 1,000 users additionally requires authentication, per-user quotas, persistent accounting, deployment work, and a provider capacity/usage plan; it cannot be inferred from a free API key.
