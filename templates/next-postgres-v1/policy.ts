import { canonicalHash } from '../../engine/contracts/canonical.ts'
import { commandPolicySchema, type ExecutionReviewV1 } from '../../engine/contracts/review.ts'
import { checkIds, type resourcesSchema } from '../../engine/contracts/primitives.ts'
import type { z } from 'zod'

/** Direct guest argv. These are immutable platform commands, never package scripts. */
export function templateCommandPolicy(resources: z.infer<typeof resourcesSchema>): ExecutionReviewV1['commandPolicy'] {
  return commandPolicySchema.parse({ schemaVersion: 1, resources,
    network: { internet: false, appDatabase: 'guest-loopback', maxConnections: 5 }, requiredChecks: [...checkIds],
    commands: [
      { checkId: 'source-policy', executable: 'external-harness', argv: ['source-policy'], timeoutMs: 60_000 },
      { checkId: 'dependencies', executable: 'dependency-materializer', argv: ['--offline', '--verify-integrity'], timeoutMs: 180_000 },
      { checkId: 'secrets', executable: 'scanner', argv: ['--source-only', '--redact'], timeoutMs: 60_000 },
      { checkId: 'migration-fresh', executable: 'migration-runner', argv: ['--database=fresh', '--validated-statements-only'], timeoutMs: 60_000 },
      { checkId: 'migration-prior', executable: 'migration-runner', argv: ['--database=prior-seeded', '--validated-statements-only'], timeoutMs: 60_000 },
      { checkId: 'lint', executable: 'eslint', argv: ['app', 'components', 'lib', '--max-warnings=0'], timeoutMs: 120_000 },
      { checkId: 'typecheck', executable: 'tsc', argv: ['--noEmit'], timeoutMs: 120_000 },
      { checkId: 'unit', executable: 'vitest', argv: ['run'], timeoutMs: 120_000 },
      { checkId: 'build', executable: 'next', argv: ['build', '--webpack'], timeoutMs: 240_000 },
      ...(['http', 'browser-crud', 'db-restart', 'keyboard', 'responsive'] as const).map(checkId => ({ checkId,
        executable: 'external-harness' as const, argv: [checkId, '--production-output-only'], timeoutMs: 180_000 })),
    ] })
}
export function assertTemplatePolicy(policy: ExecutionReviewV1['commandPolicy']): void {
  if (canonicalHash(policy) !== canonicalHash(templateCommandPolicy(policy.resources))) throw new Error('Unapproved template command policy')
}
