import { AsyncLocalStorage } from 'node:async_hooks'

const delivery = new AsyncLocalStorage<{ failed: boolean }>()

/** Better Auth may intentionally swallow mail errors. Track delivery per request
 * so a failed transport cannot become a "check your inbox" success response. */
export async function withAuthDelivery(action: () => Promise<Response>): Promise<Response> {
  return delivery.run({ failed: false }, async () => {
    const response = await action()
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
  } catch {
    const state = delivery.getStore()
    if (state) state.failed = true
    throw new Error('Email delivery failed')
  }
}
