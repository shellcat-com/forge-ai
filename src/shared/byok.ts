import { z } from 'zod'
export const providerKinds = [
  'openai',
  'anthropic',
  'deepseek',
  'gemini',
  'groq',
  'openrouter',
  'ollama',
  'custom',
] as const
export const protocols = ['responses', 'messages', 'gemini', 'chat-completions', 'ollama'] as const
export const taskRoles = ['research', 'planning', 'coding', 'review', 'repair'] as const
export type TaskRole = (typeof taskRoles)[number]
export const selectionSchema = z.strictObject({
  connectionId: z.uuid(),
  modelId: z.string().trim().min(1).max(200),
})
export type Selection = z.infer<typeof selectionSchema>
export const limitsSchema = z
  .strictObject({
    maxCalls: z.number().int().min(1).max(12).default(12),
    maxRepairs: z.number().int().min(0).max(2).default(2),
    maxOutputTokens: z.number().int().min(256).max(32768).default(8192),
    budgetMode: z.enum(['tokens', 'dollars']).default('tokens'),
    maxCostMicros: z.number().int().min(1).max(100_000_000).optional(),
    acknowledgeUnknownCost: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.budgetMode === 'dollars' && !v.maxCostMicros)
      c.addIssue({ code: 'custom', message: 'Set a dollar limit.' })
    if (v.budgetMode === 'tokens' && !v.acknowledgeUnknownCost)
      c.addIssue({
        code: 'custom',
        message: 'Acknowledge that token limits do not guarantee a dollar cost.',
      })
  })
const assignmentsSchema = z.strictObject({
  research: selectionSchema.nullable(),
  planning: selectionSchema,
  coding: selectionSchema,
  review: selectionSchema,
  repair: selectionSchema,
})
const candidatesSchema = z.strictObject({
  research: z.array(selectionSchema).max(20),
  planning: z.array(selectionSchema).max(20),
  coding: z.array(selectionSchema).max(20),
  review: z.array(selectionSchema).max(20),
  repair: z.array(selectionSchema).max(20),
})
export const routingSchema = z
  .strictObject({
    version: z.literal(1),
    mode: z.enum(['manual', 'auto']),
    assignments: assignmentsSchema,
    router: selectionSchema.nullable(),
    candidates: candidatesSchema,
    fallbacks: candidatesSchema,
    limits: limitsSchema,
  })
  .superRefine((v, c) => {
    if (v.mode === 'auto' && !v.router)
      c.addIssue({ code: 'custom', message: 'Choose the router model.' })
    if (v.mode === 'auto')
      for (const role of taskRoles)
        if ((role !== 'research' || v.assignments.research) && !v.candidates[role].length)
          c.addIssue({ code: 'custom', message: `Choose eligible ${role} models.` })
  })
export type RoutingProfile = z.infer<typeof routingSchema>
export const capabilitiesSchema = z.strictObject({
  text: z.boolean(),
  structured: z.boolean(),
  research: z.boolean(),
  streaming: z.boolean(),
})
export const modelProfileSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  name: z.string().max(200),
  contextWindow: z.number().int().min(1024).max(2_000_000),
  maxOutputTokens: z.number().int().min(256).max(200_000),
  capabilities: capabilitiesSchema,
  verified: z.array(z.enum(['text', 'structured', 'research'])).default([]),
  checkedAt: z.string().datetime().optional(),
})
export type ModelProfile = z.infer<typeof modelProfileSchema>
export const connectionInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  provider: z.enum(providerKinds),
  protocol: z.enum(protocols),
  baseUrl: z.string().url().max(1000),
  key: z
    .string()
    .min(8)
    .max(8192)
    .regex(/^[!-~]+$/)
    .optional(),
})
export type ConnectionInput = z.infer<typeof connectionInputSchema>
export interface ProviderConnection {
  id: string
  label: string
  provider: (typeof providerKinds)[number]
  protocol: (typeof protocols)[number]
  baseUrl: string
  revision: number
  configured: boolean
  deleted: boolean
  models: ModelProfile[]
  updatedAt: string
}
export interface RunSnapshot {
  version: 1
  sourceRevision?: string | null
  routing: RoutingProfile
  bindings: Array<Selection & { revision: number; profile: ModelProfile }>
}
export interface Usage {
  classification: 'measured' | 'estimated' | 'unknown'
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  searchCalls?: number
}
export interface ModelResult {
  text: string
  usage: Usage
  requestId?: string
  sources: Array<{ url: string; title: string }>
}
export const providerDefaults = {
  openai: { protocol: 'responses', baseUrl: 'https://api.openai.com/v1/' },
  anthropic: { protocol: 'messages', baseUrl: 'https://api.anthropic.com/v1/' },
  deepseek: { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com/' },
  gemini: { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/' },
  groq: { protocol: 'chat-completions', baseUrl: 'https://api.groq.com/openai/v1/' },
  openrouter: { protocol: 'chat-completions', baseUrl: 'https://openrouter.ai/api/v1/' },
  ollama: { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434/api/' },
  custom: { protocol: 'chat-completions', baseUrl: '' },
} as const
export function emptyCandidates() {
  return { research: [], planning: [], coding: [], review: [], repair: [] }
}
export function singleModelRouting(selection: Selection): RoutingProfile {
  selection = { connectionId: selection.connectionId, modelId: selection.modelId }
  return {
    version: 1,
    mode: 'manual',
    assignments: {
      research: null,
      planning: selection,
      coding: selection,
      review: selection,
      repair: selection,
    },
    router: null,
    candidates: emptyCandidates(),
    fallbacks: emptyCandidates(),
    limits: {
      maxCalls: 12,
      maxRepairs: 2,
      maxOutputTokens: 8192,
      budgetMode: 'tokens',
      acknowledgeUnknownCost: true,
    },
  }
}
export function selectionsOf(profile: RoutingProfile): Selection[] {
  return [
    ...Object.values(profile.assignments),
    profile.router,
    ...Object.values(profile.candidates).flat(),
    ...Object.values(profile.fallbacks).flat(),
  ]
    .filter((s): s is Selection => s !== null)
    .filter(
      (s, i, all) =>
        all.findIndex((x) => x.connectionId === s.connectionId && x.modelId === s.modelId) === i
    )
}
