# Forge AI working agreement

## Product
Forge turns a prompt into an editable full-stack app in an isolated local workspace. The first milestone proves generation, preview, one follow-up, and restore. Never present planned or fixture-only behavior as working functionality.

## Boundaries
Next.js routes in src/app are thin transport adapters. UI lives in src/components. Server-only providers, generation policy, database access, and workspace adapters live in src/server. Worker processes own long-running jobs. Generated templates live in templates and never execute in the control process. Ordinary PostgreSQL and Drizzle are the local data layer; hosted Neon and Better Auth are later. No AWS or Supabase.

## Security
Keys belong only in ignored .env.local and server memory. Never use NEXT_PUBLIC_ or VITE_ for secrets, echo secrets, upload evidence, or forward control-process environment to generated code. Generated paths, operations, dependencies, commands, and logs are untrusted. Validate before mutation. Containers receive only scoped storage, resource budgets, restricted networking, and no Docker socket. Local APIs must reject foreign origins and untrusted Host headers. Previews use a separate origin.

## Design
Preserve Forge's original charcoal, warm-white, and lime system. Study OpenCode, Spectrum UI, Cursor Bugbot, Hermes, Linear, and Raycast for individual interaction principles, never copied screens, marks, or trade dress. Use at most two locally served font families. Test keyboard access, visible focus, contrast, reduced motion, and 375/768/1440px layouts. No decorative fake controls or invented usage metrics.

## Validation and evidence
Run npm run verify before a milestone commit. Run npm run test:e2e for changed interactions. Inspect the actual app through computer use and capture screenshots locally in docs/evidence. Never capture provider key screens or secret editors. Record exact tests and caveats in docs/reports. Test security boundaries and meaningful behavior rather than mirroring implementation.

## Git
Use an isolated codex/ worktree, preserving unrelated changes. Review the complete diff, update the milestone report, and commit only a coherent passing milestone with a conventional message. Never push, publish, create remote resources, or enable paid services without approval. No greploop or greploop-apps. Adapt upstream evidence guidance to local-only artifacts; no automatic uploads. Do not spawn agents unless the user explicitly requests delegation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
