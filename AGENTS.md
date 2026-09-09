# Forge AI working agreement

## Architecture
Next.js routes are thin adapters. React UI lives in src/components; providers, generation, database access, and sandbox adapters live in src/server. Workers own durable jobs. Generated apps never execute in the control process. Preserve local PostgreSQL and restricted Docker. Neon and Better Auth provide hosted persistence and identity. No AWS or Supabase.

## Design
Read DESIGN.md and skills/forge-design/SKILL.md before UI changes. Read skills/forge-project-design/SKILL.md for examples. Preserve approved neutral palettes, IBM Plex Mono, artwork, themes, semantic tokens, and 160ms motion. Generated project styles remain isolated. Examples are optional; no forced Technical Mono fallback. Never describe fixtures or unavailable services as real results.

## Security
Secrets belong only in ignored .env.local or server secret storage, never in browser bundles, evidence, or model context. Preserve loopback Host/Origin checks locally and server authorization in hosted mode. Validate untrusted paths, dependencies, logs, and output. Sandboxes have no control credentials, Docker socket, or host access.

## Checks
Run npm run verify and affected browser flows. Inspect both themes at 390/768/1440, narrow reflow, keyboard focus, zoom, and reduced motion. Record exact results and limitations in docs/reports. Preserve existing tests and source/data migration paths.

## Git
Resume codex/forge-unified. Preserve both source histories and unrelated work. Commit coherent verified milestones. Never push or purchase services without authorization. User has authorized the named Neon replacement and Better Auth setup. Do not spawn agents unless explicitly requested.

## Next.js
Read relevant guides in node_modules/next/dist/docs before framework changes. Use awaited route params and current documented APIs.
