# Provider connections readiness — September 11, 2026

**Implemented and verified in an isolated local copy. Not enabled on a live host by this task.** Cloud users can connect their own DeepSeek or NVIDIA API key, check/replace/remove it, then generate a text plan or standalone frontend from an account-owned saved project. Preview and HTML download work. Full-stack generation, generated backend authentication, payments and deployment remain unavailable.

## What changed

- Settings has encrypted provider-key connections. A small authenticated provider request must succeed before a new or replacement key is saved. Failed replacements preserve the previous key. Inputs clear immediately, and only a key fingerprint is returned.
- AES-256-GCM envelopes bind keys to the verified account and provider. A new migration adds forced row security and deletion cascades. Keys never enter browser storage or account exports.
- PostgreSQL reservations enforce 20 attempts per account per UTC day and one active request across server instances. UUIDs prevent replay of an attempt. Connection checks, failed requests and timeouts count. Plans allow up to 2,048 output tokens; frontend requests allow 8,000. These are not monetary spending caps, and savings are not guaranteed.
- Saved projects offer a provider/model selector, explicit output selection, escaped text results, an isolated frontend preview and HTML download. Downloading preserves preview interactions; the output selection persists after generation.
- The ordered migration runner handles subsequent migrations with checksum validation and a transaction lock. The Vercel package includes the new modules and requests a 150-second function duration.
- Existing authentication and the concurrent account-deletion changes were preserved. This task does not supersede the separate [login readiness report](user-login-readiness.md).

## Evidence

- **`npm run verify` passed in the isolated verification copy: 570 tests passed, four skipped.** Lint, strict TypeScript and default production build passed. [Full log](evidence/provider-connections/verify.log).
- **48 focused account/provider tests passed** across ten files, including encryption binding, restricted-role PostgreSQL access, cross-account insertion rejection, failed key replacement, shared reservations, replay rejection, quotas, API ownership/origin checks, account deletion and session handling. [Focused log](evidence/provider-connections/focused-tests.log).
- The explicit cloud-mode production build passed. [Build log](evidence/provider-connections/cloud-build.log).
- The Chromium synthetic browser journey passed login, invalid key, checked key, text generation, frontend interaction, HTML download with preserved interaction state, key removal, and logout. Settings and generation were checked at 390, 768 and 1440px in light/dark with no horizontal overflow. Keyboard focus/navigation, emulated reduced motion, and CSS 200% zoom passed. Native browser zoom and real managed cookies across browsers were not rechecked here. [Browser results](evidence/provider-connections/browser-checks.json). Screenshots are in `output/provider-connections/`.
- Live model-list requests returned the adapter's configured IDs. Small authenticated completions succeeded for both DeepSeek Flash and NVIDIA-hosted DeepSeek V4 Flash using existing server-configured keys. No key values were printed. These checks do not prove the new upload flow on a deployed account. [Provider evidence](evidence/provider-connections/live-provider-checks.json).
- Six built JS/CSS assets were checked against the configured server secrets; none matched. This is a bounded exact-secret check. [Result](evidence/provider-connections/build-secret-check.json).
- Fifteen implementation files matched the tested copy byte for byte. `git diff --check` passed. [Source hashes](evidence/provider-connections/source-checks.json).

## Verification environment

The original iCloud-backed checkout stalled reading offloaded dependencies/configuration. Its first verification failed on the concurrent account-deletion module's missing ESLint global; that configuration was fixed. A later original-checkout run stalled in TypeScript. It must not be described as a successful in-place verification.

The successful run used `/tmp/forge-provider-validation` with fresh dependencies installed from the same package lock, copied available source/fixtures, and no local credentials. The already-inspected entry file, TypeScript project configuration and initial SQL migration were restored in that temporary copy from their captured contents; the migration was 3,452 bytes. An initial isolated full run had 542 passing tests and failures caused by the offloaded candidate `.gitignore` omitted from the copy. After that exact file became available and was copied, the complete verification passed with 570 tests. Repository source was not replaced by the temporary copy.

## Remaining activation work

Apply `0003_provider_connections.sql` using the separate migration role and configure a random 32-byte `FORGE_PROVIDER_ENCRYPTION_KEY` in the live host's secret manager. Back it up separately from PostgreSQL. Deploy the cloud package, verify the host supports its request duration, then exercise a real signed-in user's key upload, generation, removal and session-revocation journey on staging. This task did not migrate a live database, upload an encryption key, deploy, or promote production.

The existing authentication release checks still apply, including real account deletion and cross-browser session behavior. Request limits protect provider usage across replicas; the general account API limiter still needs shared ingress enforcement before scaling. See [setup and security details](../provider-connections.md).
