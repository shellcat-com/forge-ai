import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { dash } from '@better-auth/infra'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import * as schema from './schema'
export function authCapabilities() {
  return {
    mode: process.env.FORGE_AUTH_MODE === 'hosted' ? 'hosted' : 'local',
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    email: !!(process.env.FORGE_EMAIL_ENDPOINT && process.env.FORGE_EMAIL_TOKEN),
  }
}
export async function invited(email: string) {
  const row = await db()
    .select()
    .from(schema.betaInvites)
    .where(eq(schema.betaInvites.email, email.toLowerCase()))
    .limit(1)
  return !!row[0] && !row[0].revoked && row[0].expiresAt > new Date()
}
async function sendAuthMail(email: string, url: string, subject: string) {
  const endpoint = process.env.FORGE_EMAIL_ENDPOINT
  if (!endpoint || new URL(endpoint).protocol !== 'https:')
    throw new Error('Email delivery is unavailable')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FORGE_EMAIL_TOKEN}`,
    },
    body: JSON.stringify({ to: email, subject, url }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Email delivery failed')
}
function createAuth() {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
    throw new Error('Configure BETTER_AUTH_SECRET before enabling authentication')
  if (!process.env.BETTER_AUTH_URL) throw new Error('Configure BETTER_AUTH_URL')
  const capabilities = authCapabilities()
  return betterAuth({
    appName: 'Forge AI',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: 'pg', schema }),
    trustedOrigins: [new URL(process.env.BETTER_AUTH_URL).origin],
    socialProviders: {
      ...(capabilities.google
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID!,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            },
          }
        : {}),
      ...(capabilities.github
        ? {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID!,
              clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            },
          }
        : {}),
    },
    emailAndPassword: {
      enabled: capabilities.email,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) =>
        sendAuthMail(user.email, url, 'Reset your Forge password'),
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        sendAuthMail(user.email, url, 'Verify your Forge email'),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await invited(user.email)))
              throw new APIError('FORBIDDEN', {
                message: 'A valid Forge beta invitation is required.',
              })
            return { data: user }
          },
        },
      },
    },
    plugins: process.env.BETTER_AUTH_API_KEY
      ? [dash({ apiKey: process.env.BETTER_AUTH_API_KEY })]
      : [],
  })
}
let instance: ReturnType<typeof createAuth> | undefined
export function auth() {
  return (instance ??= createAuth())
}
