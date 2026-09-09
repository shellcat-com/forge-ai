# Self-hosting

## Scope

The current Forge deployment is a static pre-alpha UI. It supports browser-local project persistence and has no accounts or application generation runtime. The optional loopback text-planning API is a separate local-development process and is not included in the static container. Self-hosting it lets contributors inspect the interface; it does not create a usable AI app generator.

## Local development

Requirements: Node.js 20.19+, npm 10+, and a modern browser.

```bash
cp .env.example .env
npm ci
npm run verify
npm run dev
```

Vite listens on loopback at `127.0.0.1:5173` with a strict port. Do not expose the development server to an untrusted network.

## Container deployment

Requirements: Docker Engine 24+ with Compose v2.

```bash
docker compose build
docker compose up -d
docker compose ps
```

Visit `http://localhost:8080`. Logs are available through `docker compose logs forge`. Stop the service with `docker compose down`.

The Compose service drops Linux capabilities, prevents privilege escalation, uses a read-only root filesystem, and provides writable temporary mounts required by Nginx. These settings protect the static server process; they are not a generated-code sandbox.

## Reverse proxy

Terminate TLS at a maintained reverse proxy and forward only HTTP traffic to port 8080. Preserve the container's security headers. Because the app has no authentication, avoid public exposure unless displaying the interface is intentional.

## Data and backups

There is no persistent application data today. The reserved `FORGE_DATA_DIR` and `FORGE_WORKSPACE_ROOT` values are unused. Back up only your deployment configuration and the exact image digest or Git commit used.

## Upgrade and rollback

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
```

Before updating, record the current Git commit or immutable image digest. Roll back by checking out that known commit, rebuilding, and starting the service. Review `CHANGELOG.md` before each upgrade.

## Production-readiness gate

Do not treat Forge as a production generator until the server, authentication, provider secrets, persistence, audit logging, sandbox policy, abuse controls, backup/restore, and incident response paths are implemented and tested.
