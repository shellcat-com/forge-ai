# Forge design system

## Intent
A precise, calm place to shape software. OpenCode supplies the typographic and structural reference; Cursor supplies the product-demonstration composition. Forge retains its own name, artwork, copy, and mark. Full research provenance: docs/design/research.md.

## Typography
Self-hosted IBM Plex Mono: 400 body, 500 controls, 700 headings. Marketing hero 38px/1.5 desktop and 28px mobile. Marketing body 16px/1.85. App 14px/1.5, inputs 16px, metadata at least 12px. Marketing section titles 16px/700. App titles 22–28px/700 by context. Avoid compressed tracking. Example previews use Inter, Instrument Serif, and Press Start 2P inside scoped roots. Generated applications may choose other appropriate fonts inside isolated previews.

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
Marketing max-width 1200px with bordered outer rails; inner gutters 64px desktop / 24px mobile. Section padding 96px / 48px. Left-aligned typographic hero. Large landscape-backed product demonstration. Three alternating feature rows. Five optional example previews. Three numbered workflow figures, FAQ, closing action and compact footer.
App sidebar 220px, content flexible; collapse global navigation inside projects. The workbench places conversation beside a persistent preview, with Code, History and Review tools. Keep the composer primary on Home. At narrow widths use a navigation drawer and readable stacked panels; dedicated mobile panel switching is planned. Never hide navigation without a replacement.

## Themes
System default, explicit light/dark override in local storage, set before paint. Observe system changes only while preference is System. Preview theme is independent of shell. Native controls inherit color-scheme.

## Components and behavior
Use labeled inputs, native buttons and links, details/summary for FAQs, accessible tabs, focus-visible outline, and min 44px touch targets. Keep loading, disabled, empty, failure, and success distinct with text. Local workspaces are labeled. Generation uses the configured worker and isolated Docker runtime. Better Auth methods appear only when their server configuration exists; hosted release requires further cloud verification. Optional NVIDIA text planning remains a separate loopback service. Sample actions say Sample or Demo.

## Artwork and motion
Original no-text artwork, provenance in docs/design/assets.json. Scenic art frames demonstrations and login only; no full-page moving Forge hero. UI remains HTML. Image dimensions prevent layout shift. Responsive WebP variants 640/1280/2048 where available. Retain neutral fallback canvas on media failure.
Transitions 160ms ease-out for color and opacity; walkthrough advances on explicit input. Reduced motion removes transitions. Any future looping video requires poster, pause control and reduced-motion static fallback. Current supplied videos are reference candidates, not production dependencies.

## Content
Do not invent customers, testimonials, metrics, provider availability, security guarantees, or deployed output. Figures explain Brief, Design and Review. Natural landscape greens are allowed; green brand styling is not. English only until translations exist; no decorative language switch.

## Reuse and validation
Preset schema includes ID/version, paired tokens, fonts, recipes, artwork and guidance. Export ZIP packages with tokens, CSS, recipes, DESIGN.md and asset provenance. Keep user content as text. Add regression coverage for storage, theme and preset isolation. Review specimen route #/components and all five presets in both themes before accepting shared component changes.

## Optional examples
The five packages are inspiration, never a mandatory product constraint. Automatic and written custom design directions work without an example. Unknown examples do not select Technical Mono. Explicit user direction takes precedence. Forge chrome retains these tokens while generated applications own their appearance.

## Product documentation
The Documentation route uses the same public navigation, neutral tokens and type family. Give long-form guidance a bounded reading column, a sticky chapter index on wide screens and a collapsible index on narrow screens. Chapter anchors must remain on the guide route. Use numbered workflows, semantic tables, disclosure controls for troubleshooting, and contextual notes for product limits. A copyable example prompt must preserve the user's existing composer and must not submit a request. Keep capability descriptions tied to implemented behavior; distinguish source, preview, application data and public deployment. Documentation wording is calm, specific and action-oriented.

## User-owned model setup
Connections uses labeled secret inputs, searchable connection cards, distinct discovery and paid capability-test states, rotate/delete controls, and account task assignments. Secrets never persist in browser storage. Manual and Auto modes expose Research, Planning, Coding, Review and Repair. Each request shows its model settings and shared call/repair limits; activity shows usage, source links and recoverable failures. Dollar estimates, unknown charges and provider billing remain explicit. Keep these forms scoped to `.byok-*`, neutral, keyboard accessible and readable at 390px. Empty connections link to setup; hosted builds stay visibly unavailable until runtime acceptance.
