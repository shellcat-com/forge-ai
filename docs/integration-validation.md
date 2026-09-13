# Integration validation — September 11, 2026

## Passed

- Live Parable MCP initialization and discovery: four tools.
- Live catalog loading: 78 templates and 88 components. These counts came from the live service, not fixtures.
- Fourteen focused regression tests covering MCP initialization/session cleanup, paginated discovery, open SSE streams, credential omission, malformed configuration, unknown destinations, upstream failures, catalog validation/cache, safe configuration export, and Supabase connection boundaries.
- PostgreSQL-compatible PGlite queries verified note ownership for select/insert/update/delete, prohibited owner reassignment, cross-user denial, and anonymous denial.
- Strict TypeScript checking for the integration modules and focused ESLint checks passed.
- Modified local/cloud entry modules and HTTP handlers passed TypeScript/JavaScript syntax transformation checks.
- The generated Supabase starter installed with pinned dependencies and built successfully with Vite. Its archive includes the resulting lockfile. No hosted Supabase project was provisioned.
- Browser harness: real catalog load, search for Neon, design-reference handoff, successful four-tool MCP discovery, MCP configuration download, and Supabase starter download.
- Design-library and connector layouts inspected in light/dark at 390, 768, and 1440 CSS pixels. Connector pages reported no horizontal overflow at all three widths. Header crowding and filter alignment found during inspection were fixed.
- Keyboard Tab reached an interactive control with a visible solid focus outline.

## Limits and release blockers

`npm run verify` was invoked in the actual repository. It reached the lint stage but could not finish because repository configuration and dependency files were offloaded to iCloud and blocked on filesystem reads. Git status was likewise blocked reading offloaded Git metadata. These stalled processes were stopped; the full verification suite and full repository diff review are not reported as passing.

Focused verification used an isolated temporary runtime with copies of the changed source. The browser harness used the production integration module, shared markup/styles, and live public API. Unavailable shared theme/export/token utility files were supplied by their existing local Forge copy. This is narrower than an end-to-end test of the complete application. Current authenticated account creation, persistence, provider generation, and deployment were not exercised. Rerun the required full suite and both local/account project flows once the workspace and dependencies are available locally.

The system did not have reduced motion enabled. The scoped reduced-motion CSS was inspected, but an emulated reduced-motion browser session and native 200% browser zoom were not completed. All five pre-existing preset screens were not revalidated in this run; their definitions and preview styles were not changed.

No external provider key, Supabase project credential, MCP OAuth session, or deployment target was configured or modified. Supabase Auth success was tested through an injected response and SQL policy behavior through PGlite; live email confirmation, hosted database access, storage, and two real users still need validation.

See [the completion audit](integrations.md) for feature scope and the remaining acceptance criteria. Do not treat this validation as a production-readiness or competitor-parity claim.

## Open design follow-up — September 11
New local briefs and account onboarding now default to custom design. Optional presets preserve old IDs and saved selections. Style notes and reference descriptions travel in the existing brief text, including local JSON export and account onboarding completion; custom previews and project labels never present the compatibility preset as the chosen design. Reference pages are not automatically fetched.

Focused validation uses `/tmp/forge-validation-runtime` because original iCloud placeholders still stall normal dependency reads. Changed sources are copied from this workspace; stable project/storage/demo helpers use the existing local `forge-unified` copy. Account tests mock authentication/API responses and use resolution-only placeholders for the unavailable client module and stylesheet. They do not verify a live account service.

Coverage: freeform default, explicit preset links, custom save/edit/export round-trip, switch preservation, escaping, legacy/malformed text preservation, combined-length errors, and account onboarding Back/feature editing/project editing. Focused TypeScript validation covers the design modules and local page; both main entry points pass lint and TypeScript transpilation. The local browser flow saves and reopens a custom project; light/dark form layouts were inspected at 390, 768 and 1440px without horizontal page overflow. Keyboard Tab reaches references with a visible focus outline. New components have no animations; actual reduced-motion preference emulation remains unverified. Full `npm run verify` was attempted again but stalled in ESLint on offloaded files and was stopped. Live generation and deployment were not run.

Open design results: 11 focused tests across four files passed. The form also remains within the viewport with the harness set to 200% CSS zoom; this is not a native browser zoom test.
