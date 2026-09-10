# Task 07 — private preview gateway

2026-09-10. **Gateway implementation and native/local browser evidence delivered; live private preview remains blocked. No working private preview URL is claimed.** This task purchased no domain/service, ran no billable model call, deployed no gateway, and did not change provider protection. Task 08's explicitly published portfolio is a separate artifact.

## Ownership and baseline

Worktree `/tmp/forge-task07-preview`, branch `codex/task-07-private-preview`, starts at Task 01's published worker commit `881e9ac2b11f8f168cb7849b77c4ee7439e55458`. Origin verified as `https://github.com/shellcat-com/forge-ai.git`. PR base is `codex/demo-delivery-baseline`, dependent on Task 01 [PR #8](https://github.com/shellcat-com/forge-ai/pull/8). Preserve Next.js + strict TypeScript + PostgreSQL and existing work. The shared Documents checkout was read only; no conflicting baseline, shared manifest, accepted migration, identity module, or runner module was edited.

Task 01 reviewed the SQL proposal and requested lock-order/race fixes, which are implemented here. Only Task 01 may publish `0007_preview.sql` into the canonical migration sequence or mount the new control routes. The proposal is tested by applying its exact bytes to the existing canonical schema in ephemeral native PostgreSQL. It is not a second control database or policy-only simulation. Production integration remains disabled.

## Implemented behavior

- Actual atomic issue/exchange through `PreviewControl` and canonical PostgreSQL. A row lock and one transaction consume a launch ticket and insert a hashed session. Concurrent replay has one winner; failed insertion rolls back consumption. Parent Forge login, current user/workspace/membership, project, preview, environment, operation, generation and epoch are revalidated. Legacy unbound tickets are denied.
- Immutable hostname/environment/generation routing records, permanent hostname tombstones, exact source manifest/template binding and a released-image lookup against the trusted host inventory. No caller-selected upstream URL, port, actor or tenant grants authority.
- Real native HTTPS gateway and mountable control HTTP routes. Launch requires the exact Forge Origin and POST body, never query tokens. Ticket issuance/revocation require canonical host cookie and CSRF proof. An explicit continuation link makes the post-launch navigation same-site for the Strict cookie.
- Secure, HttpOnly, host-only preview cookies; duplicate/reserved/domain cookie rejection; guest cookies and arbitrary headers withheld. Forge, BYOK, database and deployment credentials do not enter the app transport. Redirects, forwarding-host manipulation, reserved paths, malformed launch and cross-origin mutations fail closed.
- Explicit same-origin session renewal rotates credentials, invalidates the old session and extends idle lifetime within parent/environment/preview absolute limits. Sessions are at most 30 minutes; launch tickets at most 60 seconds; preview at most two hours. Every app response is buffered and reauthorized before bytes leave the gateway.
- Total gateway timeout of 10 seconds, bounded bodies, unhealthy/stale runtime rejection and post-RPC inventory checks. The Task 02 adapter requires process **and database** readiness through its authenticated `health` method. The template's HTTP health endpoint alone is explicitly insufficient.
- Revocation fences the route/credentials, marks preview STOPPING and expires its environment so the existing canonical reconciler discovers teardown immediately. Maintenance revokes invalid credentials and retains route tombstones. Native tests exercise canonical reconciler discovery and **fixture-only** destruction; actual host/storage cleanup is Task 02's live responsibility.

Locking: locate untrusted scope without locks, authorize/lock parent login and membership, then settings SHARE, project SHARE, job SHARE, preview UPDATE, environment SHARE, route SHARE and ticket UPDATE/revalidation. Preview UPDATE is acquired up front to avoid different viewers deadlocking on renewal lock upgrades. Settings locking serializes policy revocation/shutdown; parent-first order avoids logout inversions. The Task 05 operator uses bounded NOWAIT/whole-transaction retries for its operator-only mutation path.

## No-domain-purchase findings

The [RFC amendment proposal](task-07-preview-rfc-amendment.md) replaces domain ownership with a verified separate browser site/origin requirement. Current gateway configuration recognizes only the tested sibling, one-label `vercel.app` pattern and rejects same-site children/aliases of that pattern, ports and unverified suffixes. This is a narrow provider adapter, not an invented public-suffix parser. Hostname issuance/immutability must still be proven by the deployment owner.

Chrome observes cross-site navigation between sibling `vercel.app` names, blocks `Domain=vercel.app` cookies, enforces cross-origin document isolation, and protects the gateway's HttpOnly host cookie. A positive control under one registrable site reports same-site despite different hostnames. These observations use real browser networking over loopback HTTPS with local hostname overrides. They do **not** prove public DNS/TLS, Vercel deployment protection or an actual generated application.

The proposed hosted arrangement requires an issued immutable generated deployment hostname per generation, Vercel Authentication with All Deployments protection, independent Forge viewer checks, a provider-aware exact ingress adapter and authenticated private control/runtime transport. No such Forge deployment currently exists according to Task 08. No protection was relaxed to obtain a URL. The amendment offers an owner-device loopback HTTPS/SSH arrangement using existing runtime capacity and local TLS/resolver configuration for review; its public-to-local browser behavior and real runtime path require acceptance before enablement.

## Reproduction and evidence

