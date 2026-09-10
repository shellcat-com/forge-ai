import { randomUUID } from 'node:crypto'
import { canonicalHash, sha256 } from '../contracts/canonical.ts'
import { checkIds } from '../contracts/primitives.ts'
import { FixtureProvider } from '../testing/fakes.ts'
import { validateProviderResponse } from '../contracts/provider.ts'
import type { StageAdapter, StageInput, StageResult } from './stage-adapter.ts'
import {
  fixtureImageDigest,
  fixturePlan,
  fixturePresetDigest,
  fixtureTemplateDigest,
  policyDigest,
} from './catalog.ts'
/** No network, shell, generated-code execution, app DB or live preview. */
export class FixtureStageAdapter implements StageAdapter {
  readonly origin = 'fixture' as const
  constructor(readonly options: { delayMs?: number; repairOnce?: boolean } = {}) {}
  private repaired = false
  async run(input: StageInput, signal: AbortSignal): Promise<StageResult> {
    if (this.options.delayMs)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(new Error('Fixture aborted'))
          },
          { once: true }
        )
      })
    signal.throwIfAborted()
    if (input.stage === 'PLANNING') {
      const plan = fixturePlan(input.instruction, input.maxCostMicros)
      const provider = new FixtureProvider([
        { schemaVersion: 1, type: 'completed', origin: 'fixture', finish: 'stop', payload: plan },
      ])
      const request = {
        schemaVersion: 1 as const,
        requestId: input.operationId,
        model: 'fixture-model',
        stage: 'plan' as const,
        promptVersion: 'fixture-e1-v1',
        context: [{ role: 'user' as const, content: input.instruction }],
        outputSchemaId: 'PlanV1' as const,
        maxOutputTokens: 1000,
        deadlineAt: new Date(Date.now() + 120000).toISOString(),
      }
      const events = []
      for await (const e of provider.generate(request, signal)) events.push(e)
      return {
        schemaVersion: 1,
        origin: 'fixture',
        kind: 'plan',
        plan: validateProviderResponse(request, events).payload as typeof plan,
      }
    }
    if (input.stage === 'GENERATING' || input.stage === 'REPAIRING') {
      const blobId = randomUUID(),
        content =
          '// Explicit E1 fixture. No model generated this source and it is never executed.\n'
      return {
        schemaVersion: 1,
        origin: 'fixture',
        kind: 'candidate',
        blobs: [{ blobId, content }],
        manifest: {
          schemaVersion: 1,
          template: {
            id: 'next-postgres-v1',
            digest: fixtureTemplateDigest,
            imageDigest: fixtureImageDigest,
          },
          baseSnapshotId: input.baseSnapshotId,
          planDigest: canonicalHash(input.plan!),
          presetDigest: fixturePresetDigest,
          files: [
            {
              path: 'app/page.tsx',
              blobId,
              sha256: sha256(content),
              bytes: Buffer.byteLength(content),
              mediaType: 'text/typescript',
              mode: '0644',
            },
          ],
          migrations: [],
          commandPolicyDigest: policyDigest(input.maxCostMicros),
          provenance: {
            origin: 'fixture',
            jobId: input.jobId,
            provider: null,
            model: null,
            promptVersion: 'fixture-e1-v1',
          },
        },
      }
    }
    if (input.stage === 'PROVISIONING')
      return { schemaVersion: 1, origin: 'fixture', kind: 'provisioned', executed: false }
    if (input.stage === 'VERIFYING') {
      if (this.options.repairOnce && !this.repaired) {
        this.repaired = true
        return {
          schemaVersion: 1,
          origin: 'fixture',
          kind: 'repairable-error',
          diagnosticCode: 'FIXTURE_CHECK_FAILURE',
        }
      }
      const at = new Date().toISOString()
      return {
        schemaVersion: 1,
        origin: 'fixture',
        kind: 'verification',
        verification: {
          schemaVersion: 1,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId,
          origin: 'fixture',
          candidateDigest: canonicalHash(input.manifest!),
          templateDigest: fixtureTemplateDigest,
          imageDigest: fixtureImageDigest,
          policyDigest: policyDigest(input.maxCostMicros),
          buildOutputDigest: sha256('nonexistent E1 fixture build'),
          leaseEpoch: input.leaseEpoch,
          checks: checkIds.map((checkId) => ({
            checkId,
            startedAt: at,
            finishedAt: at,
            exitCode: 0,
            timedOut: false,
            oom: false,
            evidenceDigest: sha256(`fixture:${checkId}`),
          })),
        },
      }
    }
    if (input.stage === 'PREPARING_PREVIEW')
      return { schemaVersion: 1, origin: 'fixture', kind: 'preview', executed: false }
    throw new Error('Unsupported fixture stage')
  }
}
