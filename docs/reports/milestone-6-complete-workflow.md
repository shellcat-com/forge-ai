# Milestone 6 — Durable generation and revision workflow

Date: 2026-09-09. Parent: 82a327e. Branch: codex/forge-ai-local.

## Implemented

Connected prompt submission to PostgreSQL jobs and a separate Node worker. Jobs stream numbered, persisted SSE events with cursor replay. A PostgreSQL advisory lock enforces one worker. Complete file batches are validated before Docker writes; candidate builds are promoted transactionally only after successful startup. Failed candidates retain and rebuild the previous working revision.

Added project navigation, generation timeline, follow-up requests, local Monaco editing, a file explorer with protected files, responsive separate-origin preview, saved build logs and revision history. Code edits and restores use the same staged build path as generation. Mobile navigation includes saved projects. The preview intentionally pauses while building to fit local memory budgets.

Revisions retain editable source, the immutable Docker image ID, exact dependency lockfile and consistent SQLite backup. The worker checkpoints data every ten seconds and before controlled transitions. It retains the recovery pointer while a candidate is running, marks interrupted jobs failed on restart, removes only runtime containers belonging to this Forge database instance and resumes the retained revision. A second checksummed migration stores runtime versions; four development-only revisions created earlier in this milestone were backfilled after verifying the unchanged image and exact template lockfile.

The preview proxy strips credentials/cookies and upstream policy headers, imposes its own CSP, blocks foreign Host headers and cross-origin mutations, and rejects external, malformed or backslash-normalized redirects. Provider timeouts are normalized before explicit local fallback. Evidence is local only.

## Verification

- `npm run verify`: lint, TypeScript, 43 unit/contract/security tests and the optimized Next.js production build pass.
- `scripts/test-generation.ts`: real installed Ollama `llama3.2:latest`, submitted prompt, durable job, streamed file operations, validation, offline Docker build and live HTTP app. 103 saved events on the successful initial run.
- `scripts/test-revisions.ts`: real Ollama follow-up changed the rendered heading to Field Notes and the subtitle to a reading journal. Exact source restoration and consistent SQLite restoration passed; a row added only to the newer revision was absent after restoring the original snapshot. Deliberately invalid TSX failed without promotion and the previous preview recovered. Every tested job replayed exactly the events after its saved cursor.
- `scripts/test-recovery.ts`: forcibly killed the worker during a code revision, restarted it, and verified the interrupted status, unchanged active source, identical saved data, restored live preview and replayable interruption event.
- Production browser suite: 8 passed, 1 optional live provider-check test skipped. This includes the real generated project, keyboard tab activation, local Monaco loading, protected files, history, 375/768/1440px layouts, and a real editor change followed by Save & rebuild and a successful preview. The skipped short provider-check inference was already verified in the provider milestone; real inference was exercised separately above.
- Actual production interface inspected through browser computer use. Local screenshots cover editor, history and responsive preview; screenshots were visually reviewed. Mobile screenshot capture scrolls the iframe into view so Chrome paints its content before capture.
- Preview boundary tests prove credential/header stripping, restrictive browser policy, denied foreign Host/cross-origin mutation, blocked redirects (including malformed URLs without crashing) and paused-runtime behavior. Existing file-policy and provider-failure tests remain passing. Quota and timeout fallback tests are fixtures, not claims of real Gemini verification.
- Repository and production browser bundles scanned against available secret values: no matches. `.env.local` remains ignored. `git diff --check` passed; complete source/configuration/dependency diff reviewed before commit.

## Findings corrected

The first real model output had an unquoted React client directive and failed compilation. A narrowly tested normalization repairs only that observed leading directive. The small local model also repeated much of the starter page; placing the requested task after the reference files produced the verified visible follow-up. This demonstrates the generation mechanism, not full adherence to every reading-journal feature in the initial prompt.

Actual UI inspection caught the workbench mounted in the header, and responsive review caught inaccessible project navigation on mobile. Both were corrected. Review also caught a completion-event race, a lost recovery pointer during builds, timeout fallback normalization and revision lockfile/image pinning; these were fixed and the relevant tests passed. A Host-header test initially used fetch, which did not transmit the intended override; the corrected test uses an actual HTTP request and confirms rejection.

Final dependency inspection found that Monaco's published browser assets embed DOMPurify 3.4.8 even with an npm override. The editor now bundles its source using esbuild and redirects the vendored sanitizer import to pinned DOMPurify 3.4.15. The build verifies its dependency graph, and browser tests inspect the served bundle for the patched version and absence of the old sanitizer before testing editing. Startup removes only its generated public copy before copying fresh assets, avoiding stale bundled files.

## Limits and handoff

Gemini is implemented and fixture-tested but remains unverified with a live account because no Gemini credential is configured. The user must privately configure GEMINI_API_KEY and an eligible GEMINI_MODEL in ignored .env.local and confirm its free-tier eligibility before setting GEMINI_FREE_TIER_CONFIRMED=true. No key creation, terms acceptance, billing, publishing or pushing was performed.

This is a local single-user developer preview with one active preview. Generated dependencies/configuration are fixed to the trusted Next.js template; the model currently emits page and stylesheet changes. Hosted authentication and other stacks are deferred. Small models can produce incomplete features or failed builds. Provider checks can be cancelled; a submitted durable generation job currently runs to its bounded completion/failure rather than exposing a job-cancel button. Abrupt crashes may lose writes after the last ten-second checkpoint. Runtime image deletion can prevent historical restoration. The root Forge web Dockerfile has not been integration-tested as a hosted deployment; verified operation is the local Node web server/worker plus Docker workspaces.
