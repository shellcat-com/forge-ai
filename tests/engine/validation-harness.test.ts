import { expect, it } from 'vitest'
import { runTaskBoardReference, runPomodoroReference } from '../harness/reference-apps.ts'
import type { TrustedReferenceDriver, TaskRow, SessionRow } from '../harness/reference-apps.ts'
/** Explicit in-memory driver tests harness assertions, never app acceptance. */
function fixtureDriver(fault: 'none' | 'lost-db' | 'fake-restart' | 'bad-filter' | 'lost-pomodoro' = 'none'): TrustedReferenceDriver {
  const tasks = new Map<string, TaskRow>(); let next = 1
  const sessions = new Map<string, SessionRow>(); let work = 60; let remaining = 60; let running = false
  const driver: TrustedReferenceDriver = {
    databaseVolumeId: async () => 'synthetic-volume',
    restartAppProcess: async () => {
      if (fault === 'lost-db') tasks.clear()
      if (fault === 'lost-pomodoro') sessions.clear()
      return { previousProcessId: 'synthetic-process-1', currentProcessId: fault === 'fake-restart' ? 'synthetic-process-1' : 'synthetic-process-2', databaseVolumeId: 'synthetic-volume' }
    },
    task: {
      create: async title => {
        if (!title.trim() || title.length > 200) return { accepted: false, id: null }
        const id = String(next++); tasks.set(id, { id, title, status: 'active', priority: 'medium' }); return { accepted: true, id }
      },
      edit: async (id, title) => { tasks.get(id)!.title = title },
      complete: async id => { tasks.get(id)!.status = 'completed' },
      remove: async id => { tasks.delete(id) },
      list: async filter => [...tasks.values()].filter(row => fault === 'bad-filter' || filter === 'all' || filter === row.status),
      readDatabase: async id => tasks.get(id) ?? null,
      setPriority: async (id, priority) => { tasks.get(id)!.priority = priority },
      listByPriority: async priority => [...tasks.values()].filter(row => row.priority === priority),
    },
    pomodoro: {
      configure: async seconds => { work = seconds; remaining = seconds }, start: async () => { running = true }, pause: async () => { running = false },
      reset: async () => { remaining = work; running = false }, observe: async () => ({ running, remainingSeconds: remaining }),
      advanceBrowserClock: async seconds => { if (running) { remaining -= seconds; if (remaining <= 0) { running = false; const id = String(next++); sessions.set(id, { id, durationSeconds: work, kind: 'work', completed: true }) } } },
      history: async () => [...sessions.values()], readDatabase: async id => sessions.get(id) ?? null,
    },
  }
  return driver
}
it('exercises immutable task-board CRUD, priority, filter and restart assertions using an explicit fixture driver', async () => {
  expect((await runTaskBoardReference(fixtureDriver(), 'synthetic1')).assertions).toContain('app-restart-persistence')
  expect((await runTaskBoardReference(fixtureDriver(), 'synthetic2', true)).assertions).toContain('priority-default-filter-persistence')
})
it.each(['lost-db', 'fake-restart', 'bad-filter'] as const)('fails rather than issuing observations for %s', async fault => {
  await expect(runTaskBoardReference(fixtureDriver(fault), 'synthetic3')).rejects.toThrow('Reference assertion failed')
})
it('exercises Pomodoro pause/reset/session persistence with fixture clock and fails on lost DB history', async () => {
  expect((await runPomodoroReference(fixtureDriver())).assertions).toContain('session-history')
  await expect(runPomodoroReference(fixtureDriver('lost-pomodoro'))).rejects.toThrow('persistence')
})
