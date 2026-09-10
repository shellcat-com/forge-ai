import { z } from 'zod'
import { canonicalHash, sha256 } from '../engine/contracts/canonical.ts'
import { manifestSchema, type ManifestV1 } from '../engine/contracts/source.ts'
import { executionReviewSchema, type BrokerDescriptorV1, type ExecutionReviewV1 } from '../engine/contracts/review.ts'
import { validateMigrationSql } from '../engine/validation/migrations.ts'
import { templateCommandPolicy } from '../templates/next-postgres-v1/policy.ts'
import type { CheckResult, HostDriver } from './broker.ts'
import { collectBuildOutput, type GuestOutput, type QuarantineSink } from './collector.ts'
import { applyApprovedMigrations } from './app-database.ts'
import type { HostLeaseSupervisor } from './host/lifecycle.ts'
import type { FirecrackerLinuxExecutor } from './host/linux-executor.ts'
import type { GuestRpc } from './guest/protocol.ts'

type Command = ExecutionReviewV1['commandPolicy']['commands'][number]
export interface ApprovedRuntimeSource {
  manifest: ManifestV1; review: ExecutionReviewV1
  readBlob(blobId: string): Promise<Uint8Array>
}
export interface IsolatedExternalChecks {
  readonly origin: 'runner' | 'fixture'
  /** Must execute trusted checks in a DIFFERENT isolated test guest. Only this
   * bounded app capability is available; no candidate host path/URL/credentials.
   * migration-prior needs its own prior-seeded guest and approved SQL workflow. */
  run(d: BrokerDescriptorV1, command: Command, source: ApprovedRuntimeSource,
    app: { request(input: AppRequest, signal: AbortSignal): Promise<AppResponse>; restart(signal: AbortSignal): Promise<void> },
    signal: AbortSignal): Promise<CheckResult>
}
export interface AppRequest { method: string; path: string; headers: Record<string, string>; body: Uint8Array }
export interface AppResponse { status: number; headers: Record<string, string>; body: Uint8Array }
const appRequestSchema = z.strictObject({ method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  path: z.string().max(4096).regex(/^\/(?!\/)[^\r\n\0]*$/), headers: z.record(z.string(), z.string().max(8192)),
  body: z.instanceof(Uint8Array).refine(b => b.byteLength <= 256 * 1024) })
const allowedHeaders = new Set(['accept', 'content-type', 'if-none-match', 'if-modified-since', 'range', 'accept-language'])

/** Opt-in composition only. Existing service defaults remain unavailable.
 * Broker owns authentication/current E1 authority, supervisor owns durable leases,
 * helper owns OS fencing, guest owns no platform secrets. */
