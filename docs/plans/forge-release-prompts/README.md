# Forge AI release — nine replacement prompts

These prompts correct the earlier portfolio-oriented pack. They are instructions for future sessions, not evidence that implementation, deployment or GitHub upload has happened. Existing completed code must be reused.

## What the release delivers

- **Forge AI itself on Vercel:** the public product URL to share on LinkedIn.
- **A real app-builder demonstration:** user key/model → generation → review/approval → isolated build → private preview → edit → Publish.
- **Published generated applications:** each application gets its own actual public URL, separate from Forge and temporary previews.
- **Open-source BYOK:** self-hosted and hosted users supply their own supported provider credentials. No Forge credit/payment system is required. Model charges and hosting resources remain separate.
- **Recording readiness:** a rehearsed genuine flow and script; these prompts do not authorize posting on LinkedIn or producing a video.

Default Vercel-generated deployment URLs are supported; verify account protection settings and the final unauthenticated URL rather than assuming a deployment is public. Forge cannot issue Bolt-owned domains. See [Vercel generated URLs](https://vercel.com/docs/deployments/generated-urls) and [Bolt publishing behavior](https://support.bolt.new/cloud/hosting/publish).

## Copy one complete file into each task

| Task | Prompt | Live dependencies |
| --- | --- | --- |
| 01 | [Confirm completed work and establish the release baseline](01-baseline-and-scope.md) | None; establishes baseline |
| 02 | [Working BYOK and provider/model selection](02-byok-providers.md) | 01; 05 session integration |
| 03 | [Finish the real generation, template and isolated runtime path](03-real-generation-runtime.md) | 01; 02 + 05 + approved runtime |
| 04 | [Complete the Forge builder UI and private preview experience](04-builder-and-preview.md) | 01; 02 + 03 + 05 |
| 05 | [Production identity, durable data and backend operations](05-identity-and-persistence.md) | 01; approved identity/data access |
| 06 | [In-product Publish and a public URL for each generated app](06-publish-generated-apps.md) | 01; 03 + 05 + hosting authorization; 04 UI |
| 07 | [Publish Forge AI itself on Vercel](07-deploy-forge-vercel.md) | 01; 04 + 05 + 06 for complete product smoke test |
| 08 | [Prepare a truthful real-app demo recording](08-real-demo-readiness.md) | 02–07 deployed and live |
| 09 | [Independent release verification and open-source self-host readiness](09-release-and-self-host.md) | Integrated 01–08 evidence |

## Run safely in parallel

Start 01 first. After its canonical commit and interface ownership are recorded, 02–07 can implement independent components in isolated worktrees. Tasks 08–09 can prepare their scripts/tests at the same time, but their final live verification waits for dependencies. Parallel code work does not remove the need for integration and sequential end-to-end checks.

01 owns shared contracts, root manifests/migrations and staging integration; 04 owns shared UI integration; 06 owns generated-app publication; 07 owns Forge's main Vercel project. Every task has the user's exact commit/push/one-PR authorization. No task may merge PRs, force-push, overwrite another checkout or call blocked evidence complete.

Do not start this replacement pack on top of workers already doing these scopes. Assign the appropriate prompt as their follow-up, or inventory their progress first. Do not also launch the older coordinator with duplicate work.

## User inputs that code cannot manufacture

Approved identity/data/runtime configuration; secure provider-key references and a bounded live test allowance; the intended Vercel account/project and deployment access; and the ownership policy for generated-app hosting/databases. A provider key alone is not permission to publish into a hosting account. Use user-connected hosting unless an operator-sponsored mode is explicitly approved.

The target is a working demonstration, not a promise of unlimited app types, every provider/model, massive untested concurrency, or a same-day finish. Current code, integration access and measured tests determine completion. These documents intentionally do not repeat old test counts as new evidence.

## Verification of this prompt-only change

All nine standalone prompts passed checks for the required authorization, verification and reproduction instructions; index links resolve. A fresh `npm run verify` passed lint, type checking, 532 tests and the production build, with four tests skipped. Ancestor Expo configuration, Node local-storage and dependency annotation warnings were present. This verifies the current repository checks, not the future implementations, hosted integrations or live release gates. No workers were launched, GitHub PR opened or deployment performed by writing this pack.
