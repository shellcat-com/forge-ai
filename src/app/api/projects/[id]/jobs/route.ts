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
    provider: z.enum(['gemini', 'groq', 'ollama', 'openrouter']).optional(),
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
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    const parsed = input.safeParse(await smallJson(request, 350000))
    if (!parsed.success) throw new AccessError(400, 'Invalid change request.')
    if (!(await readiness()).worker) throw new AccessError(503, 'Start the Forge worker first.')
    return Response.json(await queueJob(id, parsed.data, who.id), { status: 202 })
  } catch (e) {
    return apiError(e)
  }
}
