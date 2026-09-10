'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createAuthClient } from 'better-auth/react'
import { ThemeControl } from './theme-control'
import { authReturn } from '../shared/auth-return'
const client = createAuthClient()
export function Login({ recovery = false }: { recovery?: boolean }) {
  const [cap, setCap] = useState<{
    mode: string
    user: { email: string; local: boolean } | null
    google: boolean
    github: boolean
    email: boolean
  }>()
  const [status, setStatus] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [destination, setDestination] = useState('/app')
  const [token, setToken] = useState('')
  useEffect(() => {
    const params = new URL(location.href).searchParams
    setDestination(authReturn(params.get('returnTo')))
    setToken(params.get('token') || '')
    void fetch('/api/account')
      .then((r) => r.json())
      .then(setCap)
      .catch(() => setStatus('Account service unavailable.'))
  }, [])
  async function submit() {
    setBusy(true)
    setStatus('')
    try {
      if (recovery) {
        const result = await client.resetPassword({ newPassword: password, token })
        setStatus(result.error?.message || 'Password updated. You can now sign in.')
      } else if (register) {
        const result = await client.signUp.email({
          email,
          password,
          name,
          callbackURL: destination,
        })
        setStatus(result.error?.message || 'Check your email to verify your account, then sign in.')
      } else {
        const result = await client.signIn.email({ email, password, callbackURL: destination })
        if (result.error) setStatus(result.error.message || 'Sign-in failed.')
        else location.assign(destination)
      }
    } catch {
      setStatus('The account service could not be reached. Your draft remains saved.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="login-page">
      <section className="login-form">
        <Link className="brand" href="/">
          forge.ai
        </Link>
        <div>
          <p className="eyebrow">A GOOD PLACE TO BEGIN</p>
          <h1>
            {recovery ? (
              'A fresh start.'
            ) : (
              <>
                Your next idea
                <br />
                starts here.
              </>
            )}
          </h1>
          <p>Your saved prompt will be waiting in the workspace.</p>
          {recovery ? (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button disabled={busy || !token}>Reset password</button>
              </form>
              {!token && <p>This recovery link is incomplete. Request a new one from sign-in.</p>}
              <Link href="/login">Return to sign-in →</Link>
            </>
          ) : cap?.mode === 'local' ? (
            <>
              <p className="notice">Local workspace · no account required.</p>
              <Link className="button primary" href={destination}>
                Open local workspace →
              </Link>
            </>
          ) : cap?.user ? (
            <>
              <p>Signed in as {cap.user.email}</p>
              <Link className="button primary" href={destination}>
                Open workspace →
              </Link>
              <button
                onClick={async () => {
                  await client.signOut()
                  location.reload()
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p>Hosted beta requires an invitation.</p>
              {(['google', 'github'] as const)
                .filter((p) => cap?.[p])
                .map((provider) => (
                  <button
                    key={provider}
                    onClick={async () => {
                      const result = await client.signIn.social({
                        provider,
                        callbackURL: destination,
                      })
                      if (result.error) setStatus(result.error.message || 'Sign-in failed.')
                    }}
                  >
                    Continue with {provider === 'google' ? 'Google' : 'GitHub'}
                  </button>
                ))}
              {cap?.email && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submit()
                  }}
                >
                  {register && (
                    <label>
                      Your name
                      <input
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={100}
                      />
                    </label>
                  )}
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete={register ? 'new-password' : 'current-password'}
                      minLength={register ? 12 : undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {register ? 'Accept invitation →' : 'Sign in →'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRegister(!register)
                      setStatus('')
                    }}
                  >
                    {register ? 'I already have an account' : 'Accept an invitation'}
                  </button>
                  {!register && (
                    <button
                      type="button"
                      disabled={busy || !email}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          const r = await client.requestPasswordReset({
                            email,
                            redirectTo: '/reset-password',
                          })
                          setStatus(
                            r.error?.message ||
                              'If the account exists, recovery instructions will be sent.'
                          )
                        } catch {
                          setStatus('Could not request recovery. Please retry.')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Forgot password
                    </button>
                  )}
                </form>
              )}
              {cap && !cap.google && !cap.github && !cap.email && (
                <p className="notice">
                  Sign-in is awaiting provider configuration. Your draft remains saved.
                </p>
              )}
            </>
          )}
          {status && <p role="status">{status}</p>}
        </div>
        <ThemeControl />
      </section>
      <div className="login-art">
        <img src="/art/login-1280.webp" alt="" />
        <p>
          A little more intention.
          <br />A lot more possibility.
        </p>
      </div>
    </main>
  )
}
