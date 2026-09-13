# Architecture

Forge keeps the Vite + strict TypeScript stack. Hash routing allows the complete UI to run on static hosting without server route rewrites.

## Implemented modules

| Module | Responsibility |
| --- | --- |
| src/main.ts | Route and event coordination, dialogs, project mutations, optional planning requests |
| src/pages/ | Public, workspace and design-system screens |
| src/components/ui.ts | Escaped markup, shared navigation, buttons, artwork, previews and recovery |
| src/design/ | Semantic Forge tokens and five versioned preset definitions |
| src/theme.ts + public/theme-init.js | Validated system/light/dark preference; prepaint theme application |
| src/storage.ts | Versioned local persistence, record validation, recoverable read/write failures |
| src/project.ts | Original draft normalization and canGenerate readiness contract |
| src/demo.ts | Deterministic sample sequence and illustrative file fixtures |
| src/export.ts | Reusable preset ZIP packages |
| server/ | Optional loopback NVIDIA text-planning API; server-side credentials |

Projects contain an ID, normalized draft, preset ID/version and timestamps. A corrupt or unsupported storage payload is not silently overwritten. Write failure leaves in-memory work accessible with recovery feedback. Backup is available from Settings. Browser storage is not authentication and cannot provide cross-device persistence.

Preset styles use --p-* tokens scoped beneath their preview root. Forge uses its own theme tokens. The preset gallery, live brief preview, builder preview and export all use the same data. Fonts are bundled through Fontsource; responsive original artwork is served from public/art.

## Capability boundaries

Static deployment supports the complete local frontend. When the separate NVIDIA API is configured, an explicit Generate plan action sends a brief to the selected provider and returns escaped text. This is not file generation or execution. The deterministic sample remains separate from actual project/provider data.

Authentication, durable server projects, streaming orchestration, generated file writes, isolated preview environments and deployment are future work. A future runner must be disposable, resource limited and separate from the control API, with scoped mounts, explicit network policy and reviewable diffs. Static Nginx serving is not such a runner.

## Proposed app-generation architecture

[RFC 0001: First executable app-generation slice](rfcs/0001-app-generation-vertical-slice.md) defines the required Next.js + strict TypeScript + PostgreSQL generated stack. Its independent E0 foundation now exists in `engine/`: versioned runtime contracts, deterministic transitions, approval/hash/path checks, explicit provider/runner fakes and an initial `forge_control` PostgreSQL migration. These modules are not connected to the frontend or prototype API and enable no generated-code execution. Durable service, real generation, isolated execution and previews remain gated future stages. See the [E0 checklist and E1 handoff](reports/e0-contracts.md); no frontend rewrite or vendor selection is implied.

## Maintenance

DESIGN.md and repository skills are maintained sources. Run npm run skills:sync after updates. Run npm run verify and review affected routes in both themes and responsive widths; see docs/design/verification.md. No user text should enter raw HTML, and provider credentials must never enter client code or exports.
