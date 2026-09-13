# Forge design system

## Intent
A precise, calm place to shape software. OpenCode supplies the typographic and structural reference; Cursor supplies the product-demonstration composition. Forge retains its own name, artwork, copy, and mark. Full research provenance: docs/design/research.md.

## Typography
Self-hosted IBM Plex Mono: 400 body, 500 controls, 700 headings. Marketing hero 38px/1.5 desktop and 28px mobile. Marketing body 16px/1.85. App 14px/1.5, inputs 16px, metadata at least 12px. Marketing section titles 16px/700. App titles 22–28px/700 by context. Avoid compressed tracking. Other fonts only inside isolated presets: Inter, Instrument Serif, Press Start 2P.

## Tokens
Semantic tokens live in src/design/tokens.css. Light/dark values respectively:
- canvas #FDFCFC / #141111
- surface #F5F3F3 / #1C1818
- raised #ECE8E8 / #252020
- ink #201D1D / #F1EEEE
- muted #646262 / #AAA4A4
- border #D8D3D3 / #3A3434
- focus #2563EB / #8AB4FF
Spacing: 4, 8, 12, 16, 24, 32, 48, 64, 96px. Controls 4px radius. Hairline borders. Sections mostly square. Pills only for status and theme selector. Primary actions use contrasting neutral fills. No lime brand accents or ambient chrome gradients.

## Layout
Marketing max-width 1200px with bordered outer rails; inner gutters 64px desktop / 24px mobile. Section padding 96px / 48px. Left-aligned typographic hero. Large landscape-backed product demonstration. Three alternating feature rows. Five preset previews. Three numbered workflow figures, FAQ, closing action and compact footer.
App sidebar 220px, content flexible; builder combines the 220px workspace navigation, a 230–300px brief panel and remaining review panel. Below 1000px collapse project navigation into drawer; below 760px use brief/review tabs. Never hide navigation without a replacement.

## Themes
System default, explicit light/dark override in local storage, set before paint. Observe system changes only while preference is System. Preview theme is independent of shell. Native controls inherit color-scheme.

## Components and behavior
Use labeled inputs, native buttons and links, details/summary for FAQs, accessible tabs, focus-visible outline, and min 44px touch targets. Keep loading, disabled, empty, failure, and success distinct with text. Default local mode labels browser data and preview-only login. The opt-in cloud mode supplies Neon-backed authentication screens, guided onboarding and account briefs; service failures never imply a successful login or a switch to local storage. Cloud onboarding presents Idea, Direction, Review and Workspace stages. Connected account providers can produce text plans or standalone frontend HTML. Full-stack application generation remains unavailable. Optional NVIDIA text planning in local mode is explicitly labeled and only enabled when the local server reports a loaded key. Sample actions say Sample or Demo.

## Artwork and motion

Cloud follow-up: New project reuses the four-stage guide and saves its progress to the account. Replay introduction uses a keyboard-accessible native dialog with explicit Back/Next/Close controls and never resets projects. Optional hosted text planning is a separate, explicitly consented action on a saved brief; display the escaped response as text and never imply execution or deployment.
Original no-text artwork, provenance in docs/design/assets.json. Scenic art frames demonstrations and login only; no full-page moving Forge hero. UI remains HTML. Image dimensions prevent layout shift. Responsive WebP variants 640/1280/2048 where available. Retain neutral fallback canvas on media failure.
Transitions 160ms ease-out for color and opacity; walkthrough advances on explicit input. Reduced motion removes transitions. Any future looping video requires poster, pause control and reduced-motion static fallback. Current supplied videos are reference candidates, not production dependencies.

## Content
The optional `#/engine` workspace uses the existing Forge chrome and scoped semantic-token styles. It requires a server control session and shows explicit synthetic provenance while engine decisions remain open. Plan/source review content must load before approval is enabled. Unknown responses keep controls unavailable; local demo state never supplies a control identity. Source is escaped text, previews open only through an eventual authorized private service, and source export stays separate from deployment.

Do not invent customers, testimonials, metrics, provider availability, security guarantees, or deployed output. Figures explain Brief, Design and Review. Natural landscape greens are allowed; green brand styling is not. English only until translations exist; no decorative language switch.

## Reuse and validation
Cloud email verification accepts numeric email codes and supports resending the provider-configured verification email. Link-based verification remains supported. The email address stays only in tab memory during the auth flow; verification codes and passwords are never persisted by Forge. Social sign-in and linking actions appear only for methods explicitly listed by the account API; the default is email only.

Preset schema includes ID/version, paired tokens, fonts, recipes, artwork and guidance. Export ZIP packages with tokens, CSS, recipes, DESIGN.md and asset provenance. Keep user content as text. Add regression coverage for storage, theme and preset isolation. Review specimen route #/components and all five presets in both themes before accepting shared component changes.

## Direct DeepSeek frontend experiment
The loopback API now optionally supports DeepSeek text plans and single-document frontend generation. The Plan tab offers Generate website only when the direct provider advertises it. Generated HTML is held in tab memory, shown in an opaque-origin sandbox with scripts only and a restrictive CSP, and downloadable with approved local artwork embedded. No server-side execution, backend creation, real login, payments or deployment is implied. Existing deterministic samples remain separate. Forge chrome uses existing semantic tokens; generated project CSS cannot reach it.

## Account provider connections
Cloud Settings includes Your AI providers with masked key entry, checked connection state, replacement/removal, and request usage. Keys are encrypted server-side; checking access is an explicitly labeled small billable request. Saved projects offer text plans and standalone frontend generation using connected providers, with fixed output limits and clear provider billing copy. Frontends use an opaque-origin script-only sandbox and can be downloaded; outputs remain in tab memory. Never imply generated backend authentication, execution or deployment. Missing host configuration leaves connections unavailable without affecting account login.

## Design library and integrations
The local and account workspaces expose Design library and Connectors & MCP routes. Parable catalogs load over MCP with explicit loading, failure, empty, and checked-at states. Catalog entries retain original preview attribution and never replace the five scoped design studies. Starting with a design saves its descriptive reference into a new brief; it does not install or execute registry source.

MCP discovery reaches only host-configured HTTPS endpoints, with secrets resolved server-side. Configuration export is distinct from a successful connection. Custom tool execution and OAuth remain unavailable. Supabase Auth checks do not imply database or RLS verification. A separate downloadable starter supplies real Auth and owner-only database operations for users to configure and verify. All integration styles stay under integration-workspace and use shared semantic tokens. See docs/integrations.md for setup and completion boundaries.

## Open design direction
New briefs default to **My own design**, with optional style notes and design references. Built-in presets remain optional starting points; they do not limit the number or kinds of app and website designs. Explicit preset links still select that preset. Existing preset-based briefs retain their selection.

Custom design notes travel in a validated trailing section of the existing brief text (onboarding uses its features field), preserving compatibility with existing local exports and account APIs. The legacy preset ID is a compatibility fallback only for custom briefs; project cards and previews instead show Custom design. Reference URLs are saved text, not fetched source. Custom previews explain the pending generation instead of presenting a preset as the user's design. Combined text limits are checked before saving.
