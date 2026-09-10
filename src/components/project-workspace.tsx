'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { RoutingPanel, RoutingSummary, RunUsage } from './byok-panel'
import { ReviewPanel } from './review-panel'
import { modes } from '../shared/creation'
import type { CreationMode } from '../shared/creation'
import type { ModelChoice, ProjectDetail, TimelineEvent } from '../shared/projects'
const CodeEditor = dynamic(() => import('./code-editor'), { ssr: false })
export function ProjectWorkspace({ id, choice }: { id: string; choice: ModelChoice | undefined }) {
  const [mobileView, setMobileView] = useState<'chat' | 'preview' | 'tools'>('chat')
  const [panelWidth, setPanelWidth] = useState(380)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [detail, setDetail] = useState<ProjectDetail>()
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [error, setError] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pane, setPane] = useState<'preview' | 'code' | 'history' | 'review'>('preview')
  const [device, setDevice] = useState('100%')
  const [files, setFiles] = useState<Record<string, string>>({})
  const [file, setFile] = useState('app/page.tsx')
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const submittedEdit = useRef<{ jobId: string; files: string } | undefined>(undefined)
  const [conflict, setConflict] = useState(false)
  const [mode, setMode] = useState<CreationMode>('build')
  const [restoreData, setRestoreData] = useState(false)
  const [reload, setReload] = useState(0)
  const [fileSearch, setFileSearch] = useState('')
  const requestKey = useRef<string | undefined>(undefined)
  const [connection, setConnection] = useState('')
  const revision = useRef<string | null | undefined>(undefined)
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}`)
      if (r.status === 401) {
        location.assign(`/login?returnTo=${encodeURIComponent(`/app/projects/${id}`)}`)
        return
      }
      if (!r.ok) throw new Error('Could not load this project.')
      const data: ProjectDetail = await r.json()
      setDetail(data)
      const pending = submittedEdit.current
      if (
        pending &&
        data.jobs.some((job) => job.id === pending.jobId && job.status === 'complete')
      ) {
        submittedEdit.current = undefined
        const submitted: Record<string, string> = JSON.parse(pending.files)
        if (
          Object.keys(data.files).length === Object.keys(submitted).length &&
          Object.entries(data.files).every(([path, content]) => submitted[path] === content)
        ) {
          dirtyRef.current = false
          setDirty(false)
          setConflict(false)
          localStorage.removeItem(`forge.editor.${id}`)
        }
      }
      if (revision.current !== data.project.activeRevision) {
        if (dirtyRef.current) {
          setConflict(true)
        } else {
          revision.current = data.project.activeRevision
          let recovered = false
          try {
            const raw = localStorage.getItem(`forge.editor.${id}`)
            if (raw) {
              const draft = JSON.parse(raw)
              if (draft.files && typeof draft.files === 'object') {
                setFiles(draft.files)
                setDirty(true)
                dirtyRef.current = true
                recovered = true
                if (draft.baseRevision !== data.project.activeRevision) {
                  revision.current = draft.baseRevision
                  setConflict(true)
                }
              }
            }
          } catch {
            /* Server source remains available if local recovery fails. */
          }
          if (!recovered) {
            setFiles(data.files)
            setDirty(false)
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load project.')
    }
  }, [id])
  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      void load()
    }, 5000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(`forge.panels.${id}`) || 'null')
      if (p) {
        if (['preview', 'code', 'history', 'review'].includes(p.pane)) setPane(p.pane)
        if (typeof p.file === 'string') setFile(p.file)
        if (['100%', '768px', '390px'].includes(p.device)) setDevice(p.device)
        if (['chat', 'preview', 'tools'].includes(p.mobileView)) setMobileView(p.mobileView)
        if (Number.isFinite(p.width)) setPanelWidth(Math.max(300, Math.min(520, p.width)))
      }
    } catch {
      /* Defaults remain usable. */
    }
    setPrefsLoaded(true)
  }, [id])
  useEffect(() => {
    if (prefsLoaded)
      try {
        localStorage.setItem(
          `forge.panels.${id}`,
          JSON.stringify({ pane, file, device, mobileView, width: panelWidth })
        )
      } catch {
        /* Panel preference storage is optional. */
      }
  }, [prefsLoaded, id, pane, file, device, mobileView, panelWidth])
  const jobId = detail?.jobs[0]?.id
  useEffect(() => {
    if (!jobId) return
    setEvents([])
    setConnection('Connected')
    const stream = new EventSource(`/api/jobs/${jobId}/events`)
    stream.onmessage = (message) => {
      const event: TimelineEvent = JSON.parse(message.data)
      setEvents((previous) =>
        previous.some((p) => p.id === event.id) ? previous : [...previous, event].slice(-200)
      )
    }
    stream.onerror = () => setConnection('Reconnecting… events will replay.')
    stream.onopen = () => setConnection('Connected')
    stream.addEventListener('end', () => {
      stream.close()
      setConnection('Saved')
      void load()
    })
    return () => stream.close()
  }, [jobId, load])
  const busy =
    submitting || !!detail?.jobs.some((j) => j.status === 'queued' || j.status === 'running')
  async function queue(body: Record<string, unknown>) {
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch(`/api/projects/${id}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          baseRevision:
            body.kind === 'edit'
              ? (revision.current ?? null)
              : (detail?.project.activeRevision ?? null),
          idempotencyKey: (requestKey.current ??= crypto.randomUUID()),
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      if (body.kind === 'edit')
        submittedEdit.current = { jobId: data.jobId, files: JSON.stringify(body.files) }
      setFollowUp('')
      requestKey.current = undefined
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue change.')
    } finally {
      setSubmitting(false)
    }
  }
  useEffect(() => {
    if (!dirty) return
    try {
      localStorage.setItem(
        `forge.editor.${id}`,
        JSON.stringify({ files, baseRevision: revision.current })
      )
    } catch {
      setError('Could not save editor recovery locally. Keep this tab open.')
    }
  }, [files, dirty, id])
  if (!detail)
    return (
      <div className="workbench">
        <p role="status">{error || 'Opening your project…'}</p>
      </div>
    )
  const canBuild = detail.permissions?.build ?? true
  const allFiles = { ...detail.protectedFiles, ...files }
  const latest = events.filter((e) => e.type !== 'log').at(-1)
  const latestGeneration = detail.jobs.find((job) => job.kind === 'generate')
  const nextChoice =
    latestGeneration && ['byok'].includes(latestGeneration.provider)
      ? {
          provider: latestGeneration.provider as ModelChoice['provider'],
          model: latestGeneration.model,
        }
      : choice
  return (
    <div
      className={`workbench mobile-${mobileView}`}
      style={{ '--conversation-width': `${panelWidth}px` } as React.CSSProperties}
    >
      <div className="workbench-heading">
        <div>
          <span className="eyebrow">YOUR PROJECT</span>
          {renaming ? (
            <form
              className="rename-project"
              onSubmit={async (e) => {
                e.preventDefault()
                const r = await fetch(`/api/projects/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: newName }),
                })
                if (r.ok) {
                  setRenaming(false)
                  await load()
                } else setError('Could not rename this project.')
              }}
            >
              <label>
                Project name
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={100}
                  required
                />
              </label>
              <button>Save name</button>
              <button type="button" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1>{detail.project.name}</h1>
          )}
          {canBuild && !renaming && (
            <button
              onClick={() => {
                setNewName(detail.project.name)
                setRenaming(true)
              }}
            >
              Rename
            </button>
          )}
          {canBuild && <a href={`/api/projects/${id}/export`}>Export source ↓</a>}
          {canBuild && (
            <button
              onClick={async () => {
                const r = await fetch(`/api/projects/${id}/remix`, { method: 'POST' })
                const result = await r.json()
                if (r.ok) location.assign(`/app/projects/${result.id}`)
                else setError(result.error)
              }}
            >
              Remix
            </button>
          )}
          <p className="active-model">
            {detail.jobs[0]?.kind === 'generate'
              ? `Last request · ${detail.jobs[0].provider} / ${detail.jobs[0].model}`
              : detail.jobs[0]?.kind === 'restore'
                ? 'Restored revision · Local build'
                : 'Code revision · Local build'}
          </p>
        </div>
        <span className="run-badge">
          <span className={`status-dot ${busy ? 'amber' : ''}`} />
          {busy ? 'Working' : detail.previewReady ? 'Preview live' : 'Preview paused'}
        </span>
      </div>
      <nav className="mobile-workbench-tabs" aria-label="Project view">
        {(['chat', 'preview', 'tools'] as const).map((view) => (
          <button
            key={view}
            aria-pressed={view === mobileView}
            onClick={() => {
              setMobileView(view)
              if (view === 'preview') setPane('preview')
              if (view === 'tools' && pane === 'preview') setPane(canBuild ? 'code' : 'review')
            }}
          >
            {view[0].toUpperCase() + view.slice(1)}
          </button>
        ))}
      </nav>
      <div className="workbench-body">
        <aside className="conversation">
          <h2>
            Build conversation <small>{connection}</small>
          </h2>
          <details className="project-context">
            <summary>Project context</summary>
            <p>{detail.project.brief}</p>
            <p>{detail.project.design.style || 'Automatic visual direction'}</p>
            <label className="panel-size-setting">
              Conversation width
              <input
                type="range"
                min={300}
                max={520}
                value={panelWidth}
                onChange={(e) => setPanelWidth(Number(e.target.value))}
              />
            </label>
          </details>
          <div className="prompt-history">
            {detail.messages?.map((message) => (
              <article key={message.id} className={`conversation-message ${message.role}`}>
                <small>
                  {message.role === 'user' ? 'You' : 'Forge'} · {message.mode}
                </small>
                <div>{message.content}</div>
              </article>
            ))}
          </div>
          <div className="generation-timeline" aria-label="Generation timeline">
            {events
              .filter((e) => e.type !== 'log' && e.type !== 'progress')
              .map((e) => (
                <p key={e.id} className={e.type === 'error' ? 'event-error' : ''}>
                  <span>{e.type === 'complete' ? '✓' : e.type === 'error' ? '!' : '·'}</span>
                  {e.message}
                </p>
              ))}
          </div>
          <p role="status" className="current-status">
            {latest?.message ?? (busy ? 'Waiting for the worker…' : 'Ready for your next change.')}
          </p>
          <RunUsage id={detail.jobs[0]?.runId} />
          <RoutingSummary scope={id} />
          {canBuild && (
            <details>
              <summary>Models and task assignments</summary>
              <RoutingPanel scope={id} />
            </details>
          )}
          {canBuild && (
            <form
              className="follow-up"
              onSubmit={(e) => {
                e.preventDefault()
                if (nextChoice)
                  void queue({
                    kind: mode === 'build' ? 'generate' : mode,
                    prompt: followUp,
                    ...nextChoice,
                  })
              }}
            >
              <label htmlFor="follow-up">Refine your app</label>
              <label>
                Mode
                <select value={mode} onChange={(e) => setMode(e.target.value as CreationMode)}>
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              {nextChoice && (
                <p className="active-model">
                  Next change: {nextChoice.provider} / {nextChoice.model}
                </p>
              )}
              <textarea
                id="follow-up"
                placeholder="Make it a little more…"
                value={followUp}
                onChange={(e) => {
                  setFollowUp(e.target.value)
                  requestKey.current = undefined
                }}
                maxLength={12000}
                disabled={busy}
              />
              <button
                className="build-button"
                disabled={busy || !nextChoice || followUp.trim().length < 5}
              >
                {mode === 'build' ? 'Apply change ↗' : 'Continue →'}
              </button>
            </form>
          )}
          {busy && canBuild && (
            <button
              onClick={async () => {
                const running = detail.jobs.find((j) => ['queued', 'running'].includes(j.status))
                if (!running) return
                const r = await fetch(`/api/jobs/${running.id}/cancel`, { method: 'POST' })
                if (!r.ok) setError('Could not stop this request.')
                else await load()
              }}
            >
              Stop request
            </button>
          )}
          {error && (
            <p className="event-error" role="alert">
              {error}
            </p>
          )}
        </aside>
        <section className="project-panel" aria-label="Generated application">
          {conflict && (
            <div className="conflict-notice" role="alert">
              A newer revision is available. Your unsaved code is preserved. Copy any changes you
              want to keep before loading the latest source.
              <button
                onClick={() => {
                  setFiles(detail.files)
                  revision.current = detail.project.activeRevision
                  dirtyRef.current = false
                  setDirty(false)
                  setConflict(false)
                  localStorage.removeItem(`forge.editor.${id}`)
                }}
              >
                Discard draft and load latest
              </button>
            </div>
          )}
          <div className="panel-toolbar">
            <div className="panel-tabs">
              {(['preview', 'code', 'history', 'review'] as const)
                .filter((tab) => canBuild || tab !== 'code')
                .map((tab) => (
                  <button
                    key={tab}
                    aria-pressed={pane === tab}
                    onClick={() => {
                      setPane(tab)
                      setMobileView(tab === 'preview' ? 'preview' : 'tools')
                    }}
                  >
                    {tab === 'preview'
                      ? 'Preview'
                      : tab === 'code'
                        ? 'Code'
                        : tab === 'history'
                          ? 'History'
                          : 'Review'}
                  </button>
                ))}
            </div>
            {pane === 'code' && (
              <button
                className="save-button"
                disabled={!canBuild || !dirty || busy || conflict}
                onClick={() => void queue({ kind: 'edit', files })}
              >
                {dirty ? 'Save & rebuild' : 'Saved'}
              </button>
            )}
          </div>
          <div hidden={pane !== 'preview'}>
            <div className="preview-controls">
              <span>ISOLATED LOCAL PREVIEW</span>
              <button onClick={() => setReload((r) => r + 1)}>Reload</button>
              {detail.previewReady && (
                <a href={detail.previewUrl} target="_blank" rel="noreferrer">
                  Open separately ↗
                </a>
              )}
              <div>
                {[
                  ['100%', 'Desktop'],
                  ['768px', 'Tablet'],
                  ['390px', 'Mobile'],
                ].map(([width, label]) => (
                  <button
                    key={width}
                    aria-pressed={device === width}
                    onClick={() => setDevice(width)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {detail.previewReady ? (
              <div className="preview-stage">
                <iframe
                  key={`${detail.project.activeRevision}:${reload}`}
                  title="Generated application preview"
                  src={`${detail.previewUrl}/?revision=${detail.project.activeRevision}`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  referrerPolicy="no-referrer"
                  style={{ width: device }}
                />
              </div>
            ) : (
              <div className="preview-empty">
                <span>✳</span>
                <h2>
                  {busy
                    ? 'Your idea is taking shape.'
                    : detail.project.activeRevision
                      ? 'Your preview is paused.'
                      : 'Your first preview is ahead.'}
                </h2>
                <p>
                  {busy
                    ? 'Follow the timeline while Forge validates and builds your application.'
                    : detail.project.activeRevision
                      ? 'Restore a saved revision to start its preview.'
                      : 'Send a build request to create and verify the application.'}
                </p>
                {!busy && canBuild && detail.project.activeRevision && (
                  <button
                    className="provider-test"
                    onClick={() =>
                      void queue({
                        kind: 'restore',
                        revisionId: detail.project.activeRevision,
                      })
                    }
                  >
                    Resume preview
                  </button>
                )}
              </div>
            )}
          </div>
          {pane === 'code' && (
            <div className="code-pane">
              <nav className="file-tree" aria-label="Project files">
                <label className="sr-only" htmlFor="file-search">
                  Search files
                </label>
                <input
                  id="file-search"
                  type="search"
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Find file…"
                />
                {Object.keys(allFiles)
                  .filter((path) => path.toLowerCase().includes(fileSearch.toLowerCase()))
                  .sort()
                  .map((path) => (
                    <button
                      key={path}
                      className={file === path ? 'selected' : ''}
                      onClick={() => setFile(path)}
                      title={path}
                    >
                      {path}
                      <small>{path in files ? '' : 'read only'}</small>
                    </button>
                  ))}
              </nav>
              <div className="editor-pane">
                <div className="file-caption">
                  {file}
                  {dirty && <span>Unsaved changes</span>}
                </div>
                <CodeEditor
                  path={file}
                  value={allFiles[file] ?? ''}
                  readOnly={!canBuild || busy || !(file in files)}
                  onChange={(value) => {
                    setFiles((previous) => ({ ...previous, [file]: value }))
                    setDirty(true)
                    dirtyRef.current = true
                    requestKey.current = undefined
                  }}
                />
              </div>
            </div>
          )}
          {pane === 'history' && (
            <div className="history-pane">
              <h2>Every working version, kept.</h2>
              <p>
                Restore source as a new revision. Current development data is preserved unless you
                explicitly select data recovery.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={restoreData}
                  onChange={(e) => setRestoreData(e.target.checked)}
                />{' '}
                Also restore the saved development data (replaces current development records)
              </label>
              {detail.history.length === 0 && <p>Your first successful build will appear here.</p>}
              {detail.history.map((v, i) => (
                <article key={v.id}>
                  <span className="revision-number">
                    {String(detail.history.length - i).padStart(2, '0')}
                  </span>
                  <div>
                    <strong>{v.summary}</strong>
                    <small>{new Date(v.createdAt).toLocaleString()}</small>
                  </div>
                  <button
                    className="provider-test"
                    disabled={!canBuild || busy || v.id === detail.project.activeRevision}
                    onClick={() => void queue({ kind: 'restore', revisionId: v.id, restoreData })}
                  >
                    {v.id === detail.project.activeRevision ? 'Current' : 'Restore'}
                  </button>
                </article>
              ))}
            </div>
          )}
          {pane === 'review' && (
            <ReviewPanel
              projectId={id}
              revisionId={detail.project.activeRevision}
              owner={canBuild}
              canComment={detail.permissions?.comment ?? true}
            />
          )}
          <details className="build-logs">
            <summary>
              Build logs <span>{busy ? 'Streaming' : 'Saved output'}</span>
            </summary>
            <pre>
              {events
                .filter((e) => e.type === 'log')
                .map((e) => e.message)
                .join('\n') || 'Build output will appear here when installation starts.'}
            </pre>
          </details>
        </section>
      </div>
    </div>
  )
}
