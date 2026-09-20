import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { HostedUnavailable } from '../../src/components/hosted-unavailable.tsx'
import { writePrebuiltDirectory } from '../../engine/publishing/prebuilt.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'

// Trusted platform UI only. Never invoke this script on generated source.
const directory = process.argv[2]
if (!directory || process.argv.length !== 3)
  throw new Error('Usage: tsx scripts/publishing/prepare-frontend.ts NEW_OUTPUT_DIRECTORY')
const root = process.cwd()
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const css = await build({
  stdin: {
    contents:
      '@import "@fontsource/ibm-plex-mono/400.css"; @import "@fontsource/ibm-plex-mono/500.css"; @import "@fontsource/ibm-plex-mono/700.css"; @import "./src/design/tokens.css"; @import "./src/app/hosting/hosting.css"; body{margin:0;background:var(--canvas)}',
    resolveDir: root,
    loader: 'css',
  },
  bundle: true,
  write: false,
  outdir: resolve('/tmp/forge-public-assets'),
  entryNames: 'styles',
  assetNames: 'assets/[hash]',
  loader: { '.woff2': 'file', '.woff': 'file' },
  minify: true,
})
const cssFile = css.outputFiles?.find((file) => file.path.endsWith('.css'))
if (!cssFile) throw new Error('Frontend CSS build failed')
const cssName = relative('/tmp/forge-public-assets', cssFile.path)
const html =
  '<!doctype html>' +
  renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Forge AI — Hosted builder availability</title>
        <meta
          name="description"
          content="Forge AI project information. Hosted generation, sign-in and private previews are not connected on this public website."
        />
        <script src="/theme-init.js"></script>
        <link rel="stylesheet" href={`/${cssName}`} />
      </head>
      <body>
        <HostedUnavailable />
      </body>
    </html>
  )
const files = [
  {
    path: 'font-license.txt',
    bytes: await readFile(resolve(root, 'node_modules/@fontsource/ibm-plex-mono/LICENSE')),
  },
  { path: 'index.html', bytes: Buffer.from(html) },
  { path: 'theme-init.js', bytes: await readFile(resolve(root, 'public/theme-init.js')) },
  ...css.outputFiles.map((file) => ({
    path: relative('/tmp/forge-public-assets', file.path),
    bytes: file.contents,
  })),
]
const record = await writePrebuiltDirectory(resolve(directory), files, {
  kind: 'platform-authored-unavailable-frontend',
  sourceCommit,
  sourceDirty:
    execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':(exclude)node_modules'],
      {
        encoding: 'utf8',
      }
    ).trim().length > 0,
  componentDigest: sha256(await readFile(resolve(root, 'src/components/hosted-unavailable.tsx'))),
  builderAvailable: false,
  generatedPortfolio: false,
})
console.info(
  JSON.stringify({
    directory: resolve(directory),
    files: record.files.length,
    staticFilesDigest: record.staticFilesDigest,
    sourceCommit,
    kind: 'platform-authored-unavailable-frontend',
  })
)