Use Node 24.20.0, native PostgreSQL tools on PATH, a non-root user, OpenSSL and Chrome. No environment secrets are needed. Each native harness creates a separate socket-only synthetic cluster and removes it afterward.

```sh
npm ci
npm run verify
npm run test:db:control
npm run control:build
npx vitest run tests/engine/preview-control.native.test.ts tests/engine/preview-host.test.ts tests/engine/preview-hostnames.test.ts tests/engine/preview-policy.test.ts
npx tsc -p tests/preview/tsconfig.json
npx tsx tests/preview/browser.ts
# After fetching/checking out Task 05's dependency:
npx tsx tests/preview/identity-race.ts /absolute/task05/engine/control/identity-operator.ts
```

Recorded local commands use `/tmp/forge-e3-node24.UZHrx7/node-v24.20.0-darwin-arm64/bin` prepended to PATH for the final verification/native/browser campaign. Early focused development checks used host Node 25.8.1; the final record distinguishes them. The final browser rerun fixed a harness-only observation race: favicon requests could overwrite the navigation observation; the harness now records only document navigations. Native PostgreSQL was 14.18, a canonical control-schema compatibility check, not a generated PostgreSQL runtime version claim.

Evidence classes:

| Evidence | Result and boundary |
| --- | --- |
| Clean dependency install | `npm ci --ignore-scripts` succeeded against unchanged lock; no package manifests changed. |
| Initial `npm run verify` | Lint/typecheck passed; native cluster setup failed with ENOSPC. 528 tests passed; no assertion-pass claim for five failed native suites. Initial log retained with whitespace normalized. |
| Repeated `npm run verify` | PASS: lint, strict typecheck, 621 tests passed, four explicit optional skips, production build. Reused exact-lock Task 01 frozen packages through individual read-only package symlinks after deleting only Task 07's duplicate install. Not a clean reproduction claim. |
| Latest focused checks | PASS: 23 native transaction/race tests, eight host-adapter tests, one hostname test and six policy tests; strict engine/browser compilation and lint passed after final health/boundary changes. [Summary and hashes](evidence-task-07/manifest.json). |
| Browser | [Browser JSON](evidence-task-07/browser.json): real Chrome 153.0.8010.36, local TLS/native DB; synthetic identity, app process and runtime; public DNS and provider protection untested. No screenshot is offered as runtime proof. |
| Identity operator race | PASS: two native cases, exact reviewed Task 05 operator imported read-only. [Evidence and module hash](evidence-task-07/identity-race.json) cover revocation contention and exhausted retry rollback. |
| Native schema and standalone build | PASS: 45 native constraint/RLS assertions; `npm run control:build`. [Schema log](evidence-task-07/db-control.log), [build log](evidence-task-07/control-build.log). |
| Cleanup | Canonical reconciler routing/discovery exercised; destruction receipt is explicitly from `FixtureCleanupAdapter`. |
| Live generated-app readiness/restart | BLOCKED: Task 02 reports no approved real host/service access. No local ordinary-process substitute is counted as generated-code isolation/readiness. |
| Live provider protection | BLOCKED: no protected Forge deployment, issued immutable hostname or authorized/unauthorized Vercel test contexts available. |

The root lock SHA-256 is `849678e40252047ab5ed464cb2541eb2edb77ae2f1da1a7f801f155499353e93`. Supporting checks use local build/cache directories; Task 01's package contents were not modified. To avoid concurrent cluster exhaustion, later native checks acquire `/tmp/forge-native-verification.lock`, record Task 07/PID and release only their own lock in `finally`. A held lock means no test ran. Only Task 07's disposable dependency/build outputs were removed; other worktrees, caches and databases were preserved.

## Remaining integration and live blockers

1. Task 01 must review/publish canonical migration 0007, wire canonical control HTTP/workload RPC, register authenticated runtime receipts and schedule credential plus environment cleanup. This branch intentionally leaves shared migrations and production flags untouched.
2. Task 05 real account/session bridge and two real invited users, plus deployment-specific identity configuration. Fixture identity/native membership tests do not authenticate real people.
3. Task 02 approved isolated runtime, selected image release and private authenticated host path. Run actual generated-app DB readiness, app restart, lease expiry, cancellation and storage destruction with exact source/image hashes. Process/DB health RPC exists as an adapter dependency; no live run has occurred.
4. Protected Vercel gateway project/issued hostname, every-alias protection inspection, provider-specific trusted ingress handling, authenticated private control/host reachability, and signed-out/authorized/revoked browser checks. Vercel hosting alone does not supply the private host-local RPC path.
5. Task 06 durable deployment/retention integration and reviewed retention of hashed credentials/audit versus permanent hostname tombstones. Credential rows are revoked, not prematurely deleted along with route identity.

Residual limitations: no streaming, WebSockets, guest cookies/authentication, external guest fetches, automatic paid deployment, browser control UI integration, or real generated portfolio evidence is claimed. A14/D6 and live A01/A19 remain open. The Task 08 public portfolio grants no engine or private-preview authority.

## Publication

One draft PR targets `codex/demo-delivery-baseline` with Tasks 01/02/05/06 dependencies. GitHub publication and CI results are recorded in the final publication evidence after pushing; no merge or force push is authorized. Code/report commits and PR URL are returned with the final task response.
