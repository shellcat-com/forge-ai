import { AsyncLocalStorage } from 'node:async_hooks'
import { AuthMailCapacityError, sendGmailAuthMail } from './gmail'

const delivery = new AsyncLocalStorage<{ failed: boolean; capacity?: boolean }>()

export function authMailConfigured() {
  const transport = process.env.FORGE_EMAIL_TRANSPORT ?? 'http'
  if (transport === 'gmail')
    return !!(process.env.FORGE_GMAIL_USER && process.env.FORGE_GMAIL_APP_PASSWORD)
  return (
    transport === 'http' && !!(process.env.FORGE_EMAIL_ENDPOINT && process.env.FORGE_EMAIL_TOKEN)
  )
}

/** Better Auth may intentionally swallow mail errors. Track delivery per request
 * so a failed transport cannot become a "check your inbox" success response. */
export async function withAuthDelivery(action: () => Promise<Response>): Promise<Response> {
  return delivery.run({ failed: false }, async () => {
    const response = await action()
    if (delivery.getStore()?.capacity) {
      const seconds = Math.ceil((86400000 - (Date.now() % 86400000)) / 1000)
      return Response.json(
        {
          code: 'EMAIL_CAPACITY_UNAVAILABLE',
          message: 'The daily email allowance is used. Try again after 00:00 UTC.',
        },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(seconds) } }
      )
    }
    if (delivery.getStore()?.failed)
      return Response.json(
        {
          code: 'EMAIL_DELIVERY_UNAVAILABLE',
          message: 'Email delivery is unavailable. Please retry later.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      )
    return response
  })
}

export async function sendAuthMail(email: string, url: string, subject: string) {
  try {
    if (process.env.FORGE_EMAIL_TRANSPORT === 'gmail') {
      await sendGmailAuthMail(email, url, subject)
      return
    }
    if (process.env.FORGE_EMAIL_TRANSPORT && process.env.FORGE_EMAIL_TRANSPORT !== 'http')
      throw new Error('Email transport is not supported')
    const endpoint = process.env.FORGE_EMAIL_ENDPOINT
    if (!endpoint || new URL(endpoint).protocol !== 'https:' || !process.env.FORGE_EMAIL_TOKEN)
      throw new Error('Email delivery is unavailable')
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FORGE_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({ to: email, subject, url }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    await response.body?.cancel()
    if (!response.ok) throw new Error('Email delivery failed')
  } catch (error) {
    const state = delivery.getStore()
    if (state) {
      state.failed = true
      state.capacity = error instanceof AuthMailCapacityError
    }
    throw new Error('Email delivery failed')
  }
}
