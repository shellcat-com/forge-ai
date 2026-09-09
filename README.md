# Forge AI

A local-first workspace for turning ideas into editable full-stack applications.

## Current status

The Next.js foundation is implemented: responsive prompt composer, editable starter prompts, provider navigation, local fonts, keyboard focus, and local production builds. Gemini and Ollama adapters, model discovery, and streaming checks are implemented. Ollama streaming is verified locally; Gemini requires private credentials and remains unverified. Application generation stays disabled until isolated execution is implemented. No feature is represented by a simulated successful build.

## Development

Use Node **24.21.0 LTS**, recorded in `.nvmrc` and `.node-version`.

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The development and production commands bind to loopback. `npm run build` creates the production application; `npm start` serves it.

```sh
npm run verify
npm run test:e2e
```

Browser tests use installed Google Chrome by default. Override `PLAYWRIGHT_CHANNEL` for another installed supported browser. Tests start a production server on port 3100 and capture actual screenshots under `docs/evidence`.

## Implementation boundaries

Next.js, React, TypeScript, Tailwind. Dedicated PostgreSQL/Drizzle schema, isolated Docker workspaces, a trusted Next.js template, and SQLite snapshot/restore are implemented and integration-tested. The durable worker and generator UI are next. Gemini is the required cloud provider; existing Ollama is the offline fallback. Groq and OpenRouter setup does not block the first complete workflow. Hosted Neon and Better Auth follow local validation. No AWS or Supabase.

Provider secrets belong only in ignored `.env.local`, never `NEXT_PUBLIC_*`, the browser, generated applications, logs, or screenshots. See [AGENTS.md](AGENTS.md), [design system](docs/design-system.md), and milestone reports for development rules and measured evidence.

The Dockerfile now builds a standalone Next.js server. Container execution requires a healthy Docker engine and must be verified before being described as working. No deployment or remote resources are created by setup.

MIT licensed. See LICENSE.
