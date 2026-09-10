import { startNativePostgres } from '../tests/engine/native-postgres'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'
const pg = await startNativePostgres()
let next: ReturnType<typeof spawn> | undefined
const fixture = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/v1/models') {
    res.end(JSON.stringify({ data: [{ id: 'fixture-model', context_window: 32768 }] }))
    return
  }
  let input = ''
  for await (const chunk of req) input += chunk
  const parsed = JSON.parse(input),
    text = parsed.response_format ? '{}' : 'Fixture connection ready.'
  const output = parsed.response_format ? ' {"ok":true}' : text
  if (parsed.stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: output }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }) +
        '\n\ndata: [DONE]\n\n'
    )
  } else
    res.end(
      JSON.stringify({
        choices: [{ message: { content: output }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
    )
})
try {
  for (const file of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await pg.admin.query(readFileSync('drizzle/' + file, 'utf8'))
  await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r))
  const fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/v1/`
  const env = {
    ...process.env,
    PORT: '3187',
    FORGE_AUTH_MODE: 'local',
    FORGE_TEST_URL: 'http://127.0.0.1:3187',
    BYOK_BROWSER_FIXTURE: fixtureUrl,
    FORGE_BYOK_PRIVATE_BASE_URLS: fixtureUrl,
    FORGE_BYOK_ACTIVE_KEY: 'test',
    FORGE_BYOK_KEYRING: JSON.stringify({ test: 'ab'.repeat(32) }),
    DATABASE_URL: `postgresql://e1_migration_owner@localhost:${pg.config.port}/postgres?host=${encodeURIComponent(pg.config.host)}`,
  }
  const log: string[] = []
  next = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3187'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  next.stdout?.on('data', (b) => log.push(String(b)))
  next.stderr?.on('data', (b) => log.push(String(b)))
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(env.FORGE_TEST_URL + '/api/account')
      if (r.ok) break
    } catch {
      /* Wait for the isolated test server. */
    }
    if (i > 60) throw new Error('Browser app failed to start')
    await new Promise((r) => setTimeout(r, 500))
  }
  const code = await new Promise<number | null>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        'tests/browser/byok.spec.ts',
        '--reporter=line',
      ],
      { env, stdio: 'inherit' }
    )
    p.on('exit', resolve)
    p.on('error', reject)
  })
  process.exitCode = code ?? 1
  mkdirSync('.private/byok-browser', { recursive: true })
  writeFileSync('.private/byok-browser/server.log', log.join(''))
} finally {
  next?.kill('SIGTERM')
  fixture.close()
  await pg.close()
}
