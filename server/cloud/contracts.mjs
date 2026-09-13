import { z } from 'zod'

export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(20).max(12000),
    template: z.enum(['Next.js + Postgres', 'React + Express', 'Vue + FastAPI']),
    presetId: z.enum([
      'technical-mono',
      'editorial-product',
      'cinematic-monochrome',
      'atmospheric-pixel',
      'illustrated-landscape',
    ]),
  })
  .strict()
export const revision = z.number().int().positive()
export const idea = z
  .object({
    name: z.string().max(100),
    audience: z.string().max(500),
    outcome: z.string().max(4000),
    features: z.string().max(4000),
    presetId: projectInput.shape.presetId,
  })
  .strict()
export const onboardingInput = z
  .object({ version: z.literal(1), stage: z.number().int().min(0).max(3), draft: idea, revision })
  .strict()
export const emptyOnboarding = {
  version: 1,
  stage: 0,
  draft: { name: '', audience: '', outcome: '', features: '', presetId: 'technical-mono' },
  completedAt: null,
  projectId: null,
}
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export function parse(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) throw new HttpError(422, 'Check the form fields and try again.')
  return result.data
}
