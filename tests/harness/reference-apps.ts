import { canonicalHash } from '../../engine/contracts/canonical.ts'

/** Immutable host-side reference specification. Generated tests never replace
 * these assertions. A production adapter must use the separately isolated
 * browser worker and app-local test DB described in RFC 0001. No host execution
 * or network connection is performed by this module. */
export const referenceCorpus = {
  schemaVersion: 1,
  taskBoard: {
    brief: 'Task board: create/list/edit/complete/delete tasks; title required and at most 200 characters; filter All/Active/Completed. PostgreSQL rows survive app-process restart.',
    additiveBrief: 'Add priority low/medium/high, default medium, additive migration. Preserve previous tasks and CRUD/filter behavior.',
    uiContract: ['Task title', 'Create task', 'Edit task', 'Save task', 'Complete task', 'Delete task', 'All', 'Active', 'Completed'],
  },
  pomodoro: {
    brief: 'Pomodoro timer with start/pause/reset, separate work and break durations, and PostgreSQL session history surviving app-process restart.',
    uiContract: ['Start', 'Pause', 'Reset', 'Work duration', 'Break duration', 'Session history'],
  },
  portfolio: {
    "brief": "Generate a public professional portfolio in Next.js App Router and strict TypeScript. Use only owner-reviewed public name, biography, skills, project descriptions and links. Provide introduction, selected projects, about and contact sections, accessible navigation, responsive layouts, semantic headings, visible focus and reduced-motion support. Do not fabricate credentials, employers, testimonials, contact details or project outcomes. No database or contact-form backend is required for these read-only requirements.",
    "specificationPath": "templates/next-postgres-v1/reference/portfolio.json",
    "specificationSha256": "6bbce92a1a970fbf37fc789858a839efbf99c8198b13eb62e99a7d7fe9be1020",
    "databaseRequired": false,
    "engineDatabaseAcceptanceStillRequired": true,
  },
  viewports: [390, 768, 1440], themes: ['light', 'dark'], zoomPercent: 200, reducedMotion: true,
} as const
export const referenceCorpusDigest = canonicalHash(referenceCorpus)
export type TaskRow = { id: string; title: string; status: 'active' | 'completed'; priority?: 'low' | 'medium' | 'high' }
export type SessionRow = { id: string; kind: 'work' | 'break'; durationSeconds: number; completed: boolean }
export interface TrustedReferenceDriver {
  /** Observed independently by runtime control, never from the app's response. */
  restartAppProcess(): Promise<{ previousProcessId: string; currentProcessId: string; databaseVolumeId: string }>
  databaseVolumeId(): Promise<string>
  task: {
    create(title: string): Promise<{ accepted: boolean; id: string | null }>
    edit(id: string, title: string): Promise<void>
    complete(id: string): Promise<void>
    remove(id: string): Promise<void>
    list(filter: 'all' | 'active' | 'completed'): Promise<TaskRow[]>
    readDatabase(id: string): Promise<TaskRow | null>
    setPriority(id: string, priority: 'low' | 'medium' | 'high'): Promise<void>
    listByPriority(priority: 'low' | 'medium' | 'high'): Promise<TaskRow[]>
  }
  pomodoro: {
    configure(workSeconds: number, breakSeconds: number): Promise<void>
    start(): Promise<void>
    pause(): Promise<void>
    reset(): Promise<void>
    observe(): Promise<{ running: boolean; remainingSeconds: number }>
    /** Test-only virtual time in the isolated browser, never a production route. */
    advanceBrowserClock(seconds: number): Promise<void>
    history(): Promise<SessionRow[]>
    readDatabase(id: string): Promise<SessionRow | null>
  }
}
export interface HarnessObservation { corpusDigest: string; scenario: 'task-board' | 'task-board-priority' | 'pomodoro'; assertions: string[] }
const ensure = (condition: boolean, assertion: string): void => { if (!condition) throw new Error(`Reference assertion failed: ${assertion}`) }
async function restartPreservingDatabase(driver: TrustedReferenceDriver): Promise<void> {
  const before = await driver.databaseVolumeId(); const result = await driver.restartAppProcess()
  ensure(!!before && result.databaseVolumeId === before && await driver.databaseVolumeId() === before, 'same PostgreSQL volume')
  ensure(!!result.previousProcessId && !!result.currentProcessId && result.previousProcessId !== result.currentProcessId, 'real app-process restart')
}
/** Returns observations, never a VerificationV1 or a claim of live acceptance.
 * Fixture drivers are useful for harness tests only. All operations are awaited
 * so a failed assertion cannot fall through to a successful record. */
