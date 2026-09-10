import type { BrokerDescriptorV1 } from '../contracts/review.ts'
import type { HostInventory } from '../../runner/host/inventory.ts'
import type { PreviewGrant } from './control.ts'
import type { PreviewRuntime, RuntimeRequest, RuntimeResponse } from './gateway.ts'

/** Structural port implemented by Task 02 FirecrackerDriver.requestApp. The
 * gateway cannot manufacture a descriptor or open an arbitrary network URL. */
export interface AppDriver {
  health(
    descriptor: BrokerDescriptorV1,
    signal: AbortSignal
  ): Promise<{ processReady: boolean; databaseReady: boolean }>
  requestApp(
    descriptor: BrokerDescriptorV1,
    input: RuntimeRequest,
    signal: AbortSignal
  ): Promise<RuntimeResponse>
}
/** Lives with the authenticated runner supervisor, whose inventory is populated
 * only after signed broker admission. A remote gateway must reach this object via
 * workload-authenticated transport; never publish this method as an open route. */
export class HostPreviewRuntime implements PreviewRuntime {
  constructor(
    private readonly inventory: HostInventory,
    private readonly driver: AppDriver,
    private readonly releasedImages: ReadonlyMap<string, string>,
    private readonly now = Date.now
  ) {}
  private resolve(grant: PreviewGrant) {
    return this.inventory.transaction((state) => {
      const record = state.records[grant.operationId],
        d = record?.descriptor
      if (
        !record ||
        !d ||
        record.state !== 'running' ||
        record.tombstone ||
        record.ingressRevoked ||
        record.launchUncertain ||
        !record.resourcesReserved ||
        state.lastObservedAt > this.now() ||
        d.kind !== 'preview' ||
        Date.parse(d.expiresAt) <= this.now() ||
        Date.parse(d.issuedAt) > this.now() ||
        d.operationId !== grant.operationId ||
        d.environmentId !== grant.environmentId ||
        d.leaseEpoch !== grant.leaseEpoch ||
        d.workspaceId !== grant.workspaceId ||
        d.projectId !== grant.projectId ||
        d.jobId !== grant.jobId ||
        d.sourceManifestDigest !== grant.sourceManifestDigest ||
        d.templateDigest !== grant.templateDigest ||
        this.releasedImages.get(d.templateDigest) !== d.imageDigest
      )
        throw new Error('PREVIEW_RUNTIME_UNAVAILABLE')
      return d
    })
  }
  async request(grant: PreviewGrant, input: RuntimeRequest, signal: AbortSignal) {
    signal.throwIfAborted()
    const descriptor = await this.resolve(grant)
    // Task 02 executes SELECT 1 as the app-local role and fixed HTTP health,
    // rechecking the host binding after authenticated RPC. HTTP 200 alone is insufficient.
    const health = await this.driver.health(descriptor, signal)
    if (health.processReady !== true || health.databaseReady !== true)
      throw new Error('PREVIEW_RUNTIME_UNHEALTHY')
    const headers = Object.fromEntries(
      Object.entries(input.headers).filter(([name]) =>
        [
          'accept',
          'content-type',
          'if-none-match',
          'if-modified-since',
          'range',
          'accept-language',
        ].includes(name)
      )
    )
    const result = await this.driver.requestApp(descriptor, { ...input, headers }, signal)
    await this.resolve(grant)
    signal.throwIfAborted()
    return result
  }
}
