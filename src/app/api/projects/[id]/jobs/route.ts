import { queueByok } from '../../../../../server/byok/service'
import { ConnectionStore } from '../../../../../server/byok/store'
import { ByokError } from '../../../../../server/byok/transport'
import 'server-only'
import { z } from 'zod'
import {
  actor,
  projectAccess,
  requireBuilder,
  apiError,
  AccessError,
} from '../../../../../server/auth/access'
import { smallJson } from '../../../../../server/http/local'
import { queueJob, readiness } from '../../../../../server/projects/service'
const input = z
  .object({
    kind: z.enum(['generate', 'edit', 'restore', 'idea', 'brainstorm', 'plan']),
    prompt: z.string().trim().min(5).max(12000).optional(),
    provider: z.enum(['gemini', 'groq', 'ollama', 'openrouter', 'byok']).optional(),
    model: z.string().min(1).max(200).optional(),
    files: z.record(z.string(), z.string()).optional(),
    revisionId: z.uuid().optional(),
    baseRevision: z.uuid().nullable(),
    restoreData: z.boolean().optional(),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      ['generate', 'idea', 'brainstorm', 'plan'].includes(v.kind) &&
      (!v.prompt || !v.provider || !v.model)
    )
      ctx.addIssue({ code: 'custom', message: 'Prompt and model required' })
    if (v.kind === 'restore' && !v.revisionId)
      ctx.addIssue({ code: 'custom', message: 'Revision required' })
    if (v.kind === 'edit' && !v.files) ctx.addIssue({ code: 'custom', message: 'Files required' })
  })
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const who = await actor(request, true)
    requireBuilder(who)
    if (!who.local)
      throw new AccessError(
        503,
        'Hosted app building is disabled until tenant-safe runtime acceptance passes.'
      )
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    const parsed = input.safeParse(await smallJson(request, 350000))
    if (!parsed.success) throw new AccessError(400, 'Invalid change request.')
    if (!(await readiness()).worker) throw new AccessError(503, 'Start the Forge worker first.')
    if (['generate', 'idea', 'brainstorm', 'plan'].includes(parsed.data.kind)) {
      if (parsed.data.provider !== 'byok')
        throw new AccessError(409, 'Save your model task assignments before building.')
      return Response.json(await queueByok(new ConnectionStore(), who, parsed.data, id), {
        status: 202,
      })
    }
    return Response.json(await queueJob(id, parsed.data, who.id), { status: 202 })
  } catch (e) {
    if (e instanceof ByokError) return Response.json({ error: e.message }, { status: e.status })
    return apiError(e)
  }
}
