# Forge AI

A local, single-user workspace for turning prompts into editable full-stack applications. Next.js, React, TypeScript, Tailwind, PostgreSQL and Drizzle power Forge; a separate Node worker builds generated Next.js applications in isolated Docker containers with SQLite storage.

## Working locally

Use Node **24.21.0 LTS**, pinned in `.nvmrc` and `.node-version`. Docker must be running. Existing Ollama models are discovered automatically; Forge never installs or downloads a model.

```sh
nvm install
nvm use
npm ci
npm run setup:local
npm run db:migrate
npm run runtime:build
npm run build
npm start
```

In another terminal, run `npm run worker`. Open [Forge](http://127.0.0.1:3000). For development, use `npm run dev` instead of building and starting the production server. All listeners bind to loopback.

`setup:local` creates a dedicated local PostgreSQL container, volume and private database credential in ignored `.env.local`. It preserves existing environment settings. The initial runtime image build downloads the trusted, locked dependencies; subsequent generated builds install from that image's offline cache. The Docker image uses Node 24.20.0 from its pinned official digest; host tools use 24.21.0. No remote infrastructure is created.

## Workflow

Choose an installed Ollama model or a configured Gemini, Groq, or OpenRouter model, describe the app, and build. Forge stores the job and streamed timeline in PostgreSQL, validates the complete file batch, builds a candidate container and promotes it only after it serves a successful response. The interface includes a file explorer, locally served Monaco editor, responsive preview, build logs, follow-up prompts and revision history.

The worker runs one build and one live preview at a time. It checkpoints the current SQLite database before a change, pauses the preview to free memory, and rebuilds the previous working version if a candidate fails. Restore keeps source, the runtime image/lockfile and a consistent database snapshot together. Worker restarts mark interrupted jobs failed and resume the last retained revision; reconnecting browser streams replay saved events.

The first generated stack is deliberately constrained: a trusted Next.js shell, React/CSS, server routes and an existing SQLite collection API. The model currently generates page and stylesheet changes. The editor also supports allowed component and server-route files. Package/configuration changes and arbitrary commands are rejected. Small local models can miss design requirements or return invalid code; a passing build does not guarantee that every requested product behavior was implemented.

## Providers and privacy

Gemini is the only required cloud adapter. Configure its key privately in ignored `.env.local` using the placeholder names in `.env.example`, then restart the web server and worker. Confirm your selected model's free-tier eligibility before setting `GEMINI_FREE_TIER_CONFIRMED=true`; Forge does not activate billing. Authenticated Gemini discovery has been verified in this workspace, while generation is currently blocked by the Google project's depleted prepayment credits. Complete generation workflows have been verified with Groq `openai/gpt-oss-20b` and installed Ollama `llama3.2:latest`.

Model discovery, streaming, cancellation in the provider check, bounded retries, timeouts and output limits are implemented. Gemini and Groq quota/unavailability/timeout failures explicitly switch to an available local Ollama model and discard partial output.

Groq is an optional implemented provider. Store its key in ignored `.env.local` and configure one exact `GROQ_MODEL`; Forge rejects other model IDs. The default `openai/gpt-oss-20b` model supports strict JSON Schema output. Groq currently does not combine streaming with strict structured output, so Forge streams ordinary provider checks and uses one bounded non-streaming response for strict file-operation generation. The complete batch still passes Forge's validation before any file is written.

OpenRouter is an optional implemented provider. Place its key only in ignored `.env.local` and set one exact `OPENROUTER_MODEL`; Forge rejects other model IDs. Because OpenRouter models may consume credits, review the current catalog pricing and set `OPENROUTER_PAID_MODEL_CONFIRMED=true` only after accepting that cost. The configured default in `.env.example` is `openai/gpt-4o`, which was present in the catalog and advertised structured output when this integration was verified. Forge uses strict JSON Schema output, requires a route supporting that parameter, and reports authentication, credit/quota, timeout, malformed-stream and output-limit failures without exposing the provider response body. OpenRouter model discovery and a live streaming completion were verified. A full GPT-4o generation requires an OpenRouter key with paid-model credit.

Secrets stay in the control processes. Generated containers receive no provider keys, host mounts, Docker socket or Forge database connection. They use non-root execution, resource limits, read-only roots and an internal network. A trusted relay and loopback preview proxy expose the application on a separate origin with restrictive browser policy. This is a local developer tool, not a hosted multi-user sandbox.

SQLite checkpoints run every ten seconds and before controlled transitions. An abrupt host/worker crash can lose writes since the last successful checkpoint. Keep saved runtime images available for restoration; deleting Docker images or the PostgreSQL volume can make recovery impossible. This project does not perform those deletions automatically.

## Verification

```sh
npm run verify
npm run test:e2e
npm run test:runtime
```

The runtime integration test builds disposable containers and verifies SQLite restore and network isolation. Browser tests use installed Google Chrome; `PLAYWRIGHT_CHANNEL` can select another installed supported browser. To include real-project UI checks, set `FORGE_WORKFLOW_PROJECT` to an existing generated Field Notes project. `FORGE_TEST_URL` targets an already-running web server; otherwise tests launch production on port 3100.

`scripts/test-generation.ts` and `scripts/test-revisions.ts` exercise real local inference, durable jobs, replay, follow-up, source/data restoration and failed-build recovery. They require the running worker, Docker, PostgreSQL and installed Ollama; they create local test revisions. See [milestone reports](docs/reports), [design system](docs/design-system.md) and [working agreement](AGENTS.md) for evidence and boundaries.

Hosted authentication, other generated stacks and hosted deployment are deferred. No AWS, Supabase, paid fallback, pushing, publishing or automatic evidence uploads.

MIT licensed. See LICENSE.
