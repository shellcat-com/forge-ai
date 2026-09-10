'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ProjectWorkspace } from './project-workspace'
import { RoutingSummary } from './byok-panel'
import { ProviderPanel } from './provider-panel'
import { ThemeControl } from './theme-control'
import { presets } from '../design/presets'
import { modes } from '../shared/creation'
import type { CreationMode } from '../shared/creation'
import type { ProjectSummary, ModelChoice } from '../shared/projects'
import type { ProviderStatus } from '../shared/providers'
const starterPrompts = [
  [
    'A personal website',
    'Build an editorial portfolio for an independent architect, with a projects gallery, project detail pages, and an about page.',
  ],
  [
    'A useful dashboard',
    'Build a compact project dashboard with tasks, status filters, due dates, and a weekly progress summary.',
  ],
  [
    'A calmer daily ritual',
    'Build an accessible Pomodoro timer with focus and break durations, start, pause, reset, settings and saved session counts.',
  ],
]
const draftKey = 'forge.composer.v2'
type View = 'home' | 'projects' | 'connections' | 'settings'
export function Workspace({ view = 'home', id }: { view?: View; id?: string }) {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<CreationMode>('build')
  const [style, setStyle] = useState('')
  const [example, setExample] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [choice, setChoice] = useState<ModelChoice>()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [ready, setReady] = useState<{ worker: boolean; message: string }>()
  const [account, setAccount] = useState<{
    user: { local: boolean; canBuild: boolean; email: string } | null
    mode: string
  }>()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('owned')
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(0)
  const [grid, setGrid] = useState(true)
  const [nav, setNav] = useState(false)
  const requestKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    setNav(!id && matchMedia('(min-width:901px)').matches)
  }, [id])
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (saved) {
        setPrompt(saved.prompt || '')
        setStyle(saved.style || '')
        setExample(saved.example || '')
        if (modes.includes(saved.mode)) setMode(saved.mode)
      }
      const selected = new URL(location.href).searchParams.get('example')
      if (selected && presets.some((p) => p.id === selected)) setExample(selected)
    } catch {
      setError(
        'Your saved composer could not be restored. Your previous browser data is unchanged.'
      )
    }
    setLoaded(true)
    void fetch('/api/account')
      .then((r) => r.json())
      .then(setAccount)
      .catch(() => {})
    const refreshProviders = () =>
      fetch('/api/providers')
        .then((r) => r.json())
        .then((data: ProviderStatus[]) => {
          if (!Array.isArray(data)) return
          setProviders(data)
          const provider = ['byok']
            .map((id) => data.find((p) => p.id === id && p.available))
            .find(Boolean)
          if (provider?.selectedModel)
            setChoice({
              provider: provider.id as ModelChoice['provider'],
              model: provider.selectedModel,
            })
          else setChoice(undefined)
        })
        .catch(() => {})
    void refreshProviders()
    window.addEventListener('forge:connections', refreshProviders)
    const refresh = () =>
      fetch('/api/status')
        .then((r) => r.json())
        .then(setReady)
        .catch(() => setReady({ worker: false, message: 'Runtime unavailable.' }))
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('forge:connections', refreshProviders)
    }
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(draftKey, JSON.stringify({ prompt, mode, style, example }))
    } catch {
      setError(
        'Browser draft recovery is unavailable. Keep this tab open until the request is saved.'
      )
    }
    requestKey.current = undefined
  }, [prompt, mode, style, example, loaded])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void fetch(
        `/api/projects?${new URLSearchParams({ q: search, filter, sort, page: String(page) })}`,
        { signal: controller.signal }
      )
        .then(async (r) => {
          if (r.ok) setProjects(await r.json())
        })
        .catch(() => {})
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search, filter, sort, page, id])
  useEffect(() => {
    if (id)
      void fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opened: true }),
      })
  }, [id])
  async function start() {
    if (creating || prompt.trim().length < 20) return
    if (account?.mode === 'hosted' && !account.user) {
      router.push('/login')
      return
    }
    if (!choice) {
      setError('Choose an available model in Connections first.')
      return
    }
    setCreating(true)
    setError('')
    requestKey.current ??= crypto.randomUUID()
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          mode,
          ...choice,
          design: { style, preserve: '', ...(example ? { exampleId: example } : {}) },
          idempotencyKey: requestKey.current,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      router.push(`/app/projects/${data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start this request.')
    } finally {
      setCreating(false)
    }
  }
  async function update(p: ProjectSummary, patch: object) {
    const r = await fetch(`/api/projects/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) {
      setError('The project could not be updated.')
      return
    }
    setProjects((all) => all.map((v) => (v.id === p.id ? { ...v, ...patch } : v)))
  }
  const library = (
    <section aria-labelledby="projects-title" className="project-library">
      <div className="section-heading">
        <h2 id="projects-title">{view === 'projects' ? 'Your projects' : 'Recently opened'}</h2>
        <Link href="/app">New project ↗</Link>
      </div>
      {view === 'projects' && (
        <div className="library-filters">
          <label>
            Search projects
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Search your ideas…"
            />
          </label>
          <label>
            Show
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setPage(0)
              }}
            >
              {['owned', 'shared', 'starred', 'archived'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Recently opened</option>
              <option value="updated">Recently updated</option>
              <option value="name">Name</option>
            </select>
          </label>
          <button aria-pressed={!grid} onClick={() => setGrid(!grid)}>
            {grid ? 'List view' : 'Grid view'}
          </button>
        </div>
      )}
      <div className={grid ? 'projects-grid' : 'projects-list'}>
        {projects
          .filter((p) => filter === 'archived' || !p.archived)
          .slice(0, view === 'home' ? 6 : 24)
          .map((p) => (
            <article className="project-card" key={p.id}>
              <Link href={`/app/projects/${p.id}`}>
                <span className="project-glyph" aria-hidden="true">
                  ◇
                </span>
                <h3>{p.name}</h3>
                <p>{p.brief || 'Imported project'}</p>
                <small>
                  {p.activeRevision ? 'Saved revision' : 'Draft'} ·{' '}
                  {new Date(p.lastOpenedAt).toLocaleDateString()}
                </small>
              </Link>
              <div className="project-actions">
                <button
                  aria-label={`${p.starred ? 'Unstar' : 'Star'} ${p.name}`}
                  aria-pressed={p.starred}
                  onClick={() => void update(p, { starred: !p.starred })}
                >
                  {p.starred ? '★' : '☆'}
                </button>
                <button onClick={() => void update(p, { archived: !p.archived })}>
                  {p.archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            </article>
          ))}
      </div>
      {!projects.length && (
        <p className="empty-state">
          {search
            ? 'No matching projects. Try a different search.'
            : 'A little room for your next idea. Your projects will appear here.'}
        </p>
      )}
      {view === 'projects' && (
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button disabled={projects.length < 24} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  )
  return (
    <div className={`forge-app ${id ? 'builder-app' : ''} ${nav ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside
        className="app-sidebar"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setNav(false)
            document.getElementById('nav-toggle')?.focus()
          }
        }}
      >
        <Link className="brand" href="/">
          forge<span className="muted">.ai</span>
        </Link>
        <p className="eyebrow">YOUR WORKSPACE</p>
        <nav
          aria-label="Main navigation"
          onClick={() => {
            if (matchMedia('(max-width:900px)').matches) setNav(false)
          }}
        >
          {[
            ['/app', 'Home'],
            ['/app/projects', 'Projects'],
            ['/examples', 'Examples'],
            ['/app/connections', 'Connections'],
            ['/docs', 'Documentation'],
            ['/app/settings', 'Settings'],
          ].map(([href, label]) => (
            <Link
              href={href}
              key={href}
              aria-current={
                !id && label.toLowerCase() === (view === 'home' ? 'home' : view)
                  ? 'page'
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <small>
            {account?.user?.local ? 'Local workspace' : account?.user?.email || 'Hosted beta'}
          </small>
          <UsageSummary />
          <ThemeControl />
          <Link href="/login">Account →</Link>
        </div>
      </aside>
      {nav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setNav(false)}
        />
      )}
      <div className="app-content">
        <header className="app-topbar">
          <button
            id="nav-toggle"
            aria-label="Toggle workspace navigation"
            aria-expanded={nav}
            onClick={() => setNav(!nav)}
          >
            ☰
          </button>
          <span>
            {id
              ? 'Project'
              : view === 'home'
                ? 'A place for your next idea'
                : view[0].toUpperCase() + view.slice(1)}
          </span>
          <Link href="/app">New project +</Link>
        </header>
        <main id="main" tabIndex={-1}>
          {id ? (
            <ProjectWorkspace id={id} choice={choice} />
          ) : view === 'connections' ? (
            <div className="workspace-page">
              <p className="eyebrow">CONNECTIONS</p>
              <h1>Your tools, connected.</h1>
              <p>Your API connections, verified capabilities and task assignments.</p>
              <ProviderPanel />
            </div>
          ) : view === 'settings' ? (
            <WorkspaceSettings account={account} />
          ) : (
            <div className="workspace-page">
              {view === 'home' ? (
                <>
                  <div className="home-heading">
                    <p className="eyebrow">FROM THE FIRST SPARK</p>
                    <h1>
                      What would you like
                      <br />
                      to bring to life?
                    </h1>
                    <p>Describe a website, an app, or something entirely yours.</p>
                  </div>
                  <form
                    className="main-composer"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void start()
                    }}
                  >
                    <label className="sr-only" htmlFor="prompt">
                      Describe your project
                    </label>
                    <textarea
                      id="prompt"
                      placeholder="A place for…"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      minLength={20}
                      maxLength={12000}
                      rows={5}
                    />
                    <div className="mode-controls" role="group" aria-label="Creation mode">
                      {modes.map((m) => (
                        <button
                          type="button"
                          key={m}
                          aria-pressed={mode === m}
                          onClick={() => setMode(m)}
                        >
                          {m[0].toUpperCase() + m.slice(1)}
                        </button>
                      ))}
                    </div>
                    <details className="composer-options">
                      <summary>
                        Visual direction & model <span>Optional</span>
                      </summary>
                      <label>
                        Your visual direction
                        <textarea
                          rows={2}
                          value={style}
                          onChange={(e) => setStyle(e.target.value)}
                          maxLength={4000}
                          placeholder="Let Forge choose, or describe the look and feel…"
                        />
                      </label>
                      <label>
                        Starting example
                        <select value={example} onChange={(e) => setExample(e.target.value)}>
                          <option value="">Choose for me · no example required</option>
                          {presets.map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Model
                        <select
                          value={choice ? `${choice.provider}:${choice.model}` : ''}
                          onChange={(e) => {
                            const [provider, ...model] = e.target.value.split(':')
                            setChoice({
                              provider: provider as ModelChoice['provider'],
                              model: model.join(':'),
                            })
                          }}
                        >
                          <option value="" disabled>
                            Select an available model
                          </option>
                          {providers
                            .filter((p) => p.available && p.selectedModel)
                            .map((p) => (
                              <option key={p.id} value={`${p.id}:${p.selectedModel}`}>
                                {p.name} · {p.selectedModel}
                              </option>
                            ))}
                        </select>
                      </label>
                    </details>
                    <div className="composer-bottom">
                      <span>
                        {mode === 'build'
                          ? 'Your idea. Your own direction.'
                          : 'Explore the idea without starting a build.'}
                      </span>
                      <button className="primary" disabled={creating || prompt.trim().length < 20}>
                        {creating
                          ? 'Starting…'
                          : mode === 'build'
                            ? 'Build project ↗'
                            : 'Continue →'}
                      </button>
                    </div>
                  </form>
                  <p className="runtime-status" role="status">
                    {ready?.worker
                      ? 'Worker connected.'
                      : ready?.message || 'Checking availability…'}{' '}
                    {!choice && <Link href="/app/connections">Connect a model →</Link>}
                  </p>
                  <RoutingSummary />
                  {error && (
                    <p role="alert" className="form-error">
                      {error}
                    </p>
                  )}
                  <div className="starter-grid">
                    {starterPrompts.map(([title, text]) => (
                      <button
                        className="starter"
                        key={title}
                        onClick={() => {
                          setPrompt(text)
                          document.getElementById('prompt')?.focus()
                        }}
                      >
                        <strong>{title}</strong>
                        <span>Start with this idea ↗</span>
                      </button>
                    ))}
                  </div>
                  {library}
                </>
              ) : (
                <>
                  <h1>Room for every idea.</h1>
                  {library}
                  {error && <p role="alert">{error}</p>}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
function WorkspaceSettings({
  account,
}: {
  account:
    { user: { local: boolean; canBuild: boolean; email: string } | null; mode: string } | undefined
}) {
  return (
    <div className="workspace-page">
      <p className="eyebrow">SETTINGS</p>
      <h1>Make yourself at home.</h1>
      <section className="settings-section">
        <h2>Appearance</h2>
        <ThemeControl />
      </section>
      <section className="settings-section">
        <h2>Account</h2>
        <p>
          {account?.user?.local
            ? 'Local mode. Projects belong to this configured local workspace.'
            : account?.user?.email || 'Sign in to your hosted workspace.'}
        </p>
        <Link href="/login">Manage sign-in →</Link>
      </section>
      <section className="settings-section">
        <h2>Existing browser briefs</h2>
        <p>Keep your original JSON backup. Imports remain drafts and do not start a generation.</p>
        <LegacyImport />
      </section>
      <section className="settings-section">
        <h2>Hosted services</h2>
        <p>
          Azure Neon provisioning is blocked: this account currently lists only AWS regions. Hosted
          previews and publishing remain gated until their configuration and checks pass.
        </p>
      </section>
    </div>
  )
}
function LegacyImport() {
  const [status, setStatus] = useState('')
  return (
    <>
      <label>
        Import a Forge JSON backup
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            if (file.size > 2_000_000) {
              setStatus('The backup exceeds the 2 MB import limit.')
              return
            }
            try {
              const body = JSON.parse(await file.text())
              const r = await fetch('/api/projects/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
              const data = await r.json()
              setStatus(
                r.ok
                  ? `Imported ${data.count} archived drafts. Find them using Projects → Archived. Your original backup is unchanged.`
                  : data.error
              )
            } catch {
              setStatus('This backup could not be imported. Keep the original file for recovery.')
            }
          }}
        />
      </label>
      <p role="status">{status}</p>
    </>
  )
}

function UsageSummary() {
  const [usage, setUsage] = useState<{ remaining: number; limit: number; reset: string }>()
  useEffect(() => {
    const refresh = () =>
      fetch('/api/usage')
        .then((r) => (r.ok ? r.json() : null))
        .then(setUsage)
        .catch(() => {})
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => clearInterval(timer)
  }, [])
  return usage ? (
    <small title={usage.reset}>
      {usage.remaining} of {usage.limit} requests remaining today
    </small>
  ) : null
}
