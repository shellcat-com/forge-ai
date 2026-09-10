'use client'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Provider = { id: string; name: string; models: string[]; keyUrl: string }
type Connection = {
  id: string
  provider: string
  revision: number
  model: string | null
  checkedAt: string | null
  selected: boolean
}
type Connections = { providers: Provider[]; connections: Connection[] }
export function HostedConnections() {
  const [data, setData] = useState<Connections>()
  const [provider, setProvider] = useState('gemini')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function load(signal?: AbortSignal) {
    const response = await fetch('/api/connections', { signal, cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Connections could not be loaded.')
    setData(body as Connections)
  }
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Connections unavailable.')
    })
    return () => controller.abort()
  }, [])
  async function mutate(path: string, method: string, body: unknown, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ||
            'The connection could not be updated. Sign in again if your session is no longer fresh.'
        )
      await load()
      setMessage(success)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The connection could not be updated.')
    } finally {
      setBusy(false)
    }
  }
  function connect(event: FormEvent) {
    event.preventDefault()
    const value = key
    setKey('')
    void mutate(
      '/api/connections',
      'POST',
      { provider, key: value },
      'Key saved. Check and select a model below.'
    )
  }
  return (
    <section aria-labelledby="hosted-keys-heading">
      <h2 id="hosted-keys-heading">Your model keys</h2>
      <p>
        Connect your own free-tier account. Keys are encrypted on the server and are never included
        in generated source. Model checks do not generate a website.
      </p>
      {error && <p role="alert">{error}</p>}
      <p role="status">{busy ? 'Updating connection…' : message}</p>
      {!data ? (
        <button
          className="provider-test"
          disabled={busy}
          onClick={() => {
            setError('')
            void load().catch((e) =>
              setError(e instanceof Error ? e.message : 'Connections unavailable.')
            )
          }}
        >
          Reload connections
        </button>
      ) : (
        <>
          <form onSubmit={connect} className="provider-card hosted-key-form">
            <label className="model-label">
              Provider
              <select
                aria-label="Provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={busy}
              >
                {data.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <a
              href={data.providers.find((p) => p.id === provider)?.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open provider key settings ↗
            </a>
            <label className="model-label">
              API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                minLength={8}
                maxLength={8192}
                required
                disabled={busy}
              />
            </label>
            <button className="provider-test" disabled={busy || !key}>
              Save key
            </button>
          </form>
          {!data.connections.length && <p>No keys connected yet.</p>}
          <div className="provider-cards">
            {data.connections.map((c) => {
              const p = data.providers.find((p) => p.id === c.provider)
              return p ? (
                <ConnectionCard
                  key={`${c.id}:${c.revision}:${c.model}`}
                  connection={c}
                  provider={p}
                  busy={busy}
                  mutate={mutate}
                />
              ) : null
            })}
          </div>
        </>
      )}
      <p className="provider-intro">
        Free models have provider limits. Forge never upgrades your account or switches to a paid
        model. Removing a key here does not revoke it at the provider. Existing encrypted backups
        expire under this installation’s retention policy.
      </p>
    </section>
  )
}
function ConnectionCard({
  connection: c,
  provider: p,
  busy,
  mutate,
}: {
  connection: Connection
  provider: Provider
  busy: boolean
  mutate: (path: string, method: string, body: unknown, success: string) => Promise<void>
}) {
  const [model, setModel] = useState(c.model ?? p.models[0] ?? '')
  const [free, setFree] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [removing, setRemoving] = useState(false)
  return (
    <article className="provider-card hosted-key-form">
      <h3>{p.name}</h3>
      <span className="provider-badge">
        {c.selected ? 'Selected' : c.checkedAt ? 'Model access checked' : 'Key saved · not checked'}
      </span>
      <p>
        Connection {c.id.slice(0, 8)} · revision {c.revision}
      </p>
      <label className="model-label">
        Model
        <select
          aria-label={`${p.name} connection model`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={busy}
        >
          {p.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="hosted-key-consent">
        <input
          type="checkbox"
          checked={free}
          onChange={(e) => setFree(e.target.checked)}
          disabled={busy}
        />
        I checked that this provider account and model use the free tier.
      </label>
      <button
        className="provider-test"
        disabled={busy || !free || !model}
        onClick={() =>
          void mutate(
            `/api/connections/${c.id}/validate`,
            'POST',
            { model, expectedRevision: c.revision, freeTierConfirmed: true },
            'Model access checked and selected. Website generation has not been tested by this check.'
          )
        }
      >
        Check and select model
      </button>
      <details>
        <summary>Replace key</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const key = replacement
            setReplacement('')
            void mutate(
              `/api/connections/${c.id}`,
              'PATCH',
              { expectedRevision: c.revision, key },
              'Key replaced. Check the model again before using it.'
            )
          }}
        >
          <label className="model-label">
            Replacement API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              minLength={8}
              maxLength={8192}
              required
              disabled={busy}
            />
          </label>
          <button className="provider-test" disabled={busy || !replacement}>
            Replace key
          </button>
        </form>
      </details>
      {removing ? (
        <div>
          <p>Remove this key and its model selection?</p>
          <button
            className="provider-test"
            disabled={busy}
            onClick={() =>
              void mutate(
                `/api/connections/${c.id}`,
                'DELETE',
                { expectedRevision: c.revision },
                'Key removed from Forge.'
              )
            }
          >
            Confirm removal
          </button>
          <button className="text-button" disabled={busy} onClick={() => setRemoving(false)}>
            Keep key
          </button>
        </div>
      ) : (
        <button className="text-button" disabled={busy} onClick={() => setRemoving(true)}>
          Remove key
        </button>
      )}
    </article>
  )
}
