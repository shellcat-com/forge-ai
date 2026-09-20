import { expect, it } from 'vitest'
import { validateDefaultHostnameBoundary } from '../../engine/preview/hostnames.ts'
it('only enables the browser-tested sibling default hostname pattern', () => {
  expect(() =>
    validateDefaultHostnameBoundary(
      'https://forge-example.vercel.app',
      'preview-example.vercel.app'
    )
  ).not.toThrow()
  for (const [forge, preview] of [
    ['https://forge-example.vercel.app', 'child.forge-example.vercel.app'],
    ['https://forge-example.vercel.app', 'forge-example.vercel.app'],
    ['https://forge.example', 'preview.example'],
    ['http://forge-example.vercel.app', 'preview-example.vercel.app'],
    ['https://forge-example.vercel.app:444', 'preview-example.vercel.app'],
    ['https://forge-example.vercel.app', 'preview-example.vercel.app.attacker.test'],
    ['https://forge-example.vercel.app', `${'a'.repeat(64)}.vercel.app`],
  ])
    expect(() => validateDefaultHostnameBoundary(forge, preview)).toThrow()
})