export class FirecrackerDriver implements HostDriver {
  readonly origin: 'fixture' | 'runner'
  constructor(private readonly supervisor: HostLeaseSupervisor, private readonly executor: FirecrackerLinuxExecutor,
    private readonly rpc: GuestRpc, private readonly source: (d: BrokerDescriptorV1) => Promise<ApprovedRuntimeSource>,
    private readonly external: IsolatedExternalChecks, private readonly sink: QuarantineSink,
    private readonly evidence: (bytes: Uint8Array) => Promise<void>) {
    this.origin = executor.origin === 'runner' && external.origin === 'runner' ? 'runner' : 'fixture'
  }
  async assertAvailable(d: BrokerDescriptorV1) { await this.executor.assertAvailable(d, AbortSignal.timeout(5000)) }
  async create(d: BrokerDescriptorV1) { await this.supervisor.create(d) }
  async renew(d: BrokerDescriptorV1) {
    // If either persistence step fails, broker quarantines and retains capacity.
    await this.supervisor.renew(d); await this.executor.renew(d, AbortSignal.timeout(5000))
  }
  async destroy(d: BrokerDescriptorV1) {
    const result = await this.supervisor.destroy(d)
    return { resourcesDestroyed: result.resourcesDestroyed, fencePersisted: result.fencePersisted }
  }
  private async call(d: BrokerDescriptorV1, action: string, input: unknown, signal: AbortSignal) {
    const binding = await this.executor.binding(d, signal)
    const result = await this.rpc.call(binding, action, input, signal)
    // Recheck host fence AFTER response. No late check/HTTP/output can escape a
    // cancellation, renewal to a newer epoch or independently expired lease.
    await this.executor.binding(d, signal)
    return result
  }
  private async approved(d: BrokerDescriptorV1) {
    const source = await this.source(d); const manifest = manifestSchema.parse(source.manifest)
    const review = executionReviewSchema.parse(source.review)
    if (canonicalHash(manifest) !== d.sourceManifestDigest || canonicalHash(review) !== d.executionReviewDigest
      || manifest.template.digest !== d.templateDigest || manifest.template.imageDigest !== d.imageDigest
      || review.candidateDigest !== d.sourceManifestDigest || manifest.commandPolicyDigest !== d.commandPolicyDigest
      || canonicalHash(review.migrations) !== canonicalHash(manifest.migrations)
      || review.migrationBundleDigest !== canonicalHash(manifest.migrations)
      || review.policyDigest !== d.commandPolicyDigest || canonicalHash(templateCommandPolicy(d.resources)) !== d.commandPolicyDigest
      || this.origin === 'runner' && manifest.provenance.origin === 'fixture') throw new Error('Unapproved source binding')
    return { ...source, manifest, review }
  }
  private async upload(d: BrokerDescriptorV1, source: ApprovedRuntimeSource, signal: AbortSignal) {
    await this.call(d, 'manifest', source.manifest, signal)
    for (const file of source.manifest.files) {
      const bytes = await source.readBlob(file.blobId)
      if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('Source blob drift')
      // Transport uses independent bounded chunks, including zero-length files.
      for (let offset = 0; offset < Math.max(1, bytes.byteLength); offset += 49152) {
        await this.call(d, 'file', { path: file.path, offset, data: Buffer.from(bytes.subarray(offset, offset + 49152)).toString('base64') }, signal)
      }
    }
    await this.call(d, 'seal', {}, signal)
  }
  async runCheck(d: BrokerDescriptorV1, command: Command, inputDigest: string): Promise<CheckResult> {
    const source = await this.approved(d)
    const expected = templateCommandPolicy(d.resources).commands.find(c => c.checkId === command.checkId)
    if (!expected || inputDigest !== d.sourceManifestDigest || command.timeoutMs > expected.timeoutMs || command.timeoutMs <= 0
      || canonicalHash({ ...command, timeoutMs: expected.timeoutMs }) !== canonicalHash(expected)) throw new Error('Unapproved command')
    const signal = AbortSignal.timeout(command.timeoutMs); const startedAt = new Date().toISOString()
    if (command.checkId === 'source-policy') await this.upload(d, source, signal)
    if (command.executable === 'external-harness' || command.executable === 'scanner' || command.checkId === 'migration-prior') {
      if (['http', 'browser-crud', 'db-restart', 'keyboard', 'responsive'].includes(command.checkId))
        await this.call(d, 'start', {}, signal)
      const result = await this.external.run(d, command, source, {
        request: (input, abort) => this.requestApp(d, input, abort),
        restart: async abort => { await this.call(d, 'restart', {}, abort) },
      }, signal)
      await this.executor.binding(d, signal)
      return result
    }
    let outcome: { exitCode: number; timedOut: boolean; oom: boolean }
    if (command.checkId === 'migration-fresh') {
      const identity = z.strictObject({ database: z.literal('forge_app'), role: z.literal('forge_migrator'),
        address: z.literal('127.0.0.1'), appDatabaseId: z.literal(d.appDatabaseId) }).parse(await this.call(d, 'database', {}, signal))
      await applyApprovedMigrations(source.review, d.appDatabaseId, async path => {
        const file = source.manifest.files.find(f => f.path === path)
        if (!file) throw new Error('Missing approved migration')
        return new TextDecoder('utf-8', { fatal: true }).decode(await source.readBlob(file.blobId))
      }, validateMigrationSql, { origin: this.origin, identity: async () => identity,
        transaction: async statements => { await this.call(d, 'migrate', { statements }, signal) } })
      outcome = { exitCode: 0, timedOut: false, oom: false }
    } else {
      outcome = z.object({ exitCode: z.number().int().min(0).max(255), timedOut: z.boolean(), oom: z.boolean() })
        .parse(await this.call(d, 'check', { checkId: command.checkId, timeoutMs: command.timeoutMs }, signal))
    }
    const finishedAt = new Date().toISOString()
    const record = { schemaVersion: 1, origin: this.origin, operationId: d.operationId, environmentId: d.environmentId,
      sourceManifestDigest: d.sourceManifestDigest, imageDigest: d.imageDigest, leaseEpoch: d.leaseEpoch,
      checkId: command.checkId, startedAt, finishedAt, ...outcome }
    const bytes = Buffer.from(JSON.stringify(record)); await this.evidence(bytes)
    return { checkId: command.checkId, startedAt, finishedAt, ...outcome, evidenceDigest: sha256(bytes) }
  }
  async health(d: BrokerDescriptorV1, signal: AbortSignal): Promise<{ processReady: boolean; databaseReady: boolean }> {
    return z.strictObject({ processReady: z.literal(true), databaseReady: z.literal(true) })
      .parse(await this.call(d, 'health', {}, AbortSignal.any([signal, AbortSignal.timeout(10_000)])))
  }
  async requestApp(d: BrokerDescriptorV1, input: AppRequest, signal: AbortSignal): Promise<AppResponse> {
    const request = appRequestSchema.parse(input)
    if (Object.keys(request.headers).length > 20 || Object.entries(request.headers).some(([k, v]) => !allowedHeaders.has(k) || /[\r\n\0]/.test(v)))
      throw new Error('Forbidden app headers')
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    const response = z.strictObject({ status: z.number().int().min(200).max(599), headers: z.record(z.string(), z.string().max(8192)),
      body: z.string().max(699052).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).parse(await this.call(d, 'http', {
      ...request, body: Buffer.from(request.body).toString('base64'),
    }, deadline))
    if (response.status >= 300 && response.status < 400 && response.status !== 304) throw new Error('App redirect rejected')
    const body = Buffer.from(response.body, 'base64')
    if (body.length > 512 * 1024) throw new Error('App response cap')
    const headers = Object.fromEntries(Object.entries(response.headers).filter(([key, value]) =>
      ['content-type', 'etag', 'last-modified', 'cache-control', 'content-range', 'accept-ranges'].includes(key) && !/[\r\n\0]/.test(value)))
    return { status: response.status, headers, body }
  }
  async collect(d: BrokerDescriptorV1) {
    const signal = AbortSignal.timeout(5000)
    const records = z.array(z.strictObject({ path: z.string(), kind: z.literal('file'), mode: z.literal('0644'),
      bytes: z.number().int().min(0).max(1024 * 1024 * 1024) })).max(10000).parse(await this.call(d, 'outputs', {}, signal))
    const call = this.call.bind(this)
    async function* stream(): AsyncIterable<GuestOutput> {
      for (const record of records) {
        yield { ...record, data: (async function* () {
          for (let offset = 0; offset < record.bytes;) {
            const frame = z.strictObject({ data: z.string().max(65536).regex(/^[A-Za-z0-9+/]*={0,2}$/) })
              .parse(await call(d, 'output-chunk', { path: record.path, offset }, signal))
            const bytes = Buffer.from(frame.data, 'base64')
            if (!bytes.length || bytes.length > 49152 || offset + bytes.length > record.bytes) throw new Error('Output framing mismatch')
            offset += bytes.length; yield bytes
          }
        })() }
      }
    }
    const result = await collectBuildOutput(stream(), this.sink, signal)
    return { buildOutputDigest: result.buildOutputDigest }
  }
}
