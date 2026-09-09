# Milestone 3: GitHub repository polish

Date: 2026-09-09

## Implemented

- Reworked `README.md` into a public project front door with Forge branding, real screenshots, a concise product explanation, feature list, architecture diagram, provider status, local and Docker setup, environment variables, quick start, self-hosting, security model, limitations, roadmap, testing, contribution, license, and acknowledgements.
- Added GitHub issue templates for bug reports and feature requests.
- Added a pull-request template that asks contributors to record validation, security impact, and visual evidence.
- Added Dependabot configuration for npm packages and GitHub Actions.
- Added CI workflow coverage for linting, strict type checking, tests, and production builds on Node 20 and 22.
- Expanded `.env.example` with the current NVIDIA prototype variables and reserved future server/runtime paths.

## Architectural decisions

- Kept repository claims constrained to shipped code and checked-in evidence.
- Listed NVIDIA as a prototype adapter rather than a fully supported provider.
- Kept OpenClaw and OpenCode as presentation references only; Forge uses original brand assets, screenshots, and copy.
- Used a single `CI` workflow with explicit steps instead of hiding validation behind only `npm run verify`, so contributors can see which phase fails.
- Kept GitHub issue templates narrow and security-aware to avoid public disclosure of credentials or private briefs.

## Tests performed

- `npm run verify` passed on 2026-09-09.
- Verification included ESLint, strict TypeScript, 33 Vitest tests, and a production Vite build.
- Vite/Vitest emitted the known unrelated ancestor `tsconfig.json` warning about missing `expo/tsconfig.base`.

## Screenshots captured

- Reused checked-in captures from `docs/design/screenshots/`:
  - `landing-1440-light.jpg`
  - `login-1440-light.jpg`
  - `presets-1440.jpg`

## Known limitations

- README screenshot coverage uses static images, not a demo GIF.
- The repository was created at `https://github.com/shellcat-com/forge-ai`; merge and branch-protection behavior depends on the default GitHub settings for that new repo.

## Next milestone

- Configure the GitHub repository remote if missing, push the polished baseline, and open/merge a review path according to the repository's branch protection settings.
