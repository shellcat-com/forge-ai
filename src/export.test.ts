import { afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { presetPackage } from './export.ts'
import { presets } from './design/presets.ts'
afterEach(() => vi.unstubAllGlobals())
describe('preset package downloads', () => {
  it('exports matching tokens, recipes, scoped CSS and only the selected artwork', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('provenance.json')
          ? new Response(
              JSON.stringify(
                presets
                  .filter((p) => p.asset)
                  .map((p) => ({ name: p.asset, model: 'gpt_image_2_5' }))
              )
            )
          : new Response(new Uint8Array([1, 2, 3]))
      )
    )
    for (const preset of presets) {
      const files = unzipSync(await presetPackage(preset.id))
      expect(JSON.parse(strFromU8(files['preset.json']))).toEqual(preset)
      expect(JSON.parse(strFromU8(files['tokens.json']))).toEqual(preset.themes)
      expect(JSON.parse(strFromU8(files['recipes.json']))).toEqual(preset.recipes)
      expect(strFromU8(files['tokens.css'])).not.toContain(':root')
      expect(strFromU8(files['DESIGN.md'])).toContain(preset.guidance)
      if (preset.asset) {
        expect(files[`art/${preset.asset}.webp`]).toEqual(new Uint8Array([1, 2, 3]))
        expect(JSON.parse(strFromU8(files['asset-provenance.json']))).toHaveLength(1)
      }
    }
  })
  it('reports asset download failure instead of producing an incomplete package', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    )
    await expect(presetPackage('editorial-product')).rejects.toThrow('Artwork is unavailable')
  })
})
