---
name: forge-project-design
description: Apply or extend Forge's five reusable generated-project design presets, including isolated previews and downloadable design packages.
---
Read the selected preset in src/design/presets.ts and its export package. Outside the repository use references/presets.json. Preserve stable IDs and versions. A preset includes light/dark tokens, typography, navigation/hero/feature/CTA/footer/empty/error recipes, artwork provenance and motion guidance. Keep CSS scoped to the preview root. Never alter Forge chrome when changing a project preset.

Use one coherent preset per project, keep body copy readable, and retain user content when switching. Technical Mono is the default. Preview and export must use the same data. Validate each preset in both themes and ensure export includes tokens, recipes, guidance and asset references. No AI engine is implied by a static preview.