export async function runTaskBoardReference(driver: TrustedReferenceDriver, nonce: string, priority = false): Promise<HarnessObservation> {
  if (!/^[a-z0-9]{8,32}$/.test(nonce)) throw new Error('Synthetic nonce required')
  const task = driver.task
  for (const title of ['', ' '.repeat(3), 'x'.repeat(201)]) ensure(!(await task.create(title)).accepted, 'title validation')
  const initialTitle = `Forge task ${nonce}`; const updatedTitle = `Updated ${nonce}`
  const created = await task.create(initialTitle); ensure(created.accepted && !!created.id, 'create task')
  const id = created.id!
  ensure((await task.list('all')).some(row => row.id === id && row.title === initialTitle && row.status === 'active'), 'list created task')
  ensure((await task.readDatabase(id))?.title === initialTitle, 'created row in PostgreSQL')
  await task.edit(id, updatedTitle)
  ensure((await task.list('active')).some(row => row.id === id && row.title === updatedTitle), 'edit and active filter')
  ensure(!(await task.list('completed')).some(row => row.id === id), 'completed filter excludes active')
  if (priority) {
    ensure((await task.readDatabase(id))?.priority === 'medium', 'priority default')
    await task.setPriority(id, 'high')
    ensure((await task.listByPriority('high')).some(row => row.id === id), 'priority filter includes matching')
    ensure(!(await task.listByPriority('low')).some(row => row.id === id), 'priority filter excludes other')
  }
  await task.complete(id)
  ensure((await task.list('completed')).some(row => row.id === id && row.status === 'completed'), 'complete task')
  ensure(!(await task.list('active')).some(row => row.id === id), 'active filter excludes complete')
  await restartPreservingDatabase(driver)
  const persisted = await task.readDatabase(id)
  ensure(persisted?.title === updatedTitle && persisted.status === 'completed' && (!priority || persisted.priority === 'high'), 'database persistence after restart')
  ensure((await task.list('completed')).some(row => row.id === id && row.title === updatedTitle), 'UI persistence after restart')
  await task.remove(id)
  ensure(!(await task.list('all')).some(row => row.id === id) && await task.readDatabase(id) === null, 'delete task from UI and PostgreSQL')
  return { corpusDigest: referenceCorpusDigest, scenario: priority ? 'task-board-priority' : 'task-board', assertions: ['title-validation', 'task-crud', 'status-filter', 'app-restart-persistence', ...(priority ? ['priority-default-filter-persistence'] : [])] }
}
export async function runPomodoroReference(driver: TrustedReferenceDriver): Promise<HarnessObservation> {
  const timer = driver.pomodoro; const before = new Set((await timer.history()).map(row => row.id))
  await timer.configure(60, 30); await timer.start(); await timer.advanceBrowserClock(10); await timer.pause()
  const paused = await timer.observe(); ensure(!paused.running && paused.remainingSeconds >= 49 && paused.remainingSeconds <= 50, 'timer pause')
  await timer.advanceBrowserClock(10); ensure((await timer.observe()).remainingSeconds === paused.remainingSeconds, 'pause freezes countdown')
  await timer.reset(); const reset = await timer.observe(); ensure(!reset.running && reset.remainingSeconds === 60, 'reset work duration')
  await timer.start(); await timer.advanceBrowserClock(60)
  const row = (await timer.history()).find(r => !before.has(r.id) && r.kind === 'work' && r.durationSeconds === 60 && r.completed)
  ensure(!!row, 'completed work history'); const id = row!.id
  const stored = await timer.readDatabase(id); ensure(stored?.completed === true && stored.durationSeconds === 60 && stored.kind === 'work', 'session stored in PostgreSQL')
  await restartPreservingDatabase(driver)
  ensure((await timer.history()).some(r => r.id === id) && (await timer.readDatabase(id))?.completed === true, 'session history persistence after restart')
  return { corpusDigest: referenceCorpusDigest, scenario: 'pomodoro', assertions: ['timer-start-pause-reset', 'session-history', 'app-restart-persistence'] }
}
