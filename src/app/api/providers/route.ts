import 'server-only'
import { actor, apiError } from '../../../server/auth/access'
import { ByokError } from '../../../server/byok/transport'
import { ConnectionStore } from '../../../server/byok/store'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const who = await actor(request),
      store = new ConnectionStore(),
      saved = await store.profile(who, 'account')
    let available = !!saved
    let message = saved
      ? 'Uses your own connections and saved task assignments.'
      : 'Connect and test your models, then save task assignments.'
    if (saved) {
      try {
        await store.transaction(who, (tx) => store.snapshot(tx, who, saved.profile))
      } catch (error) {
        if (!(error instanceof ByokError)) throw error
        available = false
        message = error.message
      }
    }
    return Response.json(
      [
        {
          id: 'byok',
          name: 'Your task assignments',
          available,
          selectedModel: available ? 'task-routing' : undefined,
          models: available ? [{ id: 'task-routing', name: 'Saved task assignments' }] : [],
          message,
        },
      ],
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return apiError(error)
  }
}
