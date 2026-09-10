import { request as httpsRequest } from 'node:https'
import { checkServerIdentity, type TLSSocket } from 'node:tls'
import { createHash, randomUUID, type KeyObject } from 'node:crypto'
import { canonicalHash } from '../contracts/canonical.ts'
import { verifyResult } from '../../runner/auth.ts'
import { brokerRequestSchema, type BrokerRequest } from '../../runner/broker.ts'

export interface RunnerTransport { send(request: BrokerRequest & { requestId: string }, signal: AbortSignal): Promise<unknown> }
/** Separate transport interface makes fixtures explicit without granting generic exec. */
export class RunnerClient {
  constructor(private readonly transport: RunnerTransport, private readonly brokerKeys: ReadonlyMap<string, KeyObject>, private readonly now = Date.now) {}
  async call(request: BrokerRequest, signal: AbortSignal): Promise<unknown> {
    const body = { ...brokerRequestSchema.parse(request), requestId: randomUUID() }
    return verifyResult(await this.transport.send(body, signal), body, this.brokerKeys, this.now())
  }
}
export function createMtlsTransport(config: { endpoint: string; ca: string; cert: string; key: string; serverCertificateSha256: string }): RunnerTransport {
  const endpoint = new URL(config.endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/v1/broker'
    || !/^[a-f0-9]{64}$/.test(config.serverCertificateSha256) || !config.ca || !config.cert || !config.key) throw new Error('Invalid fixed broker mTLS configuration')
  return { send: (body, signal) => new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body))
    if (bytes.length > 16 * 1024) { reject(new Error('Broker request too large')); return }
    const request = httpsRequest(endpoint, { method: 'POST', ca: config.ca, cert: config.cert, key: config.key,
      rejectUnauthorized: true, minVersion: 'TLSv1.3', signal: AbortSignal.any([signal, AbortSignal.timeout(250_000)]), timeout: 250_000,
      checkServerIdentity: (host, cert) => {
        const error = checkServerIdentity(host, cert)
        if (error) return error
        if (createHash('sha256').update(cert.raw).digest('hex') !== config.serverCertificateSha256) return new Error('Broker certificate mismatch')
      }, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), 'x-forge-request-digest': canonicalHash(body) } }, response => {
      if (response.statusCode !== 200 || !(response.socket as TLSSocket).authorized) { response.destroy(); reject(new Error('Broker request rejected')); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 128 * 1024) { response.destroy(new Error('Broker response too large')); return }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Invalid broker response')) } })
    })
    request.on('timeout', () => request.destroy(new Error('Broker timeout')))
    request.on('error', () => reject(new Error('Broker transport unavailable')))
    request.end(bytes)
  }) }
}
