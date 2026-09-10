import { z } from 'zod'
export const modes = ['idea', 'brainstorm', 'plan', 'build'] as const
export type CreationMode = (typeof modes)[number]
export const designBriefSchema = z
  .object({
    style: z.string().max(4000).default(''),
    exampleId: z.string().max(80).optional(),
    preserve: z.string().max(2000).default(''),
  })
  .strict()
export const creationSchema = z
  .object({
    prompt: z.string().trim().min(20).max(12000),
    mode: z.enum(modes).default('build'),
    provider: z.enum(['gemini', 'groq', 'ollama', 'openrouter', 'byok']),
    model: z.string().min(1).max(200),
    design: designBriefSchema.default({ style: '', preserve: '' }),
    idempotencyKey: z.uuid(),
  })
  .strict()
export type CreationInput = z.infer<typeof creationSchema>
export function projectName(prompt: string) {
  return (
    prompt
      .replace(/^(please\s+)?(build|create|make|design)\s+(me\s+)?(an?\s+)?/i, '')
      .split(/[.!?\n]/)[0]
      .slice(0, 80)
      .trim() || 'Untitled project'
  )
}
