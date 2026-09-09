'use client'
import { useEffect, useState } from 'react'
export function ReviewPanel({
  projectId,
  revisionId,
  owner,
  canComment,
}: {
  projectId: string
  revisionId: string | null
  owner: boolean
  canComment: boolean
}) {
  const [members, setMembers] = useState<{ id: string; email: string; role: string }[]>([])
  const [comments, setComments] = useState<
    { id: string; content: string; resolved: boolean; revisionId: string }[]
  >([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')
  async function refresh() {
    const results = await Promise.all([
      owner
        ? fetch(`/api/projects/${projectId}/sharing`)
        : Promise.resolve(new Response(null, { status: 403 })),
      fetch(`/api/projects/${projectId}/comments`),
    ])
    if (results[0].ok) setMembers(await results[0].json())
    if (results[1].ok) setComments(await results[1].json())
  }
  useEffect(() => {
    void refresh()
  }, [projectId])
  async function send(path: string, method: string, body: object) {
    const r = await fetch(`/api/projects/${projectId}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json()
    if (!r.ok) {
      setStatus(data.error)
      return
    }
    setStatus('Saved.')
    await refresh()
  }
  return (
    <section className="review-pane">
      <h2>A second pair of eyes.</h2>
      <p>
        {owner ? 'Share with an existing, verified Forge account.' : 'Private project review.'}{' '}
        Reviewers cannot build or publish.
      </p>
      {owner && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send('sharing', 'POST', { email, role })
          }}
        >
          <label>
            Reviewer email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Access
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="viewer">View preview</option>
              <option value="commenter">View and comment</option>
            </select>
          </label>
          <button>Add reviewer</button>
        </form>
      )}
      {members.map((m) => (
        <p key={m.id}>
          {m.email} · {m.role}{' '}
          <button onClick={() => void send('sharing', 'DELETE', { membershipId: m.id })}>
            Revoke
          </button>
        </p>
      ))}
      <h2>Revision comments</h2>
      {comments.map((c) => (
        <article key={c.id}>
          <p>{c.content}</p>
          <small>{c.revisionId === revisionId ? 'Current revision' : 'Earlier revision'}</small>
          {owner && (
            <button
              onClick={() => void send('comments', 'PATCH', { id: c.id, resolved: !c.resolved })}
            >
              {c.resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
        </article>
      ))}
      {canComment && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (revisionId) void send('comments', 'POST', { content, revisionId, page: '/' })
          }}
        >
          <label>
            Comment
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={4000}
              required
            />
          </label>
          <button disabled={!revisionId}>Save comment</button>
        </form>
      )}
      <p role="status">{status}</p>
    </section>
  )
}
