---
name: forge-project-design
description: Maintain Forge's five optional generated-project design examples, including isolated previews and downloadable design packages.
---
Read the selected preset in src/design/presets.ts and its export package. Outside the repository use references/presets.json. Preserve stable IDs and versions. A preset includes light/dark tokens, typography, navigation/hero/feature/CTA/footer/empty/error recipes, artwork provenance and motion guidance. Keep CSS scoped to the preview root. Never alter Forge chrome when changing a project preset.

Examples are optional starting points. Generated projects may use any coherent visual direction within the supported runtime. Explicit user instructions override example guidance. Missing or unknown example IDs mean no selected example; never silently select Technical Mono. Keep body copy readable and retain user content when switching examples. Preview and export must use the same data. Validate each preset in both themes and ensure export includes tokens, recipes, guidance and asset references. No AI engine is implied by a static preview.
