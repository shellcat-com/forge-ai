import { z } from 'zod'

export interface ControlConfig {
  enabled: boolean
  mode: 'fixture'
  origin: string
  port: number
  databaseUrl: string
  sessionKey: Uint8Array
  admission: boolean
  workers: boolean
  execution: false
  preview: false
}
export function readControlConfig(
  env: Record<string, string | undefined>
): ControlConfig | { enabled: false } {
  if (env.FORGE_CONTROL_ENABLED === undefined || env.FORGE_CONTROL_ENABLED === 'false')
    return { enabled: false }
  if (env.FORGE_CONTROL_ENABLED !== 'true')
    throw new Error('FORGE_CONTROL_ENABLED must be true or false')
  if (env.FORGE_CONTROL_MODE !== 'fixture')
    throw new Error('D1/D4/D5 unresolved: only explicit fixture mode is implemented')
  if (env.FORGE_CONTROL_EXECUTION === 'true' || env.FORGE_CONTROL_PREVIEW === 'true')
    throw new Error('Execution and preview are unavailable in E1')
  const origin = z.url().parse(env.FORGE_CONTROL_ORIGIN)
  const u = new URL(origin)
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.origin !== origin ||
    !['http:', 'https:'].includes(u.protocol)
  )
    throw new Error('Fixture control requires an exact loopback origin')
  const databaseUrl = z.string().min(1).parse(env.FORGE_CONTROL_DATABASE_URL)
  const d = new URL(databaseUrl)
  if (
    !['postgres:', 'postgresql:'].includes(d.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(d.hostname)
  )
    throw new Error('Fixture control requires a loopback database')
  const key = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(env.FORGE_CONTROL_SESSION_KEY)
  return {
    enabled: true,
    mode: 'fixture',
    origin,
    port: z.coerce.number().int().min(1024).max(65535).parse(env.FORGE_CONTROL_PORT),
    databaseUrl,
    sessionKey: Buffer.from(key, 'hex'),
    admission: env.FORGE_CONTROL_ADMISSION === 'true',
    workers: env.FORGE_CONTROL_WORKERS === 'true',
    execution: false,
    preview: false,
  }
}
