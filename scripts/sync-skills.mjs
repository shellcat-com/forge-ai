import ts from 'typescript'
import { cp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
const source = await readFile('src/design/presets.ts', 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { presets } = await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
)
await mkdir('skills/forge-project-design/references', { recursive: true })
await writeFile(
  'skills/forge-project-design/references/presets.json',
  JSON.stringify(presets, null, 2)
)
await copyFile('docs/design/assets.json', 'skills/forge-project-design/references/assets.json')
const root = process.env.CODEX_HOME || join(homedir(), '.codex')
for (const name of ['forge-design', 'forge-project-design']) {
  await mkdir(`skills/${name}/references`, { recursive: true })
  await copyFile('DESIGN.md', `skills/${name}/references/DESIGN.md`)
}
for (const name of ['forge-design', 'forge-project-design', 'screenrecord-demo']) {
  await mkdir(join(root, 'skills', name), { recursive: true })
  await cp(`skills/${name}`, join(root, 'skills', name), {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes('__pycache__') && !source.endsWith('.pyc'),
  })
}
await writeFile(
  'docs/design/skill-installation.md',
  'Repository skill sources are authoritative. Run `npm run skills:sync` after changes. Copies installed in the local Codex skills directory.\n'
)
console.log('Installed Forge design and screenrecord-demo skills.')
