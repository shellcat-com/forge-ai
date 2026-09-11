# Provider transport and encrypted storage milestone

2026-09-10. The full hosted release remains incomplete. These changes do not enable generation, worker dispatch, private previews or publication.

## Verified changes

- Explicit Gemini/Groq/OpenRouter request dialects, pinned provider/model binding, no automatic retry/fallback, OpenRouter free variant and zero maximum-price constraints, strict returned-model checks and source-output validation. No actual provider call was made. Request compatibility and zero-price accounting passed 121 focused tests alongside the existing provider suites.
- Zero-price policies require explicit expiring free-entitlement evidence; numbered PostgreSQL attempts, twelve-call limit and one-winner dispatch remain enforced. Twenty concurrent synthetic zero-cost calls admitted exactly twelve. Actual entitlement verification and the authoritative hosted dispatch gate remain required.
- Published engine migration 0006 for immutable encrypted source objects with separate reader/writer/maintenance roles, a 64 MiB retained-ciphertext cap and 10,000 lifetime object identities. Quota reservations are atomic; failed writes preserve old readable source. Purge releases bytes but preserves counted tombstones. Native storage and combined readiness checks passed 34/34 tests.
- Installed object schema and the three separate restricted object logins on the existing dedicated Neon Free database. All three role checks passed over verified TLS. An additive checked companion registers version 6 without rewriting its already-installed SQL. Schema replay passed and existing runtime credentials were preserved. No source data or job was created by this live installation check.
- Added the reviewed readiness correction from source commit 853cf93, integrated as 8160567. It uses actual Better Auth/E1 validators and read-only runtime connections. It explicitly distinguishes foundation checks from unperformed live acceptance and never reports release-ready.

## Reproductions and fixes

The first combined rerun had 905 passing tests and 26 failures while the Mac's disk space was exhausted and the system was under contention. After removing only inactive/rebuildable Forge caches, the targeted campaign passed storage, E2 integration, provider and accounting suites; one preview timeout remained. Further reruns showed full E2 fixture setup consuming the preview tests' five-second security-operation deadline. The suite now prepares the same complete E2 fixtures in setup hooks. All assertions, pipeline steps, lease rules and operation deadlines are preserved. The entire preview suite then passed 23/23. Failed runs remain separate from the successful rerun.

One Neon schema replay attempted an unnecessary `SET LOCAL ROLE forge_object_guard`; Neon denied that switch with SQLSTATE 42501. A diagnostic showed the migration owner has BYPASSRLS and membership is not equivalent to permission to switch roles. Healthy replay now preserves the existing capacity row without switching roles; missing-row recovery derives counts from actual retained objects using appropriate migration authority. The corrected live replay passed. The initial schema and working runtime roles were preserved throughout.

A subsequent local `npm run verify` passed lint but stopped at TypeScript with explicit ENOSPC while writing `tsconfig.tsbuildinfo`. This is retained as a failed run. Further full verification moves to the existing GitHub CI runner rather than repeatedly exhausting the shared Mac. The exact code commit `2a20197506b7c69d27fc2cb5214a665b1184c206` subsequently passed [full CI](https://github.com/shellcat-com/forge-ai/actions/runs/34543481205): lint, types, 961 tests (5 existing optional skips), production build, 45 native control assertions and standalone control build. This closes that code verification failure; it does not close live release acceptance.

## Delivery and limits

See [provider contracts](../../../operations/hosted-provider-generation.md), [storage configuration and rollback](../../../operations/hosted-source-storage.md), and [readiness operations](../../../operations/hosted-readiness.md). Private runtime passwords and versioned encryption configuration are mode-0600 ignored files, never evidence. Real Gmail verification/recovery still awaits a dedicated app password; real generation awaits a user model key plus worker composition. Existing fixture execution is not relabeled as provider execution. Production remains the availability page and the PR remains draft, with no merge.
