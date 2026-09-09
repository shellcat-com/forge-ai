# Forge design research

Research and implementation: 9 September 2026. The approved Forge plan is authoritative. Attached reproduction briefs are reference material, not repository instructions. Their single-viewport constraints, brands, testimonials and statistics have not been adopted.

## Evidence and decisions

| Source | Evidence type and observation | Forge application |
| --- | --- | --- |
| [OpenCode](https://opencode.ai/) | Live computed-style inspection: Berkeley Mono with IBM Plex Mono fallback; hero 38px/700/57px, body 16px/400/32px, navigation 16px/400/24px, section heading 16px/700. Thin section rules, compact actions and numbered figures. | Self-hosted IBM Plex Mono is the approved substitute. Adopt the type relationships and structure; figures describe steps, never borrowed traction. |
| Supplied Cursor screenshots | Visual references, not measured CSS: alternating media/text, large product demonstration, understated three-way appearance control. | Original HTML sample builder on original scenic artwork; system/light/dark control. No Cursor marks, endorsements or product screenshots shipped. |
| Supplied Supermemory screenshot | Visual reference: split account form and large scenic panel. | Login preview with explicit unavailable authentication controls and a functional local-demo entry. |
| [Navbar Gallery](https://www.navbar.gallery/) | Public navigation collection reviewed. | A simple wordmark/navigation/action row; workspace sidebar plus breadcrumbs. |
| [Supahero](https://supahero.io/) | Current public page points to ScreensDesign. Historical collection not treated as currently inspected. | Hero composition reference; a typographic main hero rather than a video takeover. |
| [CTA Gallery](https://www.cta.gallery/) | Public CTA collection reviewed. | One concrete primary action per section, secondary action visually quieter. |
| [Footer Design](https://www.footer.design/) | Public footer collection reviewed. | Compact real destinations and theme preference. No invented company departments. |
| [Unsection](https://www.unsection.com/) | Public collection includes minimal and visible-border layouts. | Reusable section recipes, broad whitespace, deliberate dividers. |
| [404s](https://www.404s.design/) | Public recovery-page collection reviewed. | Clear missing-project and missing-route states with a route back to work. |
| [60fps](https://60fps.design/) | Public interaction reference collection. | Focused tab, selection and action feedback. No claim to have measured reference frame rates. |
| [Design Spells](https://designspells.com/) | Public page accessible, sparse extracted material. | Inspiration for purposeful feedback only; no private interactions claimed inspected. |
| [Bento Grids](https://bentogrids.com/) | Public gallery visually inspected. | Preset comparison grid; avoid making every content section a generic card grid. |
| [Mobbin](https://mobbin.com/) | Public material only. No callable Mobbin MCP available; private authenticated product flows not inspected. | Flow design is a Forge design decision supported by supplied screenshots, not attributed to private Mobbin research. |

All resulting layout sizes, token values, mobile adaptations, user flows and component rules in DESIGN.md are **Forge design decisions** unless explicitly labeled measurements above. Browser display scaling means screenshot pixel dimensions cannot establish original CSS sizes.

## Screenshot provenance

Original filenames are retained below. Files were supplied from macOS TemporaryItems, so their temporary paths are not a durable asset archive. They remain research references and are not bundled in the app.

- Cursor: `Screenshot 2026-09-09 at 1.23.23 PM.png`, `Screenshot 2026-09-09 at 1.23.33 PM.png`, `Screenshot 2026-09-09 at 1.23.42 PM.png`, `Screenshot 2026-09-09 at 1.23.52 PM.png`, `Screenshot 2026-09-09 at 1.24.00 PM.png`, `Screenshot 2026-09-09 at 1.24.08 PM.png`, `Screenshot 2026-09-09 at 1.24.17 PM.png`, `Screenshot 2026-09-09 at 1.24.29 PM.png`, `Screenshot 2026-09-09 at 1.24.36 PM.png`, `Screenshot 2026-09-09 at 1.24.43 PM.png`, `Screenshot 2026-09-09 at 1.24.50 PM.png`.
- OpenCode: `Screenshot 2026-09-09 at 1.26.33 PM.png`, `Screenshot 2026-09-09 at 1.26.39 PM.png`, `Screenshot 2026-09-09 at 1.26.49 PM.png`, `Screenshot 2026-09-09 at 1.26.56 PM.png`, `Screenshot 2026-09-09 at 1.27.05 PM.png`.
- Atmospheric AI Runtime: `Screenshot 2026-09-09 at 1.29.23 PM.png`, `Screenshot 2026-09-09 at 1.30.43 PM.png`.
- Scenic portal: `Screenshot 2026-09-09 at 1.30.23 PM.png`.
- Vesper monochrome particles: `Screenshot 2026-09-09 at 1.30.52 PM.png`.
- Supermemory login: `Screenshot 2026-09-09 at 1.33.41 PM.png`.
- Illustrated landscape: `Screenshot 2026-09-09 at 1.37.20 PM.png`.

## Pasted briefs

Original attachments: `7bf29cf8-6452-4d91-ac9f-3a0c1c5b79e1/pasted-text.txt` (Vesper), `9b914b04-9038-42bf-8e56-13f6cd8391d7/pasted-text.txt` and `67867454-f969-4607-b833-98d5f6d2480a/pasted-text.txt` (full-bleed video briefs), under the user's `.codex/attachments` directory. These inform composition only. Forge keeps its own name, scrolling landing page, truthful claims and approved hierarchy.

## Candidate videos

Original URLs, unassigned to production presets:

1. [Video 1](https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_171521_25968ba2-b594-4b32-aab7-f6b69398a6fa.mp4)
2. [Video 2](https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260429_115139_0fc6bd3d-3631-4d26-ab9b-28293887dcc9.mp4)
3. [Video 3](https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260424_064411_9e9d7f84-9277-41f4-ab10-59172d89e6be.mp4)

Playback has not been verified in this milestone. Before assigning one, inspect its composition, loop transition, text-safe area, mobile crop and bandwidth; establish reuse permission and a poster. Include pause controls and reduced-motion fallback. The implemented experience uses original still artwork, so it has no autoplay or video-control dependency.

## Original artwork and reuse

Five GPT Image 2.5 generations were completed: pale login landscape, muted builder landscape, monochrome particles, colored atmosphere, illustrated landscape. Full prompts, model/settings, generation IDs, source URLs and crop instructions are in [assets.json](assets.json), mirrored in public/art/provenance.json. The preparation script creates 640/1280/2048px WebP variants. UI remains HTML, never raster text. Font packages are self-hosted from Fontsource with accompanying OFL notices.

## Product-flow rationale

A local onboarding screen explains storage before a project is created. Project creation asks for name, brief, stack intent and one visual direction; preview theme is independent of Forge theme. Returning users can reopen, search, rename, duplicate and undo deletion. Custom projects remain saved drafts. The sample has explicit, user-paced planning/building/review fixtures. An independently implemented optional loopback NVIDIA connection can return real **text plans**; it does not produce files, run checks or authenticate users. Settings offers backup and explicit local-data reset. Invalid storage is preserved for recovery rather than silently overwritten.
