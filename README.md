# Forge AI

A workspace for turning ideas into editable websites and web applications.

The unified Next.js application combines the approved Forge interface with the existing local generation engine. Generated apps run in restricted Docker workspaces. Examples provide optional inspiration rather than mandatory templates.



[![Watch the 81-second Forge walkthrough]](docs/media/forge-workflow.mp4)

[Watch or download the walkthrough (MP4, 1080p, 1:21)](docs/media/forge-workflow.mp4).

This recording shows the earlier local Forge workflow used to create Respawn, a gaming marketplace frontend: enter a brief, choose a design, refine the project, generate with DeepSeek, preview the result, and export HTML. Prompt entry is accelerated from 0:14; generation is condensed to 6.5 seconds, with a 13-second result tour. Original lo-fi music and added keyboard and mouse effects accompany the actual footage; there is no narration.

The recorded version uses a local login preview and HTML export. It does not demonstrate real signup, payments, or public deployment, and its interface predates the unified Next.js application described above.

The reusable [Screenrecord Demo skill](skills/screenrecord-demo/SKILL.md) includes capture and editing guidance, a timeline renderer, an original soundtrack generator, the 81-second timeline, and checks for exports and saved social drafts. Install or update it with `npm run skills:sync`, then ask Codex: `Use $screenrecord-demo to record my app in the 81-second Forge style.` Supply footage and timings for new recordings; raw captures are not bundled with the skill.

## Development

Use Node 24. Run `npm install`, `npm run setup:local`, `npm run db:migrate`, `npm run runtime:build`, then run `npm run worker` and `npm run dev` in separate terminals. Enter provider credentials only in ignored `.env.local`.

Run `npm run verify` and `npm run test:e2e` to verify changes. See [implementation status](docs/implementation-status.md) for verified capabilities, cloud setup, and remaining release gates. See [self hosting](docs/self-hosting.md), [runtime isolation](docs/runtime.md), and [design](DESIGN.md).

Existing browser briefs can be exported from the original app before import. Original engine projects remain in their database; migrations must be additive. Never copy private credentials or account screenshots into the repository.

## Integration checkpoint

The approved hosted beta is not complete. [Status and acceptance gaps](docs/implementation-status.md) identify pending visual editing, comparison, hosted infrastructure and publishing. [Cloud setup](docs/cloud-setup-status.md) records the Azure region and reachable-auth-server blockers. No old cloud project has been deleted.

For this integration worktree, the configured app and preview ports are 3002 and 3102, with a separate `forge_unified` database and `forge-workspace:unified` Docker image. These avoid disturbing the original engine. Use `docker build -f runtime/Dockerfile -t forge-workspace:unified .` to rebuild that image. Stop the production app before rebuilding its `.next` output, then restart it. Wait for worker shutdown before starting another worker.

Fixture browser checks: `FORGE_TEST_URL=http://127.0.0.1:3002 FORGE_UNIFIED_FIXTURES=1 npm run test:e2e`. The optional generated-Pomodoro acceptance gate uses `FORGE_POMODORO_PREVIEW=http://127.0.0.1:3102`; its current failures are documented and block release. No provider evaluation is launched by default.

## RFC fixture checkpoint

The E0/E1 contracts, durable fixture control service and validation harness are retained for isolated research and regression checks. They are not connected to the Next.js application, its Better Auth sessions, production database or worker. `npm run verify` checks both code paths; native PostgreSQL tools must be on `PATH`. `npm run test:db:control` and `npm run control:build` check the separate fixture schema and service. See [the merge reconciliation](docs/reports/pr7-reconciliation.md) for the architecture, identity and migration boundaries.

The earlier Neon Auth browser/API prototype is historical, unrouted source. Its old Vite flags and migration commands do not configure the current application. Use the current [cloud setup guide](docs/cloud-setup-status.md) for Better Auth.
