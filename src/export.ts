import { zipSync, strToU8 } from 'fflate'
import { getPreset, presetCSS } from './design/presets.ts'
export function downloadFile(name: string, content: BlobPart, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function presetPackage(id: string): Promise<Uint8Array> {
  const preset = getPreset(id)
  const files: Record<string, Uint8Array> = {
    'tokens.json': strToU8(JSON.stringify(preset.themes, null, 2)),
    'preset.json': strToU8(JSON.stringify(preset, null, 2)),
    'tokens.css': strToU8(presetCSS(preset)),
    'recipes.json': strToU8(JSON.stringify(preset.recipes, null, 2)),
    'DESIGN.md': strToU8(
      `# ${preset.name}\n\nVersion ${preset.version}\n\n${preset.guidance}\n\nDisplay: ${preset.displayFont}. Body: ${preset.font}.\n\nUse the project-preview root with data-preset and data-preview-theme attributes from tokens.css. Apply --p-* variables to your own layout; the archive is a design system, not an application generator.\n\n${Object.entries(
        preset.recipes
      )
        .map(([key, value]) => `## ${key}\n${value}`)
        .join(
          '\n\n'
        )}\n\n## Motion\n${preset.motion}\n\n## Fonts\nFont sources: https://github.com/IBM/plex ; https://github.com/rsms/inter ; https://github.com/weiweihuanghuang/Instrument-Serif ; https://fonts.google.com/specimen/Press+Start+2P . Acquire font files under their accompanying OFL licenses.\n\n## Artwork\nOriginal Forge GPT Image 2.5 artwork. See asset-provenance.json. No competitor screenshots or logos included.\n`
    ),
  }
  if (preset.asset) {
    const [asset, provenance] = await Promise.all([
      fetch(`/art/${preset.asset}-2048.webp`),
      fetch('/art/provenance.json'),
    ])
    if (!asset.ok || !provenance.ok)
      throw new Error('Artwork is unavailable. Please retry the download.')
    files[`art/${preset.asset}.webp`] = new Uint8Array(await asset.arrayBuffer())
    const all = (await provenance.json()) as { name: string }[]
    files['asset-provenance.json'] = strToU8(
      JSON.stringify(
        all.filter((a) => a.name === preset.asset),
        null,
        2
      )
    )
  } else
    files['asset-provenance.json'] = strToU8(
      JSON.stringify({ artwork: 'No raster artwork; use CSS lines and figures.' }, null, 2)
    )
  return zipSync(files)
}

export async function exportPreset(id: string): Promise<void> {
  const preset = getPreset(id)
  const archive = await presetPackage(id)
  downloadFile(
    `forge-${preset.id}-v${preset.version}.zip`,
    archive.slice().buffer,
    'application/zip'
  )
}
