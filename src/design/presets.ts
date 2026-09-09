export const presetIds = [
  'technical-mono',
  'editorial-product',
  'cinematic-monochrome',
  'atmospheric-pixel',
  'illustrated-landscape',
] as const
export type PresetId = (typeof presetIds)[number]
export interface Palette {
  canvas: string
  surface: string
  ink: string
  muted: string
  border: string
  accent: string
}
export interface DesignPreset {
  id: PresetId
  version: number
  name: string
  description: string
  font: string
  displayFont: string
  asset: string
  headline: string
  themes: { light: Palette; dark: Palette }
  recipes: Record<'navigation' | 'hero' | 'feature' | 'cta' | 'footer' | 'empty' | 'error', string>
  guidance: string
  motion: string
}
const light: Palette = {
  canvas: '#fdfcfc',
  surface: '#f5f3f3',
  ink: '#201d1d',
  muted: '#646262',
  border: '#d8d3d3',
  accent: '#201d1d',
}
const dark: Palette = {
  canvas: '#141111',
  surface: '#1c1818',
  ink: '#f1eeee',
  muted: '#aaa4a4',
  border: '#3a3434',
  accent: '#f1eeee',
}
const recipes = {
  navigation:
    'Wordmark left, two section links, one primary action. Collapse links on small screens.',
  hero: 'One headline, supporting sentence, one primary action; retain legible contrast at every width.',
  feature: 'Three concise capabilities with distinct headings and deliberate whitespace.',
  cta: 'One action with a concrete outcome; avoid fake urgency.',
  footer: 'Brand, real navigation links and appearance preference.',
  empty: 'Explain what belongs here and provide one starting action.',
  error: 'State the failure in plain language, preserve entered content and offer retry or home.',
}
const entries = [
  {
    id: 'technical-mono',
    name: 'Technical Mono',
    description: 'Structure, precision, and room to think.',
    font: 'IBM Plex Mono',
    displayFont: 'IBM Plex Mono',
    asset: '',
    headline: 'Build something\nworth using.',
    guidance:
      '38px bold mono headline, 16px body, 4px controls, ruled sections and numbered figures. No decorative gradients.',
  },
  {
    id: 'editorial-product',
    name: 'Editorial Product',
    description: 'An open canvas for ambitious products.',
    font: 'Inter',
    displayFont: 'Inter',
    asset: 'landscape',
    headline: 'Good ideas deserve\na beautiful home.',
    guidance:
      'Regular-weight 40px display, readable sans body, broad product demonstrations, ample white space and quiet neutral controls.',
  },
  {
    id: 'cinematic-monochrome',
    name: 'Cinematic Monochrome',
    description: 'A little atmosphere. A clear point of view.',
    font: 'Inter',
    displayFont: 'Instrument Serif',
    asset: 'particles',
    headline: 'A new perspective\non what’s possible.',
    guidance:
      'Monochrome artwork, restrained serif display emphasis, sans body, centered composition and strong text scrim.',
  },
  {
    id: 'atmospheric-pixel',
    name: 'Atmospheric Pixel',
    description: 'Digital character with a softer edge.',
    font: 'Inter',
    displayFont: 'Press Start 2P',
    asset: 'atmosphere',
    headline: 'Ideas,\nin another dimension.',
    guidance:
      'Pixel display limited to short headlines at 22px; sans body at 16px. Muted rose/lavender artwork. No pixel paragraphs.',
  },
  {
    id: 'illustrated-landscape',
    name: 'Illustrated Landscape',
    description: 'A more human corner of the internet.',
    font: 'Inter',
    displayFont: 'Inter',
    asset: 'illustration',
    headline: 'Make room\nfor your next idea.',
    guidance:
      'Scenic illustration with readable text panel, generous composition, 40px sans headline and minimal controls. Natural landscape color is welcome.',
  },
] as const
export const presets: DesignPreset[] = entries.map((entry) => ({
  ...entry,
  version: 1,
  themes: { light: { ...light }, dark: { ...dark } },
  recipes: { ...recipes },
  motion:
    '160ms opacity/color transitions only; reduced motion disables transitions. Any future video uses a poster and pause control.',
}))
export function getPreset(id: string): DesignPreset {
  return presets.find((p) => p.id === id) ?? presets[0]
}
export function isPresetId(id: unknown): id is PresetId {
  return presetIds.includes(id as PresetId)
}
export function presetCSS(preset: DesignPreset): string {
  return ['light', 'dark']
    .map((mode) => {
      const tokens = preset.themes[mode as 'light' | 'dark']
      return `.project-preview[data-preset="${preset.id}"][data-preview-theme="${mode}"] {\n${Object.entries(
        tokens
      )
        .map(([key, value]) => `  --p-${key}: ${value};`)
        .join('\n')}\n  --p-font: '${preset.font}';\n  --p-display: '${preset.displayFont}';\n}`
    })
    .join('\n')
}
