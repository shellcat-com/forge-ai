# Forge parallel demo-delivery prompt pack

These are standalone prompts for future implementation sessions. This pack does not launch workers, change the engine, push code, or deploy a website.

The user selected BYOK, Vercel website hosting, default platform URLs without a domain purchase, and a real generated portfolio demonstration. These are scope choices; they do not establish credentials, paid budgets or completed runtime acceptance. Task 01 records the amendments in the authoritative specification.

## Launch order

1. Start Task 01 and let it publish the canonical baseline commit.
2. Start Tasks 02–07 on that baseline in separate worktrees, coordinating their interfaces. Tasks 08/09 can prepare their harnesses in parallel but must wait for real dependencies before claiming integration success.
3. Use the Today Coordinator to schedule or follow the existing tasks. Do not start both independently assigned workers and duplicate coordinator-spawned workers.
4. Task 01 owns shared integration; Task 08 owns Vercel writes. Every task verifies, reproduces, commits, pushes and opens a PR. PRs may remain draft when integration evidence is blocked. Merging is a separate owner action.

| Task | Standalone prompt |
| --- | --- |
| Task 01 — Canonical repository and scope reconciliation | [Open and copy](01-canonical-baseline.md) |
| Task 02 — Real isolated runtime | [Open and copy](02-real-runtime.md) |
| Task 03 — Verified template and toolchain | [Open and copy](03-template-release.md) |
| Task 04 — BYOK, real generation and per-call accounting | [Open and copy](04-byok-generation.md) |
| Task 05 — Real identity and owner access | [Open and copy](05-real-identity.md) |
| Task 06 — Persistence, Vercel control integration and backups | [Open and copy](06-persistence-hosting.md) |
| Task 07 — Working private preview without buying a domain | [Open and copy](07-private-preview.md) |
| Task 08 — Complete live app-building flow and publish the portfolio | [Open and copy](08-live-demo-vercel.md) |
| Task 09 — Independent acceptance and open-source demo readiness | [Open and copy](09-release-validation.md) |
| Today coordinator — Integrate the nine tasks and deliver the best verified demo | [Open and copy](10-today-coordinator.md) |

## Deployment distinctions

The generated portfolio can have a public default Vercel URL without buying a custom domain. See [Vercel generated deployment URLs](https://vercel.com/docs/deployments/generated-urls). Forge frontend hosting, durable control workers/data, private generated previews and untrusted execution are separate responsibilities.

Regular Functions have plan/runtime limits and should not be assumed to be a persistent worker or the required execution sandbox. See [Vercel Functions limits](https://vercel.com/docs/functions/limitations). [Vercel Sandbox](https://vercel.com/docs/sandbox) is a separate service that Task 02 may evaluate; this pack does not select it, authorize its costs or claim it satisfies the current runtime contract.

BYOK supports tested provider adapters and controlled configuration. It does not guarantee every provider protocol works or make model calls free. Provider keys and Vercel deployment credentials remain separate and never enter generated artifacts.

## Definition of success

Each scope is complete only with its stated working behavior and real verification. The immediate demonstration is a real engine-generated portfolio with a verified publicly accessible Vercel URL. The PostgreSQL task-board tests remain necessary for full-stack-engine claims. Full private-alpha readiness still requires the applicable A01–A22 gates; a working portfolio is not a substitute.

## Prompt-pack verification

All 11 documents and their local links were checked, including required commit/push/PR/reproduction/verification instructions in all ten prompts. Repository verification passed lint, type checking, 532 tests and the production build; four optional tests were skipped. Existing ancestor Expo, Node local-storage and dependency annotation warnings appeared. This is documentation/repository evidence, not evidence that the future task implementations or live deployments have completed.
