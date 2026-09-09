import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
const manifest = JSON.parse(await readFile('docs/design/assets.json', 'utf8'))
for (const asset of manifest) {
  const response = await fetch(asset.source)
  if (!response.ok) throw new Error(`Asset ${asset.name}: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  for (const width of [640, 1280, 2048])
    await sharp(bytes)
      .resize(width, Math.round((width * 9) / 16), { fit: 'cover' })
      .webp({ quality: 85 })
      .toFile(`public/art/${asset.name}-${width}.webp`)
}
await writeFile('public/art/provenance.json', JSON.stringify(manifest, null, 2))
console.log('Prepared five responsive artwork sets.')
