# Next.js + PostgreSQL template candidate

**Candidate, not an approved release.** Platform-authored scaffold, not model output. `/api/health` reports process health only. No generated authentication, task-board behavior or persistent sample data exists.

Pinned candidate: Next 16.3.4, React 19.3.0, Node 24.20.0, PostgreSQL 18.6. No approved immutable guest image exists. For this reviewed platform scaffold only:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
npm start
```

Local compatibility checks passed on both Node25.8.1 and checksum-verified Node24.20.0 on macOS. The proposed Linux image is still unavailable. Never execute provider-generated source with these host commands. Forge execution requires the currently unavailable dedicated Linux microVM driver.

For local source-export use, create a fresh disposable `forge_app` PostgreSQL database and run `app-database.sql` as bootstrap administrator. Through a private provisioning channel, set separate random SCRAM passwords and LOGIN for the two NOLOGIN roles. Only the app role credential belongs in APP_DATABASE_URL. `.env.example` has placeholders only. `postgresql.conf`/`pg_hba.conf` define guest-local access. The pool permits five connections. No migration or seed exists yet. Local-user execution is outside Forge's sandbox guarantee.

Freeze package.json, package-lock.json, tsconfig.json, next.config.mjs, next-env.d.ts, eslint.config.mjs, platform environment/harness and database bootstrap files in the release catalog. `policy.ts` owns exact guest commands and deadlines; no shell/package-script invocation or model-chosen dependencies are allowed.

Next writes type-discovery files during build. The future guest materializer must copy hash-verified source from read-only `/workspace` into guest-only `/scratch/build`, add verified offline dependencies and build there. Source promotion never reads scratch. Build artifacts remain untrusted and cannot be extracted into the broker/control host.

D7 still needs exact Linux/toolchain tests, isolated cache/postinstall review, dependency/license scan (npm reports candidate ESLint9.35 deprecated), real image digest, fresh/prior/restart PostgreSQL checks, external harness, no-egress/abuse tests, clean export and >=30 budget-authorized live-provider benchmark attempts. Networked dependency acquisition and local compilation do not prove offline-image readiness.
