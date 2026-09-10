import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('public documentation tolerates the declared small loopback request envelope', async ({ request, baseURL }) => {
  const destination = new URL(baseURL!)
  test.skip(destination.hostname !== '127.0.0.1', 'Only the local no-spend envelope is authorized')
  const samples: { attempt: number; status: number | null; latencyMs: number; outcome: string }[] = []
  const started = Date.now()
  const results = await Promise.all(Array.from({ length: 2 }, async (_, client) => {
    for (let index = 0; index < 10; index++) {
      const before = performance.now()
      try {
        const response = await request.get('/docs', { timeout: 5000, maxRedirects: 0 })
        samples.push({ attempt: client * 10 + index, status: response.status(),
          latencyMs: performance.now() - before, outcome: response.ok() ? 'passed' : 'failed' })
        await response.dispose()
      } catch {
        samples.push({ attempt: client * 10 + index, status: null,
          latencyMs: performance.now() - before, outcome: 'network-error' })
      }
    }
  }))
  const ordered = samples.map(sample => sample.latencyMs).sort((a, b) => a - b)
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/task09-loopback-load.json', JSON.stringify({
    schemaVersion: 1, origin: 'existing-app-loopback-http', liveGeneration: false,
    envelope: { concurrency: 2, requests: 20, perRequestTimeoutMs: 5000, externalSpendUsd: 0 },
    elapsedMs: Date.now() - started, samples: samples.sort((a, b) => a.attempt - b.attempt),
    p50Ms: ordered[9], p95Ms: ordered[18], a20Passed: false,
  }, null, 2))
  expect(results).toHaveLength(2)
  expect(samples).toHaveLength(20)
  expect(samples.filter(sample => sample.outcome !== 'passed')).toEqual([])
})
