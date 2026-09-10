import { connect } from 'node:tls'
import type { TLSSocket } from 'node:tls'
import { createTransport } from 'nodemailer'
import { z } from 'zod'
import { hostedAuthOrigin } from './policy'
import { authPool } from './database'

export class AuthMailCapacityError extends Error {
  constructor() {
    super('Daily email capacity unavailable')
  }
}

/** Reserve before sending. Failed/uncertain attempts stay charged; no automatic
 * retries. A single existing row bounds both storage and daily personal usage. */
export async function reserveGmailDelivery() {
  const result = await authPool().query(`INSERT INTO forge_auth_admission(key,window_start,attempts)
    VALUES('email_daily',date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',1)
    ON CONFLICT(key) DO UPDATE SET
      window_start=EXCLUDED.window_start,
      attempts=CASE WHEN forge_auth_admission.window_start<EXCLUDED.window_start THEN 1 ELSE forge_auth_admission.attempts+1 END
    WHERE forge_auth_admission.window_start<EXCLUDED.window_start OR forge_auth_admission.attempts<50
    RETURNING attempts`)
  if (result.rowCount !== 1) throw new AuthMailCapacityError()
}

/** Fixed Gmail SMTP destination; no caller-selected host, attachments or logging.
 * A dedicated Google app password is server configuration, never the account's
 * ordinary password. The socket deadline cancels SMTP even while data arrives.
 */
export async function sendGmailAuthMail(email: string, url: string, subject: string) {
  const user = z.email().parse(process.env.FORGE_GMAIL_USER)
  const password = (process.env.FORGE_GMAIL_APP_PASSWORD ?? '').replaceAll(' ', '')
  if (!user.endsWith('@gmail.com') || !/^[a-z]{16}$/.test(password))
    throw new Error('Gmail delivery is not configured')
  z.email().max(320).parse(email)
  z.string()
    .min(1)
    .max(128)
    .regex(/^[^\r\n]+$/)
    .parse(subject)
  const target = new URL(z.string().max(8192).parse(url))
  if (target.origin !== hostedAuthOrigin() || target.username || target.password)
    throw new Error('Authentication link origin rejected')
  await reserveGmailDelivery()
  let socket: TLSSocket | undefined
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    socket?.destroy(new Error('AUTH_MAIL_TIMEOUT'))
  }, 10000)
  const mailer = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    tls: { rejectUnauthorized: true, servername: 'smtp.gmail.com' },
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    getSocket(_options, callback) {
      if (expired) {
        callback(new Error('AUTH_MAIL_TIMEOUT'))
        return
      }
      let returned = false
      socket = connect(
        {
          host: 'smtp.gmail.com',
          port: 465,
          servername: 'smtp.gmail.com',
          rejectUnauthorized: true,
        },
        () => {
          returned = true
          callback(null, { connection: socket!, secured: true })
        }
      )
      socket.once('error', (error) => {
        if (!returned) {
          returned = true
          callback(error)
        }
      })
    },
  })
  try {
    const result = await mailer.sendMail({
      from: { name: 'Forge', address: user },
      to: { address: email, name: '' },
      subject,
      text: `${subject}\n\nOpen this link to continue:\n${url}\n\nIf you did not request this email, you can ignore it.`,
    })
    if (result.rejected.length || result.accepted.length !== 1)
      throw new Error('Gmail did not accept the recipient')
  } finally {
    clearTimeout(timer)
    socket?.destroy()
    mailer.close()
  }
}
