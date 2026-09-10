# Forge release coordination

Updated 2026-09-10 UTC. Task01 remains the shared integration owner. This additive release handoff preserves the [demo-delivery baseline board](demo-delivery-coordination.md); it does not create another team, replace historical evidence or imply that the new release gates passed.

## Baseline and staged target

- Verified origin: `https://github.com/shellcat-com/forge-ai.git`.
- Starting baseline for this release request: **`efa13a9de63457d0daccde1cc1cda645d332b6ff`**, branch `codex/demo-delivery-baseline`, [draft PR8](https://github.com/shellcat-com/forge-ai/pull/8), base `master`.
- Tested implementation: **`88a5a39daeabe088a119f871166333975588c1b1`**; intervening commits contain reports/evidence. [Baseline report](../reports/demo-delivery/task-01-baseline.md); [final baseline CI](https://github.com/shellcat-com/forge-ai/actions/runs/34440153017).
- Remote `master` remains `42a376387835c2d7140b6c484c3517fe466714eb`. No merge/force-push/deletion is authorized.
- **Final release-staged commit: NOT AVAILABLE.** The starting baseline lacks required production authority/schema/worker/gateway/publishing composition. It is suitable for independent documentation, audit preparation and explicitly classified local checks, not final live-release sign-off.
- Preserve the dirty shared Documents checkout. Use isolated worktrees from the readable canonical clone. New documentation commits do not change the pinned starting baseline.

## New release brief and existing scope

The user-started release verification brief requires **Forge itself publicly hosted on Vercel for a truthful recorded app-building demonstration**, plus a separate generated-app **in-product Publish flow and public URL**. A portfolio deployment cannot substitute for the Forge product deployment. The currently published availability page is not that completed hosted builder.

Open-source self-hosting and hosted BYOK remain included. First supported generated stack remains Next.js + strict TypeScript + PostgreSQL. No custom domain purchase, credit sales, subscriptions, payment checkout or Forge model-billing product is required. Existing bounded usage, abuse controls and provider-cost liability accounting remain necessary. Provider credentials are separate from hosting credentials. No arbitrary model/stack compatibility, live spending or unresolved infrastructure choice is inferred.

RFC0001 §0.1 now records the additional in-product publishing/recorded Forge demonstration direction. Its concrete publication/hosting contracts remain unresolved; this scope amendment does not change private-preview or execution acceptance gates.

## Ownership and active assignments

| Role | Session / branch | Exclusive scope and dependencies |
| --- | --- | --- |
| Task01 shared integration | `01a08969-e618-7cc0-b272-2af6a106f77b`; `codex/demo-delivery-baseline` | This board; shared architecture/contracts, root manifests/lockfiles, canonical migration allocation and integration staging. Review concrete shared-document requests before changes. Existing Today Coordinator schedules if one is assigned; none found in current inventory. |
| New release Task09 | `01a08a27-e72b-7073-955e-b2a5518ed8f5`; `codex/task-09-release-self-host`; `/tmp/forge-task09-release-self-host` | Additive `docs/reports/forge-release/09-release.md`, `docs/operations/forge-self-host-readiness.md`, names-only `docs/examples/forge-release.env.names`, and `docs/reports/evidence/forge-release/task-09/`. Reuse earlier acceptance tooling and evidence. Shared README/self-hosting/root environment changes are proposals to01. |
| Release Task04 UI integration role | No new release session assigned in inspected inventory | The new brief reserves shared Forge UI integration for Task04. Do not assign that work to the earlier BYOK task or start a duplicate worker merely because its number matches. Route UI requests through01 until the intended owner is identified. |
| Other release implementation roles | No new sessions assigned in inspected inventory | Existing02–08 source foundations are preserved. Do not infer new workers, completed production composition or release ownership from historical numbering. |

Task09's report and new guide/example paths are allocated here, not evidence that those files already exist. Its PR should target `codex/demo-delivery-baseline`, state the exact efa13a9 starting point and remain draft while release dependencies are blocked. Task01 integrates reviewed authored commits; no automatic merge to master.

## Contracts, migrations and integration dependencies

The [existing signature/ownership/migration ledger](demo-delivery-coordination.md#contract-signatures-and-integration-status) remains authoritative. Engine canonical0001–0003 and application Drizzle0001–0003 are distinct namespaces and retain their bytes. Reserved engine0004 identity,0005 BYOK accounting,0006 objects/retention and0007 preview are still **unpublished proposals**; application0004 is reserved for its separate identity bridge. No renumbering or cross-database migration reuse is approved.

| Dependency | Status / required integration |
| --- | --- |
| Real identity and control authority | BLOCKED: actual Better Auth lifecycle/session bridge, privileged operator role and real owner/test-user configuration; no fixture-ID conversion. |
| BYOK and bounded dispatch | BLOCKED: protected routes, actual current-authority dispatch gate, global/job reservation and uncertainty/cleanup composition; exact provider policy and explicit numeric budget. |
| Durable services and adoption | BLOCKED: actual worker/PG/object/KMS/retention/backup choices, same leased worker transaction for artifact adoption and canonical migration composition. |
| Approved isolated runtime | BLOCKED: real Linux/KVM host, immutable image/template, fresh E1 authority and independently isolated external checks. No generated code on the laptop/control plane and no ordinary container substitution. |
| Private preview | BLOCKED: canonical control/gateway/worker mounting, actual TLS/protection/host routing, ticket/session/revocation and cleanup evidence. Public publishing is a separate authority. |
| Forge hosting and generated-app Publish | BLOCKED: real connected Forge deployment; authenticated in-product publication with hosting credential separation and actual verified generated artifact/public URL/rollback. Existing publisher ports and availability site are foundations only. |
| Independent release campaign | PREPARATION AVAILABLE: Task09 can finish names-only setup guidance and local/native audits now. Final sign-off waits for01's exact staged commit containing the preceding dependencies and real evidence. |

Dependency order: identity/storage/template/runtime contract decisions → shared bounded generation and adoption → private preview → connected Forge plus generated-app Publish → final independent release campaign. Independent tests/docs may progress earlier; direction approval does not prove acceptance.

## Verification and evidence rules

Use Node24.20.0/npm11.11.0 and a fresh checkout for clean reproduction; distinguish existing independent CI/native/local fixture evidence from new live runs. Serialize local native database tests using an exclusively acquired `/tmp/forge-native-verification.lock`; never remove another task's lock or mutate shared dependency symlinks. Record exact source/toolchain and every PASS/FAIL/BLOCKED/NOT RUN denominator. Safe example files contain configuration names only, not copied credentials or private environment values.

Final release requires genuine reproducible app generation, two-user isolation, containment/fencing, durable persistence, preview revocation, publication/rollback, fresh-session production access and approved bounded load/operations evidence. Preserve original A01–A22/D1–D8 gates. A laptop without an approved runtime must report generation unavailable. No live load or billable API campaign has an applicable new budget; current authorized new billable spend is$0.

MIT is preserved; no license selection/change is authorized. Earlier package inventories and stale allowlists remain historical and must be recomputed against the actual release target before distribution decisions. Native browser zoom/OS motion, real generated portfolio and live alpha/production acceptance remain open; the availability site closes none of them.
