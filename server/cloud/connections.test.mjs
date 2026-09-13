import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { CloudStore } from './store.mjs'
import { createKeyVault, ProviderConnections } from './connections.mjs'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const encryptionKey = 'ab'.repeat(32)
const apiKey = 'synthetic-secret-provider-key'
const model = 'deepseek-flash'
const brief = { name: 'Portal', prompt: 'A searchable customer portal for support teams.', template: 'Next.js + Postgres', presetId: 'technical-mono' }
const completion = (text = 'OK') => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { status: 200 })
let db, store, connections
const upstream = vi.fn(async () => completion())
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY, "emailVerified" boolean, banned boolean); INSERT INTO neon_auth."user" VALUES ('${alice}',true,false),('${bob}',true,false); CREATE TABLE neon_auth.session (id uuid,token text,"userId" uuid,"expiresAt" timestamptz);`)
  for (const name of ['0001_workspace.sql', '0003_provider_connections.sql'])
    await db.exec(await readFile(new URL('./migrations/' + name, import.meta.url), 'utf8'))
  await db.exec('SET ROLE forge_app')
  // PGlite has a single connection; queue complete transactions to emulate a pool.
  let tail = Promise.resolve()
  store = new CloudStore({ connect: async () => {
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    return { query: async (sql, params) => { const r = await db.query(sql, params); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 } }, release }
  } })
  connections = new ProviderConnections({ store, encryptionKey, fetchImpl: upstream })
}, 30000)
afterAll(async () => { await db?.close() })

it('encrypts with random nonces and rejects tampering, wrong keys, and swapped ownership', () => {
  const vault = createKeyVault(encryptionKey)
  const ciphertext = vault.seal(alice, 'deepseek', apiKey)
  expect(ciphertext).not.toContain(apiKey)
  expect(vault.seal(alice, 'deepseek', apiKey)).not.toBe(ciphertext)
  expect(vault.open(alice, 'deepseek', ciphertext)).toBe(apiKey)
  expect(() => vault.open(bob, 'deepseek', ciphertext)).toThrow()
  expect(() => vault.open(alice, 'nvidia', ciphertext)).toThrow()
  expect(() => createKeyVault('cd'.repeat(32)).open(alice, 'deepseek', ciphertext)).toThrow()
  expect(() => vault.open(alice, 'deepseek', ciphertext.replace('v1.', 'v2.'))).toThrow()
  expect(() => createKeyVault('')).toThrow()
})
it('checks access before saving, sends credentials only to the fixed provider and never exports secrets', async () => {
  await connections.save(alice, 'deepseek', apiKey, randomUUID())
  const [url, request] = upstream.mock.calls.at(-1)
  expect(url).toBe('https://api.deepseek.com/chat/completions')
  expect(request.redirect).toBe('error')
  expect(request.headers.Authorization).toBe('Bearer ' + apiKey)
  expect(JSON.parse(request.body).max_tokens).toBe(32)
  const config = await connections.configuration(alice)
  expect(config.providers[0].connected).toBe(true)
  expect(JSON.stringify(config)).not.toContain(apiKey)
  expect(JSON.stringify(await store.export(alice))).not.toContain('ciphertext')
  const rows = await store.run(alice, c => c.query('SELECT ciphertext FROM forge.provider_connections'))
  expect(rows.rows[0].ciphertext).not.toContain(apiKey)
  expect((await connections.configuration(bob)).providers[0].connected).toBe(false)
  expect((await store.run(bob, c => c.query('SELECT * FROM forge.provider_connections'))).rows).toHaveLength(0)
  await expect(store.run(bob, c => c.query('INSERT INTO forge.provider_connections(user_id,provider,ciphertext,fingerprint) VALUES($1,$2,$3,$4)', [alice, 'nvidia', 'forged', 'forged']))).rejects.toThrow()
})
it('keeps a working key when replacement fails and redacts upstream error content', async () => {
  upstream.mockResolvedValueOnce(new Response('reflected secret: ' + apiKey, { status: 401 }))
  await expect(connections.save(alice, 'deepseek', 'invalid-new-key', randomUUID())).rejects.toMatchObject({ status: 502 })
  await connections.run(alice, brief, { provider: 'deepseek', model, mode: 'plan', requestId: randomUUID() })
  expect(upstream.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer ' + apiKey)
  expect(JSON.parse(upstream.mock.calls.at(-1)[1].body).max_tokens).toBe(2048)
})
it('shares active leases across instances and refuses replay before calling the provider', async () => {
  const id = randomUUID()
  await connections.reserve(alice, id)
  const replica = new ProviderConnections({ store, encryptionKey, fetchImpl: upstream })
  await expect(replica.reserve(alice, id)).rejects.toMatchObject({ status: 409 })
  await expect(replica.reserve(alice, randomUUID())).rejects.toMatchObject({ status: 429 })
  await store.run(alice, c => c.query('UPDATE forge.provider_requests SET lease_until=NULL WHERE request_id=$1', [id]))
  await expect(replica.reserve(alice, id)).rejects.toMatchObject({ status: 409 })
})
it('enforces a durable daily limit and rolls it over at the next UTC day', async () => {
  for (let i = 0; i < 20; i++) await store.run(bob, c => c.query('INSERT INTO forge.provider_requests(user_id,request_id) VALUES($1,$2)', [bob, randomUUID()]))
  await expect(connections.reserve(bob, randomUUID())).rejects.toMatchObject({ status: 429 })
  await store.run(bob, c => c.query("UPDATE forge.provider_requests SET created_at=now()-interval '1 day' WHERE user_id=$1", [bob]))
  await connections.reserve(bob, randomUUID())
  expect((await connections.configuration(bob)).requestsToday).toBe(1)
})
it('produces bounded frontend output and refuses incomplete HTML', async () => {
  upstream.mockResolvedValueOnce(completion('<!doctype html><html><body>Portal</body></html>'))
  expect(await connections.run(alice, brief, { provider: 'deepseek', model, mode: 'website', requestId: randomUUID() })).toMatchObject({ html: expect.stringContaining('Portal') })
  expect(JSON.parse(upstream.mock.calls.at(-1)[1].body).max_tokens).toBe(8000)
  upstream.mockResolvedValueOnce(completion('<html>incomplete'))
  await expect(connections.run(alice, brief, { provider: 'deepseek', model, mode: 'website', requestId: randomUUID() })).rejects.toMatchObject({ status: 502 })
})
it('removes a connection and cascades keys and request metadata with the identity', async () => {
  await connections.remove(alice, 'deepseek')
  expect((await connections.configuration(alice)).providers[0].connected).toBe(false)
  const calls = upstream.mock.calls.length
  await expect(connections.run(alice, brief, { provider: 'deepseek', model, mode: 'plan', requestId: randomUUID() })).rejects.toMatchObject({ status: 409 })
  expect(upstream).toHaveBeenCalledTimes(calls)
  await connections.save(alice, 'deepseek', apiKey, randomUUID())
  await db.exec('RESET ROLE')
  await db.query('DELETE FROM neon_auth."user" WHERE id=$1', [alice])
  expect((await db.query('SELECT * FROM forge.provider_connections WHERE user_id=$1', [alice])).rows).toHaveLength(0)
  expect((await db.query('SELECT * FROM forge.provider_requests WHERE user_id=$1', [alice])).rows).toHaveLength(0)
  await db.exec('SET ROLE forge_app')
})
