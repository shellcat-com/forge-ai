import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { checkIds, networkSchema, resourcesSchema } from '../contracts/primitives.ts'
import { commandPolicySchema } from '../contracts/review.ts'
import { planSchema } from '../contracts/source.ts'
export const fixtureTemplateDigest = sha256(
  'explicit E1 synthetic template; no released Next.js image'
)
export const fixtureImageDigest = `sha256:${sha256('explicit E1 nonexistent image; never launched')}`
export const fixturePresetDigest = sha256('fixture design only')
export const fixturePolicy = (maxCostMicros: number) =>
  commandPolicySchema.parse({
    schemaVersion: 1,
    commands: checkIds.map((checkId) => ({
      checkId,
      executable: 'external-harness',
      argv: ['fixture-only'],
      timeoutMs: 60000,
    })),
    requiredChecks: [...checkIds],
    network: networkSchema.parse({
      internet: false,
      appDatabase: 'guest-loopback',
      maxConnections: 5,
    }),
    resources: resourcesSchema.parse({
      cpu: 2,
      memoryMiB: 4096,
      processes: 512,
      diskMiB: 8192,
      logBytes: 10485760,
      activeMs: 1200000,
      verificationMs: 600000,
      maxCostMicros,
    }),
  })
export const fixturePlan = (brief: string, maxCostMicros: number) => {
  const policy = fixturePolicy(maxCostMicros)
  return planSchema.parse({
    schemaVersion: 1,
    briefHash: sha256(brief),
    templateDigest: fixtureTemplateDigest,
    presetDigest: fixturePresetDigest,
    userStories: ['Synthetic task-board fixture; no application generated'],
    routes: [{ path: '/', purpose: 'Fixture' }],
    dataEntities: [],
    apiOperations: [],
    fileTasks: [{ path: 'app/page.tsx', instruction: 'Use deterministic fixture source' }],
    migrationIntent: [],
    requiredChecks: [...checkIds],
    unsupportedRequirements: ['E1 does not generate or execute applications'],
    assumptions: ['Synthetic testing only'],
    resources: policy.resources,
    network: policy.network,
  })
}
export const policyDigest = (cap: number) => canonicalHash(fixturePolicy(cap))

/** Trusted server configuration only; candidate mode remains zero-cost fixture. */
export interface ControlCatalog {
  readonly name: 'e1-fixture' | 'e2-candidate-fixture'
  readonly templateDigest: string
  readonly imageDigest: string
  readonly presetDigest: string
  policy(maxCostMicros: number): ReturnType<typeof fixturePolicy>
  assertProject(presetId: string, presetVersion: number): void
}
export const defaultControlCatalog: ControlCatalog = Object.freeze({
  name: 'e1-fixture',
  templateDigest: fixtureTemplateDigest,
  imageDigest: fixtureImageDigest,
  presetDigest: fixturePresetDigest,
  policy: fixturePolicy,
  assertProject: () => undefined,
})
