import { expect, it } from 'vitest'
import { creationSchema, projectName } from '../src/shared/creation'
import { applyBatch, safePath } from '../src/server/generation/files'
import { assertLocalRequest } from '../src/server/http/local'
it('accepts a custom direction without an example and defaults to Build', () => {
  const result = creationSchema.parse({
    prompt: 'Create a colorful restaurant website',
    provider: 'groq',
    model: 'test',
    idempotencyKey: crypto.randomUUID(),
    design: { style: 'Vivid red, editorial menus', preserve: '' },
  })
  expect(result.mode).toBe('build')
  expect(result.design.exampleId).toBeUndefined()
  expect(projectName(result.prompt)).toBe('colorful restaurant website')
})
it('supports nested pages and components while protecting infrastructure', () => {
  for (const path of [
    'app/about/page.tsx',
    'app/projects/[id]/page.tsx',
    'app/components/menu/Item.tsx',
    'app/api/bookings/route.ts',
    'lib/generated/bookings.ts',
  ])
    expect(safePath(path), path).toBe(true)
  for (const path of [
    'app/layout.tsx',
    'lib/db.ts',
    'package.json',
    '.env',
    'app/../page.tsx',
    'app//page.tsx',
    'app/api/../../route.ts',
    'runtime/run.mjs',
  ])
    expect(safePath(path), path).toBe(false)
})
it('retains unrelated files when applying a multipage change', () => {
  const files = { 'app/page.tsx': 'home', 'app/globals.css': 'css', 'app/about/page.tsx': 'about' }
  const result = applyBatch(files, {
    summary: 'Add contact',
    operations: [{ type: 'write', path: 'app/contact/page.tsx', content: 'contact' }],
  })
  expect(result.files['app/about/page.tsx']).toBe('about')
  expect(files).not.toHaveProperty('app/contact/page.tsx')
})
it('hosted request origin checks reject forged hosts and cross-origin mutations', () => {
  const mode = process.env.FORGE_AUTH_MODE,
    url = process.env.BETTER_AUTH_URL
  process.env.FORGE_AUTH_MODE = 'hosted'
  process.env.BETTER_AUTH_URL = 'https://forge.example'
  try {
    expect(() =>
      assertLocalRequest(
        new Request('https://forge.example/api/projects', {
          headers: { host: 'forge.example', origin: 'https://evil.example' },
        }),
        true
      )
    ).toThrow()
    expect(() =>
      assertLocalRequest(
        new Request('https://forge.example/api/projects', {
          headers: { host: 'evil.example', origin: 'https://forge.example' },
        }),
        true
      )
    ).toThrow()
    expect(() =>
      assertLocalRequest(
        new Request('https://forge.example/api/projects', {
          headers: { host: 'forge.example', origin: 'https://forge.example' },
        }),
        true
      )
    ).not.toThrow()
  } finally {
    if (mode === undefined) delete process.env.FORGE_AUTH_MODE
    else process.env.FORGE_AUTH_MODE = mode
    if (url === undefined) delete process.env.BETTER_AUTH_URL
    else process.env.BETTER_AUTH_URL = url
  }
})

import { authReturn } from '../src/shared/auth-return'
it('authentication return paths cannot redirect outside the workspace', () => {
  expect(authReturn('/app/projects/abc?pane=code')).toBe('/app/projects/abc?pane=code')
  for (const value of [
    '//evil.example',
    'https://evil.example',
    '/app/../../elsewhere',
    '/app\\evil.example',
    '/login',
  ])
    expect(authReturn(value)).toBe('/app')
})
