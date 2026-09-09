import { topbar, footer, preview, escapeHTML as e, recovery, themes } from '../components/ui.ts'
import { getPreset, presets } from '../design/presets.ts'
import { presetCards } from './landing.ts'
export function designs(id?: string, mode = 'light'): string {
  const p = id ? presets.find((p) => p.id === id) : undefined
  return `<div class="marketing">${topbar()}<main>${
    !id
      ? `<section class="hero"><p class="eyebrow">FIVE DISTINCT POINTS OF VIEW</p><h1>A foundation for<br>something original.</h1><p class="hero-lede">Every system comes with paired themes, thoughtful typography,<br>and patterns you can take with you.</p></section><section class="preset-section"><div class="preset-grid">${presetCards()}</div></section>`
      : p
        ? `<section class="preset-detail"><a class="text-link" href="#/presets">← All design systems</a><div class="section-heading"><div><p class="eyebrow">DESIGN SYSTEM / V${p.version}</p><h1>${p.name}</h1><p>${p.description}</p></div><div class="detail-actions"><a class="button primary" href="#/new/${p.id}">Use this direction ↗</a><button data-action="download-preset" data-preset="${p.id}">Download package ↓</button></div></div><div class="preview-toolbar"><span>LIVE DESIGN STUDY</span><button data-action="preview-theme">${mode === 'light' ? 'Dark' : 'Light'} preview ◐</button></div>${preview(p.id, mode)}<div class="preset-spec"><section><h2>The visual language</h2><p>${p.guidance}</p><p>Display: ${p.displayFont}<br>Body: ${p.font}</p><div class="swatches">${Object.entries(
            p.themes[mode as 'light' | 'dark']
          )
            .map(([k, v]) => `<span><i style="background:${v}"></i>${k}<small>${v}</small></span>`)
            .join(
              ''
            )}</div></section><section><h2>Built to be reused</h2><p>Download tokens, scoped CSS, section recipes, artwork, font guidance and design documentation in a ZIP package.</p><p>Theme choice here changes only this preview.</p></section></div><div class="recipe-grid">${Object.entries(
            p.recipes
          )
            .map(([k, v]) => `<article><h3>${k}</h3><p>${e(v)}</p></article>`)
            .join('')}</div></section>`
        : recovery(
            'That design isn’t here.',
            'Explore the five available systems to find your direction.'
          )
  }</main>${footer()}</div>`
}
export function docs(): string {
  return `<div class="marketing">${topbar()}<main class="docs-page"><p class="eyebrow">FORGE / FIELD GUIDE</p><h1>A thoughtful starting point.</h1><p class="hero-lede">A local workspace for shaping a project before building it.</p><section><h2>What works today</h2><p>Create, edit, search, duplicate and save briefs in this browser. Choose among five design systems, inspect both themes, download their reusable packages, and explore a deterministic builder walkthrough.</p></section><section><h2>What the demo means</h2><p>No authentication takes place. Sample plans, files and checks are fixed examples. Preview is a design study, not a running generated app. No shell commands, builds or deployment run from the interface.</p><p>An optional local NVIDIA server can generate text plans when configured. A loaded key remains unverified until a successful request. That service is separate from the sample walkthrough.</p></section><section><h2>Your data</h2><p>Project briefs and appearance preferences stay in local browser storage. No account or cloud sync is implied. Use Settings to download a JSON backup; clearing browser data removes these briefs.</p><a class="text-link" href="#/settings">Manage local data →</a></section><section><h2>A reusable design foundation</h2><p>AGENTS.md directs interface work to DESIGN.md and the Forge design skills. Presets share a versioned contract, paired tokens, scoped CSS, recipes, and original artwork. Preview and download use the same definition.</p><a class="text-link" href="#/components">Explore the component specimen →</a></section><section><h2>References</h2><p>Typography and structure informed by <a href="https://opencode.ai/">OpenCode</a>. Demonstration composition informed by supplied Cursor screenshots. Artwork is original GPT Image 2.5 output. Mobbin private flows were not available for inspection.</p><p>The full cited research record and asset provenance live in the repository’s docs/design directory.</p></section><a class="button primary" href="#/new">Start a project →</a></main>${footer()}</div>`
}
export function components(): string {
  return `<div class="marketing">${topbar()}<main class="docs-page specimen"><p class="eyebrow">THE WORKING SPECIFICATION</p><h1>Quiet components.<br>Consistent behavior.</h1><section><h2>Appearance</h2>${themes()}<p>One set of semantic roles, two considered palettes.</p></section><section><h2>Actions</h2><div class="specimen-row"><button class="primary" data-action="specimen-feedback">Primary action →</button><button data-action="specimen-feedback">Secondary action</button><button disabled>Unavailable</button><a href="#/presets">Text link ↗</a></div></section><section><h2>Fields</h2><label>Project name<input placeholder="A clear, useful name"></label><label>Project brief<textarea placeholder="Start with the outcome…" rows="3"></textarea></label><label>Design system<select>${presets.map((p) => `<option>${p.name}</option>`).join('')}</select></label></section><section><h2>States</h2><p class="notice">Information: briefs stay in this browser.</p><p class="form-error">Error: your brief needs at least 20 characters.</p><p role="status">Saved: your project is ready to revisit.</p><p class="loading-example">◌ Loading a project…</p></section><section><h2>Disclosure</h2><details><summary>What belongs in a design system?</summary><p>Shared decisions about typography, spacing, color, behavior and content.</p></details></section><section><h2>Isolated presets</h2>${presets.map((p) => `<h3>${getPreset(p.id).name}</h3><div class="specimen-previews">${preview(p.id, 'light', undefined, true)}${preview(p.id, 'dark', undefined, true)}</div>`).join('')}</section></main>${footer()}</div>`
}
