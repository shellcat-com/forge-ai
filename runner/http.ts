import type { IncomingMessage, ServerResponse } from 'node:http'
import { TLSSocket } from 'node:tls'
import { createHash, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { brokerRequestSchema, type SandboxBroker } from './broker.ts'
import { BrokerError, signResult } from './auth.ts'

/** Mount ONLY on https.createServer({ requestCert:true, rejectUnauthorized:true,
 * ca: approvedWorkerCA, minVersion:'TLSv1.3' }). No listener is enabled by import. */
export function brokerHttpHandler(broker: SandboxBroker, signing: { keyId: string; key: KeyObject }, now = Date.now) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const bodyDeadline = setTimeout(() => request.destroy(new Error('Broker request deadline')), 10_000)
    try {
      if (!(request.socket instanceof TLSSocket) || !request.socket.authorized || request.method !== 'POST'
        || request.url !== '/v1/broker' || request.headers['content-type'] !== 'application/json') throw new BrokerError('UNAUTHORIZED')
      const certificate = request.socket.getPeerCertificate()
      if (!certificate.raw) throw new BrokerError('UNAUTHORIZED')
      const chunks: Buffer[] = []; let count = 0
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk as Uint8Array); count += bytes.length
        if (count > 16 * 1024) throw new BrokerError('INVALID')
        chunks.push(bytes)
      }
      clearTimeout(bodyDeadline)
      const body = brokerRequestSchema.extend({ requestId: z.uuid() }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const { requestId: _requestId, ...operation } = body; void _requestId
      const result = await broker.dispatch({ authorized: true, certificateSha256: createHash('sha256').update(certificate.raw).digest('hex') }, operation)
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(signResult(body, result, signing.keyId, signing.key, now())))
    } catch (error) {
      const code = error instanceof BrokerError ? error.code : 'INVALID'
      response.writeHead(code === 'UNAUTHORIZED' ? 403 : code === 'UNAVAILABLE' ? 503 : 409, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ code }))
    } finally { clearTimeout(bodyDeadline) }
  }
}
