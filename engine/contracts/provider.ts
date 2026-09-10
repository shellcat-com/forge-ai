import { z } from 'zod'
import { boundedJson, label, limits, positive, timestamp, uint, uuid, utf8Bytes, version } from './primitives.ts'
import { fileBatchSchema, planSchema } from './source.ts'

export const modelDescriptorSchema = z.strictObject({ schemaVersion: version, id: label,
  capabilities: z.strictObject({ streaming: z.boolean(), structuredOutput: z.boolean(), toolCalls: z.boolean() }),
  maxInputTokens: positive, maxOutputTokens: positive })
export const credentialStatusSchema = z.strictObject({ schemaVersion: version, configured: z.boolean(), verified: z.boolean(),
  checkedAt: timestamp, errorCode: z.enum(['AUTH', 'UNAVAILABLE', 'RATE_LIMIT']).optional(),
}).refine(s => !s.verified || (s.configured && !s.errorCode), 'Invalid credential status')
export const generationRequestSchema = boundedJson(z.strictObject({ schemaVersion: version, requestId: uuid,
  model: label, stage: z.enum(['plan', 'files', 'repair']), promptVersion: label,
  context: z.array(z.strictObject({ role: z.enum(['system', 'user']), content: z.string().min(1).max(64 * 1024) })).min(1).max(30),
  outputSchemaId: z.enum(['PlanV1', 'FileBatchV1']), maxOutputTokens: positive, deadlineAt: timestamp,
}).refine(r => (r.stage === 'plan') === (r.outputSchemaId === 'PlanV1'), 'Stage/output mismatch'), 256 * 1024)
export const usageSchema = z.strictObject({ inputTokens: uint.optional(), outputTokens: uint.optional(),
  requestId: label.optional(), classification: z.enum(['measured', 'estimated', 'uncertain']) })
export const generationEventSchema = boundedJson(z.discriminatedUnion('type', [
  z.strictObject({ schemaVersion: version, type: z.literal('text.delta'), text: z.string().min(1).max(64 * 1024) }),
  z.strictObject({ schemaVersion: version, type: z.literal('tool.proposal'), name: label, arguments: z.json() }),
  z.strictObject({ schemaVersion: version, type: z.literal('usage'), usage: usageSchema }),
  z.strictObject({ schemaVersion: version, type: z.literal('completed'), finish: z.enum(['stop', 'length', 'refusal']),
    requestId: label.optional(), origin: z.enum(['provider', 'fixture']), payload: z.union([planSchema, fileBatchSchema]).optional() }),
  z.strictObject({ schemaVersion: version, type: z.literal('error'), code: z.enum(['AUTH', 'RATE_LIMIT', 'TIMEOUT', 'UNAVAILABLE', 'INVALID_OUTPUT', 'CANCELLED', 'UNSUPPORTED_TOOL']), retryable: z.boolean() }),
]), limits.batchBytes)
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>
export type CredentialStatus = z.infer<typeof credentialStatusSchema>
export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type GenerationEvent = z.infer<typeof generationEventSchema>
export interface ProviderAdapter {
  readonly id: string
  listModels(signal: AbortSignal): Promise<ModelDescriptor[]>
  validateCredentials(signal: AbortSignal): Promise<CredentialStatus>
  generate(request: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent>
}
/** Contract-only completed-product reducer; no scheduling or tool dispatch. */
export function validateProviderResponse(requestInput: unknown, inputs: unknown[]) {
  const request = generationRequestSchema.parse(requestInput)
  let text = ''
  let completed: Extract<GenerationEvent, { type: 'completed' }> | undefined
  if (inputs.length > 4096) throw new Error('Provider event cap')
  for (const input of inputs) {
    const event = generationEventSchema.parse(input)
    if (completed) throw new Error('Event after completion')
    if (event.type === 'error') throw new Error(event.code)
    if (event.type === 'tool.proposal') throw new Error('UNSUPPORTED_TOOL')
    if (event.type === 'text.delta') {
      text += event.text
      if (utf8Bytes(text) > (request.stage === 'plan' ? limits.planBytes : limits.batchBytes)) throw new Error('Provider output cap')
    }
    if (event.type === 'completed') completed = event
  }
  if (!completed || completed.finish !== 'stop' || (text.length > 0 && completed.payload !== undefined)) throw new Error('Incomplete, ambiguous or refused output')
  const value: unknown = completed.payload ?? JSON.parse(text)
  const payload = (request.outputSchemaId === 'PlanV1' ? planSchema : fileBatchSchema).parse(value)
  return { schemaVersion: 1 as const, origin: completed.origin, payload }
}
