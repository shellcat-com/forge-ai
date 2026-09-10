/** Vite development-only design fixture. No credentials, fetch, API client,
 * local identity or generated-app execution. Never a release attestation. */
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import '../../src/styles.css'
import '../../src/engine/workspace.css'
import { engineView } from '../../src/engine/view.ts'
import type { FlowState } from '../../src/engine/flow.ts'
import { applyTheme, validTheme } from '../../src/theme.ts'

if (!import.meta.env.DEV) throw new Error('UI_FIXTURE_DEVELOPMENT_ONLY')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const w = id(1), p = id(2), j = id(3), snapshot = id(9), digest = 'a'.repeat(64)
const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
const project = { id: p, workspaceId: w, name: 'Task board — explicit fixture', brief: 'A synthetic task board with columns and persistent tasks. This fixture only validates the Forge interface.',
  presetId: 'technical-mono' as const, presetVersion: 1 as const, templateId: 'next-postgres-v1' as const, revision: 2, headSnapshotId: snapshot, origin: 'fixture' as const }
const flow: FlowState = {
  session: { schemaVersion: 1, origin: 'fixture', userId: id(4), memberships: [{ workspace_id: w, role: 'editor' }] },
  capabilities: { schemaVersion: 1, origin: 'fixture', control: true, generation: false, execution: false, preview: false, fixtureWorkflows: true,
    modelPolicies: ['fixture-v1'], templates: ['next-postgres-v1'], externalGates: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'] },
  workspaceId: w, projects: [project], nextProjectCursor: null, project,
  job: { schemaVersion: 1, origin: 'fixture', id: j, workspaceId: w, projectId: p, state: 'AWAITING_EXECUTION_APPROVAL', stateVersion: 8,
    baseRevision: 2, baseSnapshotId: snapshot, reviewDigest: digest, candidateSnapshotId: id(10), cleanupPending: false, finishedAt: null,
    review: { schemaVersion: 1, workspaceId: w, projectId: p, jobId: j, baseRevision: 2, baseSnapshotId: snapshot, candidateDigest: digest,
      templateDigest: digest, policyDigest: digest, expiresAt: '2099-01-01T00:00:00Z', diffDigest: digest, imageDigest: 'fixture-image-unavailable',
      commandPolicy: ['lint', 'typecheck', 'test', 'build'], migrations: [], migrationBundleDigest: digest, dataReset: 'synthetic-data-only' } },
  history: [{ id: snapshot, parent_id: null, manifest_digest: digest, status: 'verified', origin: 'fixture', created_at: '2026-09-10T00:00:00Z' }],
  lastEventSeq: 5, stream: 'disconnected', pendingActions: [], unavailable: { preview: 'ENDPOINT_UNAVAILABLE', sourceExport: 'ENDPOINT_UNAVAILABLE' },
}
const parameters = new URL(location.href).searchParams
const theme = parameters.get('theme')
applyTheme(validTheme(theme) ? theme : 'light')
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = engineView({ flow, busy: false, error: '', reviewReady: true,
  reviewText: `STATIC SYNTHETIC REVIEW — no execution occurs.\n\n+ Add task columns, task creation and completion.\n+ Add reviewed additive task migration.\n\nCommands: lint → typecheck → test → build.\nHost image: unavailable; execution remains blocked.\n\nEscaping probe (must render as text): ${malicious}`,
  files: [{ path: 'src/app/page.tsx', sha256: digest, bytes: 2048 }, { path: 'db/migrations/001_tasks.sql', sha256: digest, bytes: 512 }],
  selectedFile: 'src/app/page.tsx', fileText: `// Explicit source-display fixture\nexport const taskTitle = ${JSON.stringify(malicious)};\n// This code is displayed as text and never executed.`, exportAvailable: false })
document.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button')
  if (!button || button.disabled) return
  if (validTheme(button.dataset.themeChoice)) {
    applyTheme(button.dataset.themeChoice)
    document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === button.dataset.themeChoice)))
  }
  else document.querySelector('#fixture-status')!.textContent = `Fixture interaction: ${button.textContent}. No service request was made.`
})
document.addEventListener('submit', event => { event.preventDefault(); document.querySelector('#fixture-status')!.textContent = 'Fixture form submitted. No data was saved and no service request was made.' })

// Explicit fixture simulations only. CSS zoom leaves media-query evaluation
// unchanged; copied reduced-motion declarations do not emulate the OS setting.
const simulations: string[] = []
if (parameters.get('zoom') === '2') {
  document.documentElement.style.zoom = '2'
  document.documentElement.dataset.fixtureZoom = 'css-200-percent'
  simulations.push('CSS 200% zoom simulation; browser zoom and its media-query behavior are not tested.')
}
if (parameters.get('motion') === 'reduce') {
  const declarations: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSMediaRule && /prefers-reduced-motion:\s*reduce/.test(rule.conditionText))
        declarations.push(...Array.from(rule.cssRules, inner => inner.cssText))
    }
  }
  if (!declarations.length) throw new Error('FIXTURE_REDUCED_MOTION_RULE_UNAVAILABLE')
  const forced = document.createElement('style'); forced.dataset.fixtureReducedMotion = 'copied-existing-declarations'
  forced.textContent = declarations.join('\n'); document.head.append(forced)
  document.documentElement.dataset.fixtureMotion = 'forced-reduced-styles'
  simulations.push('Existing reduced-motion styles forced for inspection; actual OS/media-query activation is not tested.')
}
if (simulations.length) {
  const notice = document.createElement('aside'); notice.className = 'notice'; notice.setAttribute('aria-label', 'Fixture simulation limits')
  notice.textContent = 'DEVELOPMENT-ONLY UI FIXTURE. ' + simulations.join(' '); app.prepend(notice)
}
