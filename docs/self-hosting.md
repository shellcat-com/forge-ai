# Self-host setup and release boundaries

The repository contains a Next.js application with PostgreSQL persistence, application provider adapters and a legacy local Docker worker. It also contains the separately composed RFC control/runtime foundations. These implemented paths do not yet form an accepted hosted or self-hosted release engine. The [release coordination board](operations/forge-release-coordination.md) distinguishes the tested starting baseline from the still-unavailable final release-staged commit.

## Keyless local inspection

Use a fresh checkout with Node **24.20.0**, npm **11.11.0** and native PostgreSQL tools (`initdb`, `pg_ctl`, `psql`, `postgres`) on PATH. Run native tests as a non-root user. Do not copy another developer's environment or database.

```sh
npm ci
npm run verify
npm start
```

Forge listens on `127.0.0.1:3000`. Public project pages and `/hosting` can be inspected without provider keys or hosted-account provisioning. `npm run verify` uses disposable synthetic PostgreSQL fixtures; optional/live tests remain separately gated. These commands do not launch a generation worker. Local page inspection does not require a cloud account; actual hosted identity, provider inference, durable services, isolated execution and publishing require their own configuration, access and any applicable budget.

For the reproducible migrated application/browser check, install the Chrome browser expected by the Playwright configuration and run `python3 scripts/check-baseline-browser.py` after verification. It creates and removes its own synthetic database and loopback server, applies application migrations twice, and starts no provider or generation worker. See [demo readiness](operations/demo-readiness.md) and the [baseline report](reports/demo-delivery/task-01-baseline.md) for exact evidence and skips.

## Persistence and existing local development implementation

Project persistence already exists in `src/server/db`, with application migrations under `drizzle`. `npm run db:migrate` uses the application database configuration. Engine migrations under `engine/migrations` have a separate authority and must not be applied to that application database by assumption.

`scripts/setup-local.mjs` is the existing development helper that provisions a dedicated loopback PostgreSQL container and stores its generated configuration in ignored `.env.local`. It is not a prerequisite for keyless page inspection. The legacy `worker/index.ts` constructs `DockerWorkspace`; its runtime commands and [historical local boundary](runtime.md) describe that implementation, not the approved RFC Linux/KVM boundary. Preserve this code and its evidence, but do not use an ordinary local container as release containment or execute generated release code on the developer/control host.

The standalone Compose packaging is likewise separate from generated-application isolation. Container packaging, successful local tests and a provider streaming response do not establish a connected release builder.

## Release self-hosting and hosted Forge

**Release generation is unavailable until the approved runtime and production composition are connected.** A laptop without that runtime must not fall back to host execution. The current RFC control entrypoint remains disabled unless explicitly configured for its loopback fixture mode; that fixture mode cannot qualify live generation. The legacy application path must not be exposed publicly as the accepted release engine.

A real release setup still needs the reviewed identity/session lifecycle bridge, canonical shared migrations, bounded provider dispatch/accounting, durable worker/database/object/key services, actual artifact adoption, approved isolated runtime/image, private preview gateway and authenticated publishing connector. Hosting Forge publicly on Vercel does not provide all these services. Generated applications need a separate in-product Publish flow and public deployment; a public availability page or portfolio alone does not replace hosted Forge.

BYOK credentials belong in approved server-side secret configuration or authenticated TLS credential handling, never client storage, public environment variables, generated files or reports. Provider credentials do not authorize hosting access. Model-provider billing and infrastructure costs remain the operator's responsibility; confirmation flags and possession of a key do not establish a live-test spending budget. No new paid service, domain purchase or billable test is implied by setup documentation.

The existing MIT license is retained. Dependency notices, media rights, key retention/deletion and distribution review are separate release checks. Follow the [current coordination dependencies](operations/forge-release-coordination.md) and [security model](security-model.md); do not describe hosted authentication, isolated execution or publishing as accepted before their bound live evidence exists.
