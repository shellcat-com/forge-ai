# Post-login website creation investigation

The login succeeds. A basic website cannot currently be generated in this hosted workspace: its provider endpoint deliberately returns no models, its approved cloud build path is not integrated, and its project service refuses hosted execution. These are missing production integrations, not a password/login fault. The static public deployment was not changed. No generated website or public application URL is claimed.

## Reproduction and changes

The Firefox regression signs up and verifies a synthetic account using real Better Auth and disposable PostgreSQL, signs in, and submits: “Build a simple one-page website for a neighborhood bakery, with an introduction, opening hours and a contact section.” The original workspace incorrectly answered “Choose an available model in Connections first.” Connections displayed no provider cards or hosted setup form. Existing-project changes could instead advise starting the local worker, which cannot supply the approved hosted sandbox.

- Home and Connections now identify the actual missing integration. Hosted accounts are no longer directed to a nonexistent model connection form, shown local operator provider instructions, or shown a usable generation allowance.
- New-project and existing-project APIs use one availability error. The service also rejects direct hosted calls before opening a transaction. Authentication and owner checks remain ahead of existing-project availability disclosure. No fixture guard was removed and no local execution fallback was enabled.
- Retrying a rejected website submission creates no project/job. The browser verifies that the prompt survives navigation to Connections, back to Home and a reload.
- An expired local worker heartbeat no longer produces a “connected” message. This preserves the separately configured local development workflow; it does not qualify that worker as the hosted sandbox.
- The workspace had horizontal overflow at 390px with 200% CSS zoom. Scoped minimum-width, wrapping and composer flex rules correct it without changing the design tokens.

The actual account and website-attempt recording is [local-website-attempt.webm](evidence/local-website-attempt.webm). It is a local test, visibly labeled with synthetic account/mail and unavailable website building. Passwords are masked. No live mailbox, model response, application build, private preview or publication appears. This recording cannot satisfy the requested successful generation-to-publication demonstration.

## Verification

Tested implementation commit: `2289102722f5bcc0012a9288acca2824b1343ddd`. Full verification passed **807 tests with 5 existing skips**, including 13 native account/availability tests. Firefox passed 23 checks, and the separate local compatibility suite passed 25 with 15 explicit skips. Lint, strict types and production build passed.

Final results, source hashes and reproduction commands are recorded in [verification.json](verification.json). Evidence uses a fresh disposable PostgreSQL cluster with limited application/auth logins and a test-only HTTPS listener. The real built Next.js routes and Better Auth run; only email delivery is simulated. No private environment files are loaded and no real provider call runs. Each harness shuts down its own browser, server, database and test certificates.

The browser checks cover light/dark 390, 768 and 1440px signup, Home and Connections; keyboard focus, reflow, CSS 200% zoom and reduced-motion emulation; signup, verification, login, logout, recovery; and the rejected website attempt. Native browser zoom and operating-system reduced-motion settings were not tested.

Retained failures in `evidence/`:

1. The initial recording captured the wrong model-selection error. Its first assertion also matched Next.js's separate route-announcer alert; the selector was narrowed to the product error. The second baseline run failed because the old built application lacked the new availability message. Both are baseline/harness evidence, not successful generation.
2. The first verification run had two added auth tests fail because an earlier configuration-negative test left local mode enabled. Per-test mode/origin reset fixed test isolation; the focused 12-test rerun passed.
3. The initial updated browser run completed the website attempt but failed its new 390px CSS zoom assertion. The scoped layout fix passed the subsequent 23 browser checks.

## Remaining work and release boundary

The complete missing implementation/configuration inventory remains in the [production integration report](../README.md#exact-remaining-gaps-by-category): single-authority account/control composition, hosted BYOK routes/UI, live generation/adoption adapters, an approved cloud worker/sandbox/private preview, application databases and durable publication. The interface fix does not implement those services. An applicable model-call test budget and cloud host/account/region/monthly budget are still required before paid provisioning or testing. The budget question in this follow-up received no answer during implementation; no new spend was authorized or incurred.

Changes are delivered to the existing draft PR #18, based on `codex/demo-delivery-baseline` and dependent on draft PR #8. Nothing was merged or deployed. To revert this milestone, revert its commits; there is no schema migration or production data change to undo. Do not roll back the earlier public-account migration or discard project data.
