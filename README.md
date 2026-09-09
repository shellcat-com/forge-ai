# Forge AI

A workspace for turning ideas into editable websites and web applications.

The unified Next.js application combines the approved Forge interface with the existing local generation engine. Generated apps run in restricted Docker workspaces. Examples provide optional inspiration rather than mandatory templates.

## Development

Use Node 24. Run `npm install`, `npm run setup:local`, `npm run db:migrate`, `npm run runtime:build`, then run `npm run worker` and `npm run dev` in separate terminals. Enter provider credentials only in ignored `.env.local`.

Run `npm run verify` and `npm run test:e2e` to verify changes. See [implementation status](docs/implementation-status.md) for verified capabilities, cloud setup, and remaining release gates. See [self hosting](docs/self-hosting.md), [runtime isolation](docs/runtime.md), and [design](DESIGN.md).

Existing browser briefs can be exported from the original app before import. Original engine projects remain in their database; migrations must be additive. Never copy private credentials or account screenshots into the repository.

## Integration checkpoint

The approved hosted beta is not complete. [Status and acceptance gaps](docs/implementation-status.md) identify pending visual editing, comparison, hosted infrastructure and publishing. [Cloud setup](docs/cloud-setup-status.md) records the Azure region and reachable-auth-server blockers. No old cloud project has been deleted.

For this integration worktree, the configured app and preview ports are 3002 and 3102, with a separate `forge_unified` database and `forge-workspace:unified` Docker image. These avoid disturbing the original engine. Use `docker build -f runtime/Dockerfile -t forge-workspace:unified .` to rebuild that image. Stop the production app before rebuilding its `.next` output, then restart it. Wait for worker shutdown before starting another worker.

Fixture browser checks: `FORGE_TEST_URL=http://127.0.0.1:3002 FORGE_UNIFIED_FIXTURES=1 npm run test:e2e`. The optional generated-Pomodoro acceptance gate uses `FORGE_POMODORO_PREVIEW=http://127.0.0.1:3102`; its current failures are documented and block release. No provider evaluation is launched by default.
