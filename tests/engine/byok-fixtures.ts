/** Explicit synthetic configuration. No key, entitlement, budget or live proof. */
import { randomUUID } from 'node:crypto'
import type { GenerationRequest } from '../../engine/contracts/provider.ts'
import type { ProviderPolicy } from '../../engine/providers/registry.ts'
export const byokPolicy: ProviderPolicy = {
  id: 'openai',
  protocol: 'chat-completions-json-v1',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4.1-2025-04-14',
  contextWindow: 1047576,
  maxOutputTokens: 32768,
  tokenBound: 'utf8-plus-chat-framing-v1',
  framingTokensPerMessage: 32,
  framingTokensPerRequest: 256,
  price: {
    version: 'synthetic-not-authorized-v1',
    currency: 'USD',
    inputMicrosPerMillion: 2000000,
    outputMicrosPerMillion: 8000000,
    validFrom: '2026-01-01T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
  },
  acceptance: 'contract-tested',
  evidenceDigest: 'a'.repeat(64),
}
export const byokRequest = (): GenerationRequest => ({
  schemaVersion: 1,
  requestId: randomUUID(),
  model: byokPolicy.model,
  stage: 'plan',
  promptVersion: 'synthetic-v1',
  context: [{ role: 'user', content: 'Return JSON for a synthetic plan.' }],
  outputSchemaId: 'PlanV1',
  maxOutputTokens: 4000,
  deadlineAt: new Date(Date.now() + 60000).toISOString(),
})
export const byokBinding = () => ({
  workspaceId: randomUUID(),
  projectId: randomUUID(),
  jobId: randomUUID(),
  stepId: randomUUID(),
  leaseEpoch: 1,
  credentialId: randomUUID(),
  credentialRevision: 1,
  repairNumber: 0,
})
