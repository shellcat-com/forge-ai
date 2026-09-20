# Forge AI working agreement

## Architecture
Next.js routes are thin adapters. React UI lives in src/components; providers, generation, database access, and sandbox adapters live in src/server. Workers own durable jobs. Generated apps never execute in the control process. Preserve local PostgreSQL and restricted Docker as the existing local workflow. The RFC engine retains its separately configured control service and hardened runner contracts; Docker alone is not RFC isolation acceptance. Neon and Better Auth provide hosted persistence and identity. No AWS or Supabase.

Vercel is selected for Forge and public generated portfolio website hosting; BYOK is included; do not buy a domain. Worker/storage/sandbox/private-preview and public multi-user generation decisions remain separate. See RFC 0001 §0.

## Design
Read DESIGN.md and skills/forge-design/SKILL.md before UI changes. Read skills/forge-project-design/SKILL.md for examples. Preserve approved neutral palettes, IBM Plex Mono, artwork, themes, semantic tokens, and 160ms motion. Generated project styles remain isolated. Examples are optional; no forced Technical Mono fallback. Never describe fixtures or unavailable services as real results.

## Security
Secrets belong only in ignored .env.local or server secret storage, never in browser bundles, evidence, or model context. Preserve loopback Host/Origin checks locally and server authorization in hosted mode. Validate untrusted paths, dependencies, logs, and output. Sandboxes have no control credentials, Docker socket, or host access.

## Checks
Run npm run verify and affected browser flows. Inspect both themes at 390/768/1440, narrow reflow, keyboard focus, zoom, and reduced motion. Record exact results and limitations in docs/reports. Preserve existing tests and source/data migration paths.

## Git
For demo delivery, branch from the published Task 01 canonical commit in docs/operations/demo-delivery-coordination.md. Task 01 owns integration, shared contracts, migration numbering and dependency manifests. Do not resume an obsolete branch for new task work. Preserve both source histories and unrelated work. Commit coherent verified milestones. Never push or purchase services without authorization. User has authorized the named Neon replacement and Better Auth setup. Do not spawn agents unless explicitly requested.

## Next.js
Read relevant guides in node_modules/next/dist/docs before framework changes. Use awaited route params and current documented APIs.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
