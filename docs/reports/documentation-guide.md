# Documentation guide update

Tested source revision: `941c97bdc92486e223ff8cc945351b98735eac85`.

Replaced the short placeholder guide with 12 product chapters, ordered workflows, a creation-mode comparison, data/recovery explanations, capability states and troubleshooting. A complete Field Notes reading-tracker prompt starts with “Your own, describe your product well.” It includes requirements, visual intent, persistence, accessibility and acceptance checks. Copying it preserves the existing composer and does not submit a generation.

The page retains Forge’s approved palette, typography and public navigation. It adds a sticky desktop chapter index, a mobile disclosure index, shareable anchors, a copy action with a selected-text fallback, page-specific metadata, and reflow for narrow or magnified views. Updated DESIGN.md and its synced references describe documentation conventions. Next.js automatically added its installed-version guidance to AGENTS.md during local development.

Validation: Node 24.20.0 `npm run verify` passed lint, TypeScript, 92 tests and the production build. Ten production browser checks passed, including all six theme/width combinations, copy success/failure, composer preservation, no generation submission, anchors, keyboard interaction, 200% CSS zoom, reduced motion and legacy routes. Thirteen actual production screenshots and raw results are in [the evidence directory](../evidence/documentation/manifest.json). This is not a full screen-reader audit.

The demo prompt is instructional and was not submitted to a provider. No generation, cloud provisioning or unfinished product feature was activated by this documentation task. Existing hosted-beta release limitations remain unchanged.
