# Free-hosted account and key milestone

2026-09-10. **The full prompt-to-publish release is incomplete.** This milestone connects real Better Auth sessions to the existing control database and implements encrypted, owner-scoped key management. It records local native and browser evidence, not live generation or publication acceptance. The new [architecture amendment](../../../decisions/0003-free-hosted-runtime.md) replaces the earlier host/budget direction with the user-approved $0 services. [Configuration and rollback](../../../operations/hosted-connections.md) describe the exact boundaries.

## Changes

- Engine migration 0004 adds immutable Better Auth identity/session mappings, bounded atomic workspace enrollment and parent-session authorization. No email linking or automatic restoration of revoked membership. Logout, account suspension, verification loss and session expiry deny subsequent control requests. Worker account checks reject suspended users; job-specific logout cancellation still needs worker composition.
- Engine migration 0005 publishes the existing BYOK schema proposal and adds model validation/selection, key-count caps and automatic invalidation on rotation/removal. Existing migrations and auth functionality remain preserved.
- Reuses existing authenticated credential authorization, AES-GCM envelope encryption, PostgreSQL RLS, revision compare-and-swap and pinned destination transport. Adds same-origin Node API routes and the Connections screen, with no browser-persisted key or browser-visible engine token.
- Adds bounded authenticated Gemini/Groq/OpenRouter metadata checks. OpenRouter checks its protected key endpoint before its public model catalog and rejects reported paid pricing. Metadata compatibility is not real generation verification. No completion/provider charge occurs in these tests.
- Preserves disabled hosted generation and the production availability page. The hosted connection flag does not enable a worker, generated-code execution or deployment.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` | Lint/types/build passed; 911 tests passed, 5 existing optional tests skipped on the combined scheduler/Neon/Gmail milestone (the first account/key milestone passed 833). |
| Account-to-key native API regression | 14 tests passed using real Better Auth and disposable PostgreSQL, including real signup/verification/login, engine bridge, encrypted key CRUD, foreign-account denial and logout revocation. Delivery is synthetic. |
| Identity/catalog/BYOK suites | 84 tests passed across four suites; authoritative identity lifecycle, enrollment races, tenant boundaries, encrypted rotation and bounded provider metadata contracts. |
| Firefox browser regression | 24 checks passed; signup, synthetic verification/recovery, key save/reload/replace/remove, unavailable build preservation, light/dark 390/768/1440 layouts, focus, CSS 200% zoom and reduced-motion emulation. |
| Build/lint after label correction | Passed; successful Firefox rerun exercises the final corrected selector. |
| Live A–P acceptance | No live gate closed by this milestone. No generated app URL, real provider build, live email result or publication recording. |

The [26.64-second recording](evidence/local-account-connections.webm) is an actual local Firefox regression with synthetic accounts/mail/keys and a permanent explanatory label. It is **not** the requested successful signup-to-publication recording. Password/key inputs are masked and cleared; sampled frames and static layout captures were reviewed. [Browser results](evidence/results.json), sanitized logs and screenshots are retained with [SHA-256 hashes](evidence-sha256.json). Native browser zoom and OS-level reduced-motion behavior were not tested.

Reproduce on the documented Node 24 toolchain with PostgreSQL available:

```sh
npm run verify
FORGE_AUTH_BROWSER=firefox FORGE_AUTH_BROWSER_CONNECTIONS=true node --import tsx tests/auth/browser.ts
```

The browser harness requires no private environment files, starts its own disposable PostgreSQL/TLS listener, and intercepts only its declared synthetic delivery endpoint. It never starts a generation worker or calls a model. Its Next custom-server/standalone warning is retained as a test-harness limitation.

## Failure history

1. Initial session-interface narrowing broke existing standalone HTTP calls. Replaced it with a generic session capability preserving existing methods; typechecks passed.
2. An initial metadata-parser syntax error failed two suites. Fixed it and corrected credential binding/authorization object shapes; 84 affected tests passed.
3. Disk exhaustion caused PostgreSQL and TypeScript failures. Removed only rebuildable dependencies/build caches from inactive prior Forge test clones; preserved source and evidence. Native account tests passed on rerun.
4. Parallel native PostgreSQL suites produced lease/reset and unrelated UI/Python timeout failures during host contention. Bounded the verifier to one test process; all 833 executed tests passed without increasing lease or test timeouts.
5. Firefox could not address the provider selector by its exact accessible label. Added the explicit accessible name, rebuilt and reran the complete browser campaign successfully.

Failed logs remain separate from passing reruns. No skip or synthetic provider result is reassigned as live acceptance.

## Account access and remaining work

Vercel team `biswas07` was verified as Hobby. Cloudflare Wrangler authenticated with only account/user read and Workers write scopes, stored using its encrypted configuration and macOS Keychain. Neon CLI authenticated using its keyring and can list the existing Forge projects. These are access checks, not deployment or actual remaining-quota verification. No resource upgrade, purchase, model call or production promotion occurred.

Neon organization Free entitlement and Vercel Hobby were verified. The dedicated Neon control database and restricted runtime roles have been installed and verified over TLS; see [installation evidence](neon-installation.md). The combined milestone adds the disabled scheduler transport and bounded Gmail adapter; see [combined results](combined-foundation.md).

Remaining: verify Cloudflare free entitlement and remaining resource capacity; supply private installation/email configuration and a user model connection; compose actual generation, durable dispatch/accounting/outbox, encrypted source adoption, managed isolated builds, authenticated previews, application databases and migrations, full publication management and creator-only app authentication. Then pass the original hosted A–P and clean self-host acceptance, record the successful real flow and update the draft PR. Do not merge or replace production before that evidence exists.
