# Milestone 3 — Next.js foundation

Date: 2026-09-09. Branch: codex/forge-ai-local. Parent: b83175f. This report describes the accompanying foundation commit.

## Implemented
Next.js 16.3.4, React 19, Tailwind 4; Node 24.21.0 LTS pinned in .nvmrc/.node-version and Dockerfile. The official Darwin ARM64 binary was verified against the vendor SHA256 manifest and installed outside the repository because the existing Homebrew node@24 link resolved to Node 25.

The original Forge mark and charcoal/lime identity are retained. Manrope and DM Mono are served locally. Prompt starters populate the editable composer; provider navigation and keyboard skip navigation work. The generation button remains disabled. Added AGENTS.md, original design tokens, responsive controls, local evidence, and a standalone-server startup script. Updated stale Vite/Nginx documentation and deployment files.

## Evidence
- npm run verify: lint, strict type checking, 2 unit tests, production build passed on Node 24.21.0.
- npm run test:e2e: 5 tests passed against the production server.
- Actual computer-use inspection: starter selection populated the prompt and focused it; provider navigation opened the provider panel.
- Screenshots: ../evidence/foundation-375.png, foundation-768.png, foundation-1440.png. Desktop and mobile images were visually inspected.
- npm install audit: zero known vulnerabilities.
- Complete source/config/documentation diff reviewed; lockfile updates come from npm. git diff --check passed.

## Docker recovery
Engine API requests returned HTTP 500 under API versions 1.51 and 1.44. Docker Desktop restart timed out after 45 seconds, but the engine subsequently recovered. The health endpoint returned OK and docker info reported server 28.3.2, aarch64, approximately 7.65 GiB available to its VM. Existing unrelated containers were not changed or deleted. No reset, prune, volume removal, or diagnostics upload was performed.

## Limits
No provider adapter, database, worker, generation, preview, or restore is claimed here. Docker packaging has not yet been built/tested. The Vitest configuration loader still warns about an ancestor Expo tsconfig outside this repository; tests and the Next.js production build pass. No cloud credentials were read or created. Historical milestone reports remain historical evidence.
