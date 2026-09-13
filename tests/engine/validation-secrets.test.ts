import { expect, it } from 'vitest'
import { assertNoKnownSecrets, scanSourceSecrets, sourceExportScanner } from '../../engine/validation/secrets.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'
const canary = 'FORGE_SYNTHETIC_CANARY_1234567890'
const policy = { policyDigest: sha256('synthetic scan policy'), forbiddenValues: [canary] }
const file = (text: string, path = 'app/page.tsx') => ({ path, bytes: Buffer.from(text) })
it('rejects canaries in source, binary assets, events and logs including encoded or control-split content', async () => {
  const variants = [canary, Buffer.from(canary).toString('base64'), [...canary].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''), canary.slice(0, 10) + '\x1b[31m' + canary.slice(10), canary.slice(0, 10) + '\0' + canary.slice(10)]
  for (const value of variants) {
    for (const path of ['app/page.tsx', 'public/assets/test.png']) expect(() => scanSourceSecrets([file(value, path)], sha256('manifest'), policy)).toThrow('Source rejected by secret policy')
    expect(() => assertNoKnownSecrets(JSON.stringify({ data: value }), [canary])).toThrow()
    expect(() => assertNoKnownSecrets(value, [canary])).toThrow()
    await expect(sourceExportScanner(policy)([file(value)], sha256('manifest'))).rejects.toThrow()
  }
})
it('rejects credential signatures, embedded passwords, unsafe paths and oversized source without echoing secrets', () => {
  for (const value of ['-----BEGIN PRIVATE KEY-----', 'AKIA1234567890ABCDEF', 'const api_key = "unapproved-password";', 'postgresql://user:unapproved-password@localhost/app']) {
    try { scanSourceSecrets([file(value)], sha256('manifest'), policy); throw new Error('Expected rejection') }
    catch (error) { expect((error as Error).message).toBe('Source rejected by secret policy'); expect((error as Error).message).not.toContain(value) }
  }
  for (const path of ['.env', 'evidence/results.json', 'app/archive.zip', '../escape']) expect(() => scanSourceSecrets([file('inert', path)], sha256('manifest'), policy)).toThrow()
  expect(() => assertNoKnownSecrets('x'.repeat(101), [canary], 100)).toThrow()
})
it('only exempts exact reviewed .env.example placeholder bytes from generic patterns, never from canaries', () => {
  const example = file('DATABASE_URL=postgresql://user:REPLACE_ME@localhost/app', '.env.example')
  const approved = { ...policy, placeholderExampleDigest: sha256(example.bytes) }
  expect(scanSourceSecrets([example], sha256('manifest'), approved).fileCount).toBe(1)
  expect(() => scanSourceSecrets([file('DATABASE_URL=postgresql://user:real-secret@localhost/app', '.env.example')], sha256('manifest'), approved)).toThrow()
  const bad = file(canary, '.env.example')
  expect(() => scanSourceSecrets([bad], sha256('manifest'), { ...approved, placeholderExampleDigest: sha256(bad.bytes) })).toThrow()
})
it('captures scan policy to resist concurrent mutation and preserves a reviewable hash', async () => {
  const mutable = structuredClone(policy); const scanner = sourceExportScanner(mutable); mutable.forbiddenValues.length = 0
  await expect(scanner([file(canary)], sha256('manifest'))).rejects.toThrow()
  expect(scanSourceSecrets([file('export const safe = true')], sha256('manifest'), policy)).toMatchObject({ fileCount: 1, policyDigest: policy.policyDigest })
})

it('recognizes only explicit symbolic assignment placeholders and still rejects known canaries first', () => {
  expect(scanSourceSecrets([file("url.password = 'REPLACE_WITH_LOCAL_PASSWORD'")], sha256('manifest'), policy).fileCount).toBe(1)
  expect(() => scanSourceSecrets([file("url.password = 'REPLACE_WITH_REAL_PASSWORD'")], sha256('manifest'), policy)).toThrow()
  expect(() => scanSourceSecrets([file("url.password = 'REPLACE_WITH_LOCAL_PASSWORD'")], sha256('manifest'), { ...policy, forbiddenValues: ['REPLACE_WITH_LOCAL_PASSWORD'] })).toThrow()
})
