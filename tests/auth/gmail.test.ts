import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport'
const smtp = vi.hoisted(() => ({
  options: undefined as SMTPTransportOptions | undefined,
  send: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  socket: undefined as unknown,
  reserve: vi.fn(),
}))
vi.mock('../../src/server/auth/database', () => ({ authPool: () => ({ query: smtp.reserve }) }))
vi.mock('nodemailer', () => ({
  createTransport: (options: SMTPTransportOptions) => {
    smtp.options = options
    return { sendMail: smtp.send, close: smtp.close }
  },
}))
vi.mock('node:tls', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    connect: (options: unknown, ready: () => void) => {
      smtp.connect(options)
      const socket = Object.assign(new EventEmitter(), {
        destroy: vi.fn((error?: Error) => {
          if (error) socket.emit('error', error)
          return socket
        }),
      })
      smtp.socket = socket
      queueMicrotask(ready)
      return socket
    },
  }
})
import { sendGmailAuthMail } from '../../src/server/auth/gmail'
import { sendAuthMail, authMailConfigured, withAuthDelivery } from '../../src/server/auth/delivery'

beforeEach(() => {
  vi.stubEnv('FORGE_EMAIL_TRANSPORT', 'gmail')
  vi.stubEnv('FORGE_GMAIL_USER', 'synthetic@example.invalid')
  vi.stubEnv('FORGE_GMAIL_APP_PASSWORD', 'abcdefghijklmnop')
  vi.stubEnv('BETTER_AUTH_URL', 'https://forge.example.com')
  smtp.options = undefined
  smtp.send.mockReset()
  smtp.close.mockReset()
  smtp.connect.mockReset()
  smtp.reserve.mockReset().mockResolvedValue({ rowCount: 1 })
  // Synthetic credentials; transport/socket are explicit fixtures, never real Gmail.
  vi.stubEnv('FORGE_GMAIL_USER', 'synthetic@gmail.com')
  smtp.send.mockResolvedValue({ accepted: ['recipient@example.invalid'], rejected: [] })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
const link = 'https://forge.example.com/api/auth/verify-email?token=synthetic-token'
it('uses fixed verified TLS Gmail, one text recipient and no attachment or protocol logging', async () => {
  expect(authMailConfigured()).toBe(true)
  await sendAuthMail('recipient@example.invalid', link, 'Verify your Forge account')
  expect(smtp.options).toMatchObject({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    tls: { rejectUnauthorized: true, servername: 'smtp.gmail.com' },
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  expect(smtp.send).toHaveBeenCalledOnce()
  expect(smtp.send.mock.calls[0][0]).toEqual({
    from: { name: 'Forge', address: 'synthetic@gmail.com' },
    to: { address: 'recipient@example.invalid', name: '' },
    subject: 'Verify your Forge account',
    text: expect.stringContaining(link),
  })
  expect(smtp.close).toHaveBeenCalledOnce()
})
it.each([
  ['victim@example.invalid\r\nBcc:another@example.invalid', link, 'Verify'],
  ['recipient@example.invalid', 'https://attacker.example.com/token', 'Verify'],
  ['recipient@example.invalid', link, 'Verify\r\nBcc:other@example.invalid'],
])(
  'rejects header injection or foreign token-link origins before transport creation',
  async (email, url, subject) => {
    await expect(sendGmailAuthMail(email, url, subject)).rejects.toThrow()
    expect(smtp.options).toBeUndefined()
  }
)
it('does not fall back to HTTP when Gmail configuration or the selected transport is invalid', async () => {
  vi.stubEnv('FORGE_GMAIL_APP_PASSWORD', '')
  expect(authMailConfigured()).toBe(false)
  await expect(sendAuthMail('recipient@example.invalid', link, 'Verify')).rejects.toThrow(
    'Email delivery failed'
  )
  vi.stubEnv('FORGE_EMAIL_TRANSPORT', 'unknown')
  expect(authMailConfigured()).toBe(false)
  await expect(sendAuthMail('recipient@example.invalid', link, 'Verify')).rejects.toThrow(
    'Email delivery failed'
  )
  expect(smtp.send).not.toHaveBeenCalled()
})
it('converts swallowed SMTP failures into a safe delivery failure without leaking credentials', async () => {
  smtp.send.mockRejectedValue(new Error('provider diagnostic abcdefghijklmnop synthetic-token'))
  const response = await withAuthDelivery(async () => {
    await sendAuthMail('recipient@example.invalid', link, 'Verify').catch(() => {})
    return Response.json({ ok: true })
  })
  expect(response.status).toBe(503)
  expect(await response.text()).not.toMatch(/abcdefghijklmnop|synthetic-token|provider diagnostic/)
  expect(smtp.close).toHaveBeenCalledOnce()
})
it('rejects an SMTP recipient refusal', async () => {
  smtp.send.mockResolvedValue({ accepted: [], rejected: ['recipient@example.invalid'] })
  await expect(sendAuthMail('recipient@example.invalid', link, 'Verify')).rejects.toThrow(
    'Email delivery failed'
  )
})
it('pauses before opening SMTP when the persisted daily allowance is exhausted', async () => {
  smtp.reserve.mockResolvedValue({ rowCount: 0 })
  await expect(sendAuthMail('recipient@example.invalid', link, 'Verify')).rejects.toThrow(
    'Email delivery failed'
  )
  expect(smtp.send).not.toHaveBeenCalled()
  expect(smtp.connect).not.toHaveBeenCalled()
  const response = await withAuthDelivery(async () => {
    await sendAuthMail('recipient@example.invalid', link, 'Verify').catch(() => {})
    return Response.json({ ok: true })
  })
  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toMatch(/^\d+$/)
  expect(await response.text()).toContain('00:00 UTC')
})
it('destroys the verified SMTP socket on the absolute deadline', async () => {
  vi.useFakeTimers()
  smtp.send.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        smtp.options!.getSocket!({}, (error, connection) => {
          if (error) {
            reject(error)
            return
          }
          if (connection && connection.connection) connection.connection.once('error', reject)
        })
      })
  )
  const result = sendAuthMail('recipient@example.invalid', link, 'Verify')
  const assertion = expect(result).rejects.toThrow('Email delivery failed')
  await vi.advanceTimersByTimeAsync(10000)
  await assertion
  expect(smtp.connect).toHaveBeenCalledWith({
    host: 'smtp.gmail.com',
    port: 465,
    servername: 'smtp.gmail.com',
    rejectUnauthorized: true,
  })
  expect(smtp.close).toHaveBeenCalledOnce()
})
