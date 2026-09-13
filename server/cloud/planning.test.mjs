import { expect, it, vi } from 'vitest'
import { createPlanner } from './planning.mjs'
import { models } from '../provider.mjs'
const brief = {
  name: 'Portal',
  prompt: 'Create a searchable customer portal',
  template: 'Next.js + Postgres',
}
it('fails closed until explicitly enabled and configured', async () => {
  const planner = createPlanner({ key: 'test' })
  expect(planner.configuration().configured).toBe(false)
  await expect(planner.run(brief, models[0].id)).rejects.toMatchObject({ status: 503 })
})
it('enforces a bounded daily budget and returns text without execution', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'A text plan' }, finish_reason: 'stop' }],
        })
      )
  )
  const planner = createPlanner({ key: 'test', enabled: true, dailyLimit: 1, fetchImpl })
  expect((await planner.run(brief, models[0].id)).text).toBe('A text plan')
  await expect(planner.run(brief, models[0].id)).rejects.toMatchObject({ status: 429 })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
it('does not leak upstream details or keys on failure', async () => {
  const planner = createPlanner({
    key: 'private-key',
    enabled: true,
    fetchImpl: async () => {
      throw new Error('private-key')
    },
  })
  await expect(planner.run(brief, models[0].id)).rejects.toMatchObject({
    status: 502,
    message:
      'The planning provider could not complete this request. Your saved brief is unchanged.',
  })
})
