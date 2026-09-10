# Private preview gateway

Disabled until explicitly composed by Task 01 with real identity/control, registered ready runtime, private workload transport and verified hostname/TLS. This module does not auto-bind, deploy, buy infrastructure, load environment credentials or select a provider.

- `PreviewControl` executes ticket issue, consume, authorize, rotate and revoke in the canonical `ControlDatabase`. No parallel identity/job database. `proposals/0007_preview.sql` is the exact native-tested SQL proposal; only Task 01 publishes it in the numbered migration chain. Apply only through reviewed explicit migrations, never startup.
- `previewControlRoutes` is a mountable handler for `POST /api/v1/previews/:id/tickets` and `/revoke`, with exact HTTPS Forge Host/Origin, opaque host cookie and CSRF proof. Request body is `{hostname}` matching a previously registered immutable route. Only the ticket response exposes its one-time secret; it is never a URL query.
- `previewGateway` handles launch POST, same-origin renewal and all app traffic. `createPreviewServer(tls, options)` constructs a native HTTPS server. Callers must explicitly choose a private listen address. There is no automatic public listener or Vercel deployment adapter.
- `HostPreviewRuntime` resolves the existing trusted `HostInventory` and uses the Task 02 `FirecrackerDriver` app port. Source, image, tenant, job, operation, environment and epoch must match. Inventory is checked again after the request. Provider/DB/deployment credentials never enter this interface. A network-separated installation needs authenticated workload RPC, not HTTP serialization of an untrusted `PreviewGrant` as authority.

Canonical lifecycle: the authenticated worker verifies runtime receipt/readiness, reserves capacity, creates canonical preview/environment, then calls `register_preview_route` under workspace scope. Hostname/environment/generation/operation/epoch never change after registration. Heartbeats preserve the epoch; takeover requires a new preview generation and hostname. Sessions bind the originating Forge login and current viewer membership, with no cached authorization. Explicit renewal rotates credentials, extends the 15-minute idle deadline within the absolute preview/environment/login bounds, and invalidates the prior cookie. Session lifetime is at most 30 minutes; preview at most two hours; launch ticket at most 60 seconds.

Revoke marks the immutable route and credentials revoked, sets preview STOPPING and expires the environment. The existing canonical reconciler discovers the expired environment and owns termination/storage cleanup through Task 02. `cleanup_preview_credentials()` is a maintenance-role sweep for credential revocation and permanent route tombstones; it is not a VM destruction receipt. Task 01 must schedule both maintenance paths. The native test demonstrates this discovery with explicitly simulated resource destruction.

All request cookies, authorization and arbitrary extension headers are stripped. Guest response headers are allowlisted, gateway/domain cookies rejected, app cookies withheld, and all 3xx responses rejected. Gateway total deadline: 10s; request body: 1MiB; response: 4MiB. Task 02 RPC's tighter 256KiB/512KiB limits win. No WebSockets, streaming, service workers, generated authentication or arbitrary external resource fetches are enabled. The generated template health URL is process health only, and cannot establish DB readiness by itself.

Reproduction:

```sh
npx vitest run tests/engine/preview-policy.test.ts tests/engine/preview-control.native.test.ts tests/engine/preview-host.test.ts
npx tsc -p tests/preview/tsconfig.json
npx tsx tests/preview/browser.ts
```

Browser prerequisite: installed Chrome (or `PLAYWRIGHT_CHANNEL`), openssl, native PostgreSQL tools on PATH and non-root test user. This test launches ephemeral native PostgreSQL, synthetic identity/source/runtime, loopback TLS with a disposable self-signed key, and Chrome hostname mappings. No external provider deployment or generated app execution occurs. The key is deleted after the test; JSON evidence records only checks and public version metadata. Never use the test's DNS overrides or TLS trust bypass as production configuration.

See the [task report](../../docs/reports/demo-delivery/task-07-preview.md) and [RFC amendment](../../docs/reports/demo-delivery/task-07-preview-rfc-amendment.md) for default-hostname evidence, deployment boundaries and live blockers.
