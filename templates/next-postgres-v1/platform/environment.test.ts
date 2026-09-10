import { describe, expect, it } from 'vitest'
import { appDatabaseUrl } from './environment'

// Placeholder-only test input; no credential-bearing connection string is shipped.
function placeholderUrl(overrides: Partial<{ host: string; user: string; database: string; query: string }> = {}) {
  const url = new URL('postgresql://127.0.0.1:5432/forge_app')
  url.username = overrides.user ?? 'forge_app'
  url.password = 'REPLACE_WITH_LOCAL_PASSWORD'
  url.hostname = overrides.host ?? '127.0.0.1'
  url.pathname = overrides.database ?? '/forge_app'
  url.search = overrides.query ?? ''
  return url.toString()
}

describe('protected app environment', () => {
  it('only accepts scoped guest loopback database', () => {
    expect(appDatabaseUrl(placeholderUrl())).toContain('127.0.0.1:5432')
    for (const value of [undefined, placeholderUrl({ host: 'metadata.invalid' }), placeholderUrl({ user: 'admin' }),
      placeholderUrl({ database: '/control' }), placeholderUrl({ query: 'options=-crole=admin' })]) expect(() => appDatabaseUrl(value)).toThrow()
  })
})
