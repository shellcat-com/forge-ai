import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Isolated browser QA only. No .env files, provider requests, database or real login.
// The normal Vite configuration and release build never load this replacement.
const clientPath = resolve('src/cloud/client.ts')
const fixture = await readFile('tests/harness/cloud-client.ts', 'utf8')
const server = await createServer({
  configFile: false,
  envFile: false,
  define: { 'import.meta.env.VITE_FORGE_AUTH_ENABLED': '"true"' },
  server: { host: '127.0.0.1', port: Number(process.env.FORGE_FIXTURE_PORT || 5174), strictPort: true },
  plugins: [
    {
      name: 'explicit-cloud-browser-fixture',
      enforce: 'pre',
      transform(code, id) {
        if (id.split('?')[0] === clientPath) return fixture
        return code
      },
      transformIndexHtml(html) {
        return html.replace(
          '<body>',
          '<body><p role="note">SYNTHETIC ACCOUNT TEST — no real login or saved data. Use qa@example.test and any test password. Import briefs simulates session expiry.</p>'
        )
      },
    },
  ],
})
await server.listen()
console.log('Synthetic account browser fixture: http://127.0.0.1:5174/#/login')
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void server.close()
  })
