# Local execution boundary

`npm run setup:local` creates one dedicated PostgreSQL 17 container on loopback port 55432 and stores its random password only in ignored .env.local with mode 0600. It preserves existing configuration and does not touch unrelated containers. `npm run db:migrate` applies a transactional, checksummed migration. Drizzle defines the application tables; SQL migrations remain compatible with ordinary PostgreSQL.

`npm run runtime:build` builds the trusted workspace image. The base is pinned by digest to official Node 24 LTS, currently 24.20.0. Host tooling uses 24.21.0; the exact 24.21.0 Docker tag was unavailable. Both run the Node 24 LTS line. The template has a fixed package lock and a populated npm cache. Generated workspaces run npm ci offline with install scripts disabled. New dependencies require a reviewed template/image update, never a model-supplied command.

Each workspace runs as node with a read-only root, no capabilities, no-new-privileges, two CPUs, 2.5 GiB memory with no additional swap, 128 processes, 768 MiB workspace tmpfs, 64 MiB temporary tmpfs, a 256 MiB per-file ceiling, and bounded Docker logs. The workspace tmpfs permits execution so Node can load the trusted native SWC module. Generated code remains untrusted regardless of file extension.

A per-workspace internal Docker network blocks outbound and host access. A separate, trusted, unprivileged 64 MiB TCP relay has a loopback-only published port and forwards only to that workspace's port 3000. It has no proxy command interface and no general forwarding API. Generated containers receive no bind mounts, persistent host volumes, Docker socket, provider credentials, or control database URL.

The trusted supervisor runs only offline install, Next.js build, and Next.js start, with 120/180-second install/build deadlines and a 330-second total readiness deadline. File batches are validated before writes; app/page.tsx, app/globals.css, nested route pages/layouts, app/components/**/*.tsx, app/api/**/route.ts, and lib/generated/**/*.ts are editable. Paths, batch size, UTF-8 bytes, duplicates, and required files are checked. package.json, lockfile, Next config, environment, and trusted SQLite helper are protected.

Workspace storage is disposable. Source is retained by the control database. SQLite uses the native backup API to capture a consistent snapshot while running; snapshots are capped at 8 MB and can populate a fresh isolated container. No raw host-directory snapshot or user-supplied archive is extracted.

Docker is not a kernel exploit boundary. First-release external dependencies are restricted to the trusted template. The worker and browser-preview policy are separate controls; a successful container test does not prove a finished generator UI.
