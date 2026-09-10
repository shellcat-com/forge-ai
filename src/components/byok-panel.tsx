'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  providerKinds,
  providerDefaults,
  protocols,
  taskRoles,
  singleModelRouting,
  emptyCandidates,
  routingSchema,
} from '../shared/byok'
import type { ProviderConnection, RoutingProfile, Selection, ModelProfile } from '../shared/byok'
async function api(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const r = await fetch('/api/byok/' + path, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? 'The operation could not be completed.')
  return data
}
const valueOf = (s: Selection | null) => (s ? `${s.connectionId}|${s.modelId}` : '')
const selectionOf = (value: string): Selection => {
  const [connectionId, ...model] = value.split('|')
  return { connectionId, modelId: model.join('|') }
}
const notify = () => window.dispatchEvent(new Event('forge:connections'))
export function ByokPanel() {
  const [connections, setConnections] = useState<ProviderConnection[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState('')
  const [provider, setProvider] = useState<(typeof providerKinds)[number]>('openai'),
    [protocol, setProtocol] = useState<(typeof protocols)[number]>('responses')
  const [baseUrl, setBaseUrl] = useState<string>(providerDefaults.openai.baseUrl),
    [label, setLabel] = useState(''),
    [key, setKey] = useState('')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0)
  const refresh = useCallback(async () => {
    try {
      const data = await api('connections?q=' + encodeURIComponent(query))
      setConnections(data.connections)
      setCursor(data.nextCursor)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [query])
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 200)
    return () => clearTimeout(t)
  }, [refresh])
  async function action(fn: () => Promise<unknown>, reload = true) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      if (reload) await refresh()
      setRevision((v) => v + 1)
      notify()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="byok-panel" aria-label="Your model connections">
      <p>
        Forge supplies no model API keys or credits. Connect your own API keys; your provider bills
        you directly. Local models use your own hardware.
      </p>
      <form
        className="byok-card byok-form"
        onSubmit={(e) => {
          e.preventDefault()
          const submittedKey = key
          setKey('')
          void action(async () => {
            await api('connections', 'POST', {
              label,
              provider,
              protocol,
              baseUrl,
              ...(submittedKey ? { key: submittedKey } : {}),
            })
            setLabel('')
            setNotice('Connection saved. Discover models and test their capabilities next.')
          })
        }}
      >
        <h2>Add a connection</h2>
        <label>
          Name
          <input
            required
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My coding account"
          />
        </label>
        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as typeof provider
              setProvider(p)
              setProtocol(providerDefaults[p].protocol)
              setBaseUrl(providerDefaults[p].baseUrl)
            }}
          >
            {providerKinds.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          API protocol
          <select
            value={protocol}
            disabled={provider !== 'custom'}
            onChange={(e) => setProtocol(e.target.value as typeof protocol)}
          >
            {protocols.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          API base URL
          <input
            required
            type="url"
            value={baseUrl}
            readOnly={!['custom', 'ollama'].includes(provider)}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1/"
          />
        </label>
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            required={protocol !== 'ollama'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            maxLength={8192}
          />
        </label>
        <button disabled={busy} type="submit">
          Save connection
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label>
        Find connections
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {!connections.length && <p>No connections found. Add your first provider above.</p>}
      <div className="byok-connections">
        {connections.map((c) => (
          <ConnectionCard key={c.id} connection={c} busy={busy} action={action} />
        ))}
      </div>
      {cursor && (
        <button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const data = await api(`connections?q=${encodeURIComponent(query)}&cursor=${cursor}`)
              setConnections((c) => [...c, ...data.connections])
              setCursor(data.nextCursor)
            }, false)
          }
        >
          Load more connections
        </button>
      )}
      <RoutingPanel refreshKey={revision} />
    </section>
  )
}
function ConnectionCard({
  connection: c,
  busy,
  action,
}: {
  connection: ProviderConnection
  busy: boolean
  action: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [modelId, setModelId] = useState(''),
    [contextWindow, setContextWindow] = useState(32768),
    [outputTokens, setOutputTokens] = useState(8192)
  const [selected, setSelected] = useState(''),
    [replacement, setReplacement] = useState(''),
    [notice, setNotice] = useState(''),
    [ack, setAck] = useState(false)
  const [dollars, setDollars] = useState(false),
    [budget, setBudget] = useState(1),
    [deleting, setDeleting] = useState(false)
  const testAbort = useRef<AbortController | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => () => testAbort.current?.abort(), [])
  const selectedModel = c.models.find((m) => m.id === (selected || c.models[0]?.id))
  const test = (capability: 'text' | 'structured' | 'research') =>
    action(async () => {
      const controller = new AbortController()
      testAbort.current = controller
      setTesting(true)
      try {
        const result = await api(
          `connections/${c.id}/test`,
          'POST',
          {
            modelId: selectedModel!.id,
            capability,
            idempotencyKey: crypto.randomUUID(),
            limits: {
              maxCalls: 1,
              maxRepairs: 0,
              maxOutputTokens: 1024,
              budgetMode: dollars ? 'dollars' : 'tokens',
              acknowledgeUnknownCost: ack,
              ...(dollars ? { maxCostMicros: Math.round(budget * 1_000_000) } : {}),
            },
          },
          controller.signal
        )
        setNotice(
          `${result.verified} test passed. Usage: ${result.usage?.classification ?? 'see saved run'}.`
        )
      } catch (error) {
        if (controller.signal.aborted)
          throw new Error(
            'Test stopped. The provider may have processed it; check provider usage before retrying.'
          )
        throw error
      } finally {
        setTesting(false)
        testAbort.current = null
      }
    })
  return (
    <article className="byok-card">
      <h3>{c.label}</h3>
      {testing && (
        <button type="button" onClick={() => testAbort.current?.abort()}>
          Stop test
        </button>
      )}
      <p>
        {c.provider} · {c.configured ? 'Credential saved' : 'Key needed'}
      </p>
      <p className="byok-address">{c.baseUrl}</p>
      <button
        disabled={busy}
        onClick={() => void action(() => api(`connections/${c.id}/discover`, 'POST'))}
      >
        Discover models
      </button>
      <details>
        <summary>Add or update a model manually</summary>
        <form
          className="byok-form"
          onSubmit={(e) => {
            e.preventDefault()
            void action(async () => {
              await api(`connections/${c.id}/models`, 'POST', {
                id: modelId,
                name: modelId,
                contextWindow,
                maxOutputTokens: outputTokens,
                capabilities: {
                  text: true,
                  structured: true,
                  research: c.provider === 'openai',
                  streaming: c.protocol !== 'gemini',
                },
              })
              setSelected(modelId)
              setModelId('')
            })
          }}
        >
          <label>
            Exact model ID
            <input
              required
              maxLength={200}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
          </label>
          <label>
            Context tokens
            <input
              type="number"
              min={1024}
              max={2000000}
              value={contextWindow}
              onChange={(e) => setContextWindow(Number(e.target.value))}
            />
          </label>
          <label>
            Maximum output tokens
            <input
              type="number"
              min={256}
              max={200000}
              value={outputTokens}
              onChange={(e) => setOutputTokens(Number(e.target.value))}
            />
          </label>
          <p>
            Use limits from your provider’s model documentation. Saving a model does not verify its
            capabilities.
          </p>
          <button disabled={busy}>Save model</button>
        </form>
      </details>
      {c.models.length > 0 && (
        <>
          <label>
            Model
            <select
              value={selectedModel?.id ?? ''}
              onChange={(e) => {
                setSelected(e.target.value)
                setNotice('')
              }}
            >
              {c.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <p>Verified: {selectedModel?.verified.join(', ') || 'not tested'}</p>
          <label className="byok-check">
            <input
              type="checkbox"
              checked={dollars}
              onChange={(e) => setDollars(e.target.checked)}
            />
            Set a dollar limit for each test
          </label>
          {dollars ? (
            <label>
              Test budget (USD)
              <input
                type="number"
                min={0.01}
                max={10}
                step={0.01}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className="byok-check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
              understand tests use my API key and token limits do not guarantee a dollar cost.
            </label>
          )}
          <div className="byok-actions">
            {(['text', 'structured', 'research'] as const)
              .filter((cap) => selectedModel?.capabilities[cap])
              .map((cap) => (
                <button
                  key={cap}
                  disabled={busy || (!ack && !dollars)}
                  onClick={() => void test(cap)}
                >
                  Test {cap}
                </button>
              ))}
          </div>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
      <details>
        <summary>Replace key or delete connection</summary>
        <form
          className="byok-form"
          onSubmit={(e) => {
            e.preventDefault()
            const key = replacement
            setReplacement('')
            void action(() => api(`connections/${c.id}`, 'PATCH', { revision: c.revision, key }))
          }}
        >
          <label>
            Replacement API key
            <input
              type="password"
              required
              autoComplete="off"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
          </label>
          <button disabled={busy}>Replace key</button>
        </form>
        <p>
          Replacing the key clears model tests and invalidates queued runs using the old version.
          Deleting this connection does not revoke the key at your provider.
        </p>
        {deleting ? (
          <div className="byok-actions">
            <button
              disabled={busy}
              onClick={() =>
                void action(() => api(`connections/${c.id}`, 'DELETE', { revision: c.revision }))
              }
            >
              Confirm deletion
            </button>
            <button onClick={() => setDeleting(false)}>Keep connection</button>
          </div>
        ) : (
          <button disabled={busy} onClick={() => setDeleting(true)}>
            Delete connection
          </button>
        )}
      </details>
    </article>
  )
}
export function RoutingPanel({
  scope = 'account',
  refreshKey = 0,
}: {
  scope?: string
  refreshKey?: number
}) {
  const [models, setModels] = useState<Array<Selection & { label: string; profile: ModelProfile }>>(
      []
    ),
    [profile, setProfile] = useState<RoutingProfile>(),
    [revision, setRevision] = useState(0)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let stopped = false
    async function load() {
      try {
        const all: ProviderConnection[] = []
        let cursor: string | null = null
        do {
          const d = await api('connections' + (cursor ? '?cursor=' + cursor : ''))
          all.push(...d.connections)
          cursor = d.nextCursor
        } while (cursor)
        const options = all.flatMap((c) =>
          c.models.map((m) => ({
            connectionId: c.id,
            modelId: m.id,
            label: `${c.label} / ${m.name}`,
            profile: m,
          }))
        )
        const saved = await api('routing?scope=' + scope)
        if (stopped) return
        setModels(options)
        setRevision(saved?.scope === scope ? saved.revision : 0)
        setProfile(
          saved?.profile ??
            (options[0]
              ? {
                  ...singleModelRouting(options[0]),
                  limits: {
                    ...singleModelRouting(options[0]).limits,
                    acknowledgeUnknownCost: false,
                  },
                }
              : undefined)
        )
      } catch (e) {
        if (!stopped) setError((e as Error).message)
      }
    }
    void load()
    return () => {
      stopped = true
    }
  }, [scope, refreshKey])
  if (!profile)
    return (
      <section className="byok-card">
        <h2>Task assignments</h2>
        <p>Add and test models to configure task assignments.</p>
        {error && <p role="alert">{error}</p>}
      </section>
    )
  const update = (next: RoutingProfile) => {
    setProfile(next)
    setNotice('')
  }
  const eligible = (role: string) =>
    models.filter((m) =>
      m.profile.verified.includes(
        role === 'research' ? 'research' : role === 'planning' ? 'text' : 'structured'
      )
    )
  async function save() {
    setBusy(true)
    setError('')
    try {
      const parsed = routingSchema.parse(profile)
      const saved = await api('routing?scope=' + scope, 'PUT', { revision, profile: parsed })
      setRevision(saved.revision)
      setNotice('Task assignments saved. They apply to new runs.')
      notify()
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'ZodError'
          ? 'Complete assignments and acknowledge the usage limits.'
          : (e as Error).message
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="byok-card byok-routing">
      <h2>{scope === 'account' ? 'Default task assignments' : 'Project task assignments'}</h2>
      <p>
        {scope === 'account' ? 'Used for new projects.' : 'Saving creates a project override.'}{' '}
        Running jobs keep their recorded settings.
      </p>
      <label>
        Routing mode
        <select
          value={profile.mode}
          onChange={(e) => update({ ...profile, mode: e.target.value as 'manual' | 'auto' })}
        >
          <option value="manual">Assign models myself</option>
          <option value="auto">Let my router choose</option>
        </select>
      </label>
      {profile.mode === 'auto' && (
        <label>
          Router model
          <select
            value={valueOf(profile.router)}
            onChange={(e) =>
              update({ ...profile, router: e.target.value ? selectionOf(e.target.value) : null })
            }
          >
            <option value="">Select a tested model</option>
            {eligible('router').map((m) => (
              <option key={valueOf(m)} value={valueOf(m)}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {taskRoles.map((role) => (
        <div className="byok-role" key={role}>
          <label>
            {role[0].toUpperCase() + role.slice(1)}
            <select
              value={valueOf(profile.assignments[role])}
              onChange={(e) => {
                if (!e.target.value && role !== 'research') return
                update({
                  ...profile,
                  assignments: {
                    ...profile.assignments,
                    [role]: e.target.value ? selectionOf(e.target.value) : null,
                  },
                })
              }}
            >
              <option value="">
                {role === 'research' ? 'Research disabled' : 'Select a tested model'}
              </option>
              {eligible(role).map((m) => (
                <option key={valueOf(m)} value={valueOf(m)}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {profile.mode === 'auto' && (role !== 'research' || profile.assignments.research) && (
            <label>
              Eligible {role} models
              <select
                multiple
                value={profile.candidates[role].map(valueOf)}
                onChange={(e) =>
                  update({
                    ...profile,
                    candidates: {
                      ...profile.candidates,
                      [role]: Array.from(e.target.selectedOptions).map((o) => selectionOf(o.value)),
                    },
                  })
                }
              >
                {eligible(role).map((m) => (
                  <option key={valueOf(m)} value={valueOf(m)}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <details>
            <summary>
              Optional {role} fallbacks ({profile.fallbacks[role].length})
            </summary>
            <p>
              Used only after a known provider rejection. Select models in the displayed order;
              interrupted requests are never retried automatically.
            </p>
            <select
              aria-label={`${role} fallback models`}
              multiple
              value={profile.fallbacks[role].map(valueOf)}
              onChange={(e) =>
                update({
                  ...profile,
                  fallbacks: {
                    ...profile.fallbacks,
                    [role]: Array.from(e.target.selectedOptions).map((o) => selectionOf(o.value)),
                  },
                })
              }
            >
              {eligible(role).map((m) => (
                <option key={valueOf(m)} value={valueOf(m)}>
                  {m.label}
                </option>
              ))}
            </select>
          </details>
        </div>
      ))}
      <fieldset className="byok-form">
        <legend>Run limits</legend>
        <label>
          Maximum model calls
          <input
            type="number"
            min={1}
            max={12}
            value={profile.limits.maxCalls}
            onChange={(e) =>
              update({
                ...profile,
                limits: { ...profile.limits, maxCalls: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          Repair rounds
          <input
            type="number"
            min={0}
            max={2}
            value={profile.limits.maxRepairs}
            onChange={(e) =>
              update({
                ...profile,
                limits: { ...profile.limits, maxRepairs: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          Output tokens per call
          <input
            type="number"
            min={256}
            max={32768}
            value={profile.limits.maxOutputTokens}
            onChange={(e) =>
              update({
                ...profile,
                limits: { ...profile.limits, maxOutputTokens: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          Budget mode
          <select
            value={profile.limits.budgetMode}
            onChange={(e) =>
              update({
                ...profile,
                limits: {
                  ...profile.limits,
                  budgetMode: e.target.value as 'tokens' | 'dollars',
                  ...(e.target.value === 'dollars'
                    ? { maxCostMicros: profile.limits.maxCostMicros ?? 1000000 }
                    : {}),
                },
              })
            }
          >
            <option value="tokens">Token and call limits</option>
            <option value="dollars">Dollar ceiling</option>
          </select>
        </label>
        {profile.limits.budgetMode === 'dollars' ? (
          <label>
            Maximum USD per run
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={(profile.limits.maxCostMicros ?? 1000000) / 1000000}
              onChange={(e) =>
                update({
                  ...profile,
                  limits: {
                    ...profile.limits,
                    maxCostMicros: Math.round(Number(e.target.value) * 1000000),
                  },
                })
              }
            />
          </label>
        ) : (
          <label className="byok-check">
            <input
              type="checkbox"
              checked={profile.limits.acknowledgeUnknownCost}
              onChange={(e) =>
                update({
                  ...profile,
                  limits: { ...profile.limits, acknowledgeUnknownCost: e.target.checked },
                })
              }
            />
            I understand tokens and calls are limited, but the dollar cost can be unknown.
          </label>
        )}
      </fieldset>
      <p>
        Research, routing, review, repairs and configured fallbacks all count toward the same
        limits. Dollar ceilings require current server pricing policies.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={() => void save()}>
        Save task assignments
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => update({ ...profile, fallbacks: emptyCandidates() })}
      >
        Clear all fallbacks
      </button>
    </section>
  )
}

export function RoutingSummary({ scope = 'account' }: { scope?: string }) {
  const [profile, setProfile] = useState<RoutingProfile>()
  const [connections, setConnections] = useState<
    Array<{ id: string; label: string; provider: string; deleted: boolean }>
  >([])
  useEffect(() => {
    let active = true
    const load = () =>
      api('routing?scope=' + scope)
        .then((s) => {
          if (active) {
            setProfile(s?.profile)
            setConnections(s?.connections ?? [])
          }
        })
        .catch(() => {})
    void load()
    window.addEventListener('forge:connections', load)
    return () => {
      active = false
      window.removeEventListener('forge:connections', load)
    }
  }, [scope])
  if (!profile) return null
  return (
    <details className="byok-summary">
      <summary>Models and limits for this request</summary>
      <p>
        Participating connections:{' '}
        {connections
          .map(
            (c) =>
              `${c.label} (${c.provider}${c.deleted ? ', deleted — reconnect before running' : ''})`
          )
          .join('; ')}
      </p>
      <ul>
        {taskRoles.map((role) => (
          <li key={role}>
            {role}:{' '}
            {profile.mode === 'auto' && (role !== 'research' || profile.assignments.research)
              ? `${profile.candidates[role].length} eligible models · chosen by ${profile.router?.modelId}`
              : (profile.assignments[role]?.modelId ?? 'disabled')}
          </li>
        ))}
      </ul>
      <p>
        Up to {profile.limits.maxCalls} model calls and {profile.limits.maxRepairs} repair rounds.{' '}
        {profile.limits.budgetMode === 'dollars'
          ? `USD ceiling: ${(profile.limits.maxCostMicros ?? 0) / 1000000}.`
          : 'Token/call limits; dollar cost can be unknown.'}
      </p>
    </details>
  )
}
interface RunUsageData {
  status: string
  calls: number
  attempts: Array<{
    id: string
    task: string
    model_id: string
    status: string
    reserved_micros: string
    charged_micros: string | null
    error_code: string | null
    usage?: { classification: string; inputTokens?: number; outputTokens?: number }
    sources?: Array<{ url: string; title: string }>
  }>
}
export function RunUsage({ id }: { id?: string }) {
  const [data, setData] = useState<RunUsageData>()
  useEffect(() => {
    let active = true
    setData(undefined)
    if (!id) return
    const load = () =>
      api('runs/' + id)
        .then((s) => {
          if (active) setData(s)
        })
        .catch(() => {})
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [id])
  if (!data) return null
  return (
    <details className="byok-summary">
      <summary>
        Model activity · {data.calls} calls · {data.status}
      </summary>
      {data.attempts.map((a) => (
        <div key={a.id}>
          <p>
            {a.task} · {a.model_id} · {a.status}
          </p>
          <p>
            Usage: {a.usage?.classification ?? 'unknown'}
            {a.usage?.inputTokens !== undefined ? ` · ${a.usage.inputTokens} input tokens` : ''}
            {a.usage?.outputTokens !== undefined ? ` · ${a.usage.outputTokens} output tokens` : ''}
          </p>
          <p>
            {a.charged_micros !== null
              ? `Calculated cost: $${(Number(a.charged_micros) / 1000000).toFixed(6)} from reported usage and saved prices.`
              : `Cost unknown. Reserved liability: $${(Number(a.reserved_micros) / 1000000).toFixed(6)}; zero reservation does not mean free.`}
          </p>
          {a.error_code && (
            <p>
              Review this connection and provider usage before submitting a new run. Error:{' '}
              {a.error_code}.
            </p>
          )}
          {a.sources?.map((s) => (
            <p key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            </p>
          ))}
        </div>
      ))}
    </details>
  )
}
