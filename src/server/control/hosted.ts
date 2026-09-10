import { ControlDatabase } from '../../../engine/control/database'
import { HostedIdentityBridge } from '../../../engine/control/hosted-identity'
import { hostedPostgresConfig } from '../../../engine/hosting/persistence-config'
import { actor, AccessError, requireBuilder } from '../auth/access'
import { auth } from '../auth/config'
import { hostedAuthOrigin } from '../auth/policy'

type HostedControl = { db: ControlDatabase; bridge: HostedIdentityBridge; checked?: Promise<void> }
const state = globalThis as unknown as { forgeHostedControl?: HostedControl }
export function hostedControlConfigured() {
  return process.env.FORGE_HOSTED_CONTROL === 'true'
}
export function hostedControl() {
  if (!hostedControlConfigured())
    throw new AccessError(503, 'Hosted workspace connections are not configured.')
  if (!state.forgeHostedControl) {
    const raw = process.env.FORGE_IDENTITY_BRIDGE_KEY ?? ''
    if (!/^[a-f0-9]{64}$/.test(raw))
      throw new AccessError(503, 'Hosted identity configuration is unavailable.')
    const db = new ControlDatabase(
      hostedPostgresConfig(
        process.env.FORGE_CONTROL_API_DATABASE_URL ?? '',
        process.env.FORGE_CONTROL_DATABASE_HOST ?? ''
      ),
      'forge_control_api',
      'hosted'
    )
    state.forgeHostedControl = { db, bridge: new HostedIdentityBridge(db, Buffer.from(raw, 'hex')) }
  }
  return state.forgeHostedControl
}

/** Browser requests stay same-origin; do not forward browser-selected identities
 * or engine tokens. Better Auth and the SQL bridge both validate the parent. */
export async function hostedActor(request: Request, mutation = false) {
  const who = await actor(request, mutation)
  if (who.local) throw new AccessError(403, 'A hosted account is required.')
  requireBuilder(who)
  const current = await auth().api.getSession({ headers: request.headers })
  if (!current || current.user.id !== who.id) throw new AccessError(401, 'Sign in to continue.')
  const control = hostedControl()
  control.checked ??= control.db.check().catch((error) => {
    control.checked = undefined
    throw error
  })
  await control.checked
  const settings = await control.db.tx((tx) =>
    tx.query('SELECT issuer FROM hosted_identity_settings WHERE singleton')
  )
  if (settings.rows[0]?.issuer !== `${hostedAuthOrigin()}/api/auth`)
    throw new AccessError(503, 'Hosted identity configuration does not match this installation.')
  const identity = await control.bridge.connect(current.session.token)
  return { ...identity, origin: hostedAuthOrigin(), control }
}
