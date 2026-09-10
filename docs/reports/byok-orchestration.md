# BYOK and multi-model implementation evidence

Status: draft; not qualified for hosted or live-provider release. Source is isolated on `codex/byok-orchestration`, based on merged master `42a3763` and preserved PR #8 dependency `4afc9cb`. No deployment or merge is authorized by this report. The other release task's single-model beta remains independent.

## Delivered source

- Tenant/session-bound connection storage, AES-256-GCM credential envelopes, rotation/deletion, redacted APIs and explicit self-hosted environment references.
- Native Responses, Messages, Gemini and Ollama adapters, DeepSeek/Groq/OpenRouter chat adapters, and declared-protocol public/custom connections.
- Separate discovery and paid text/structured/research tests; several connections to the same provider; account task defaults and project overrides.
- Research/planning/coding/review/repair assignments, constrained Auto, explicit fallback lists, snapshots and durable attempts. No implicit operator key or Ollama fallback.
- Transactional reservations, shared internal testing liability, cancellation/restart handling and no automatic replay of unknown remote outcomes.
- New PostgreSQL application revisions, isolated Node test stage, pinned runtime/database image metadata and retained legacy SQLite revisions. Hosted admission and worker startup remain disabled.

Application migration `0006_byok_orchestration.sql` is unpublished additive feature work. Number 0004 is reserved by the active beta integration; published application and engine migrations are not renumbered. The live application uses the Next.js database/job path; the RFC control service remains an explicit laboratory harness, not a second live BYOK worker.

## Evidence recorded during implementation

- Actual Node **24.20.0**, official darwin-arm64 archive verified against official SHASUMS256. Homebrew's misleading Node 24 path resolved to Node 25, so checks explicitly selected the verified binary.
- An intermediate `npm run verify` passed lint, both TypeScript checks, **845 tests**, and production build (**5 skipped**). It predates the last additional orchestration and transport cases and is not final-source acceptance.
- The later full run passed **838**, failed **10** existing control/preview native timing cases, and skipped **5** during overlapping PostgreSQL campaigns from other tasks. No timeout assertions were weakened. Native campaigns are now coordinated serially; Vitest limits local worker count.
- Final protocol/transport/accounting/runtime-contract tests: **47 passed**. These include native protocol fixtures, refusal/truncation handling, DNS answer pinning, mixed/private/IPv6 rejection, rebinding, redirects, cancellation, destination-bound credentials, conservative pricing and restricted sidecar command construction. They do not launch Docker or contact real providers.
- The latest completed full run passed all **15 BYOK native PostgreSQL cases** before the last small connection-concurrency change. Tests use a dedicated cluster and a non-superuser application role with forced RLS, real transactions and synthetic model responses. They cover tenant/session isolation, competing rotations, duplicate dispatch, cancellation, uncertain liability, call limits, routing constraints, manual cross-connection task handoffs, explicit fallback, restart recovery and shared budget reservation. The final-source serial rerun passed, as recorded below.
- Browser: **8 passed** with isolated PostgreSQL and a synthetic provider. Two connections to the same provider survive reload; capability tests and task assignments persist; deletion removes the connection; API responses/storage omit synthetic keys; foreign-origin mutation fails. Six captured light/dark layouts at **390/768/1440px** were visually inspected; keyboard focus and reduced motion were checked. Zoom coverage is a **200% CSS zoom simulation**, not a claim of native browser zoom testing.
- Production build, lint and TypeScript checks passed after the major changes. Final commit checks and CI are recorded below as they complete.

Local dependency installation initially failed with ENOSPC. Dependencies were recovered by APFS copying an installation with the identical verified lockfile; no shared installation was modified. A clean `npm ci` remains a CI requirement. Local evidence/logs/screenshots live in ignored `.private` or `/tmp`; they contain synthetic fixtures only.

## Release blockers

1. OpenAI, Anthropic and DeepSeek live acceptance has **not run**. No private test keys or complete exact-model pricing policies have been configured for this task. Paid-provider spend: **$0 of the authorized $10**. The shared durable campaign cap must be enabled before every live diagnostic/run.
2. Docker daemon checks time out. Actual PostgreSQL sidecar boot, generated app tests/build/preview/CRUD/snapshot/restore and network restrictions are **not yet accepted** on this machine. Mock command assertions are not isolation evidence.
3. Hosted tenant-safe runtime, durable preview authorization and deployment integration are unavailable here. Hosted generation remains disabled. Local Docker success, when obtained, will not clear this blocker.
4. Other providers/custom endpoints are not live-qualified. Context limits, provider entitlement, pricing and feature support require exact-model validation; discovery alone never certifies them.
5. CI must pass on the reviewed commit; consult the draft PR checks for its current result. Keep the PR draft until the live/runtime blockers above are resolved and do not merge automatically.

For setup, API contracts, credential rotation/backup handling, destination policy, budgeting and migration instructions, see [the architecture and operating guide](../byok-orchestration.md).

## Final local verification

After coordinating exclusive native test execution, all required local checks passed with Node 24.20.0:

| Check | Result |
| --- | --- |
| `npm run verify` | PASS: lint, both TypeScript targets, **856 tests passed / 5 skipped**, production Next.js build |
| BYOK tests within that run | **62 passed**, including **15 native PostgreSQL** tests |
| `npm run test:byok:browser` | **8 passed**, 13.4 seconds, synthetic provider and isolated native PostgreSQL |
| `npm run test:db:control` | PostgreSQL **14.18**, **45 constraint/RLS assertions passed** |
| `npm run control:build` | PASS |
| `git diff --check` and credential-pattern scan | PASS; no matching credentials in owned staged text |

The previous contended timing failures are retained above for transparency and did not recur in the serial campaign. No test assertions or timeouts were loosened. CI additionally installs dependencies cleanly and runs the synthetic browser acceptance on Linux. Real model-provider and Docker/hosted acceptance remain unperformed; these local passes do not clear those release gates.
