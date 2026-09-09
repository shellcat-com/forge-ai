# Milestone 5 — Isolated execution foundation

Date: 2026-09-09. Parent: b3d53a8. Branch: codex/forge-ai-local.

## Implemented
Dedicated PostgreSQL 17 with private local credentials, readiness wait, checksummed transactional migrations, and Drizzle schema for projects/revisions/jobs/events/runtime state. The Docker workspace adapter validates file batches, runs a trusted fixed Next.js template with offline dependency installation, and supports native SQLite backup/restoration. Generated code receives no host mounts or secrets. Added bounded temporary storage, memory/CPU/process limits, read-only root, dropped capabilities, internal network, and a constrained TCP preview relay. Docker logs are capped to 2 MB per container.

The official Node 24.21.0 Docker tag was unavailable. Images now pin the official Node 24 LTS digest ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e, reporting Node 24.20.0. Host tooling remains pinned to 24.21.0. Both are tested on ARM64.

## Verification
- npm run verify passed: lint, types, 34 unit/contract/security tests, production build.
- Dedicated PostgreSQL readiness and checksummed migration succeeded. Initial immediate connection failure was corrected with a readiness wait and sanitized connection errors.
- npm run runtime:build succeeded with a fixed package lock and populated offline npm cache.
- npm run test:runtime passed: offline install, Next.js production build, HTTP root, SQLite create/read, live consistent backup, restoration into a fresh container, configured memory/pid/capability/read-only settings, no secret environment variables or host mounts, and blocked requests to the internet and host ports 3100/11434.
- The first internal-network port test failed; a separate trusted TCP relay fixed preview connectivity without granting generated workloads outbound networking.
- The first build failed because noexec tmpfs blocked the installed native compiler. Executable workspace tmpfs corrected native module loading; no dependency-download escape was added.
- npm audit --audit-level=moderate: zero vulnerabilities. Removed unused migration/code-editor tooling pending its milestone rather than retaining vulnerable unused dependencies.
- Source/configuration/security diff reviewed, including root-anchored workspace ignores so the adapter cannot be accidentally excluded from Git. git diff --check passed.

## Remaining work
The generator UI and durable worker are not connected in this milestone. Container preview is an integration-test capability, not advertised as a working UI action. Source/storage persistence and preview browser policy are connected in the next milestone. The main Forge Dockerfile has not yet been container-tested. No cloud key, billing, external resource, publish, push, or unrelated-container deletion occurred.
