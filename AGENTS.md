# Forge AI

Forge is a Vite + strict TypeScript frontend. An optional loopback NVIDIA API prepares text plans. It has no authentication server, code execution, or deployment engine. Keep these boundaries visible. Sample walkthroughs are deterministic fixtures, never provider results.

## UI work
Read DESIGN.md and skills/forge-design/SKILL.md before changing Forge UI. For project presets, also read skills/forge-project-design/SKILL.md. Use semantic CSS tokens and shared components. Keep project preview styles scoped; changing a project preset must never change Forge chrome. Update the specification when intentionally changing the system.

## Architecture
- src/main.ts owns hash navigation and event coordination.
- src/pages and src/components render escaped markup; never interpolate unescaped user data.
- src/storage.ts owns validated, versioned local persistence.
- server/ owns the separately configured NVIDIA text-planning API; preserve its loopback and secret-handling boundaries.
- src/project.ts keeps draft normalization and provider-readiness decisions.
- src/design owns presets; src/demo.ts owns sample fixtures.

## Checks
Run npm run verify. For behavior changes, verify the affected browser flow. For visual changes, inspect light and dark at 390, 768, and 1440px, keyboard focus, zoom, and reduced motion. Record material limitations truthfully. Never add credentials to client code or imply authentication from local demo state.

## Reusable skills
Repository skills are authoritative. Use npm run skills:sync to install copies in the local Codex skills directory. Preserve unrelated skills.
