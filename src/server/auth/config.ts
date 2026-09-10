import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { dash } from '@better-auth/infra'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { authDb as db } from './database'
import * as schema from './schema'
import { authMode, hostedAuthOrigin, signupPolicy } from './policy'
import { sendAuthMail } from './delivery'
export function authCapabilities() {
  return {
    mode: authMode(),
    signup: signupPolicy(),
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
export function createAuth() {
  if (authMode() !== 'hosted') throw new Error('Hosted authentication is disabled')
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
    throw new Error('Configure BETTER_AUTH_SECRET before enabling authentication')
  if (!process.env.BETTER_AUTH_URL) throw new Error('Configure BETTER_AUTH_URL')
  const capabilities = authCapabilities()
  return betterAuth({
    appName: 'Forge AI',
    baseURL: hostedAuthOrigin(),
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: 'pg', schema }),
    trustedOrigins: [new URL(process.env.BETTER_AUTH_URL).origin],
    telemetry: { enabled: false },
    logger: { disabled: true },
    session: {
      expiresIn: 12 * 60 * 60,
      freshAge: 15 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
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
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendAuthMail(user.email, url, 'Reset your Forge password'),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        sendAuthMail(user.email, url, 'Verify your Forge email'),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (signupPolicy() === 'invite' && !(await invited(user.email)))
              throw new APIError('FORBIDDEN', {
                message: 'A valid Forge beta invitation is required.',
              })
            return { data: { ...user, disabledAt: null } }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db().query.user.findFirst({
              where: eq(schema.user.id, session.userId),
            })
            if (!user || user.disabledAt)
              throw new APIError('FORBIDDEN', { message: 'Account unavailable.' })
            return { data: session }
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
