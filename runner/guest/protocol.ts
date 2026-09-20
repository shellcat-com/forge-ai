import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createConnection } from 'node:net'
import { canonicalHash, canonicalJson } from '../../engine/contracts/canonical.ts'
import type { BrokerDescriptorV1 } from '../../engine/contracts/review.ts'

export const RPC_PORT = 4100
export const RPC_MAX_BYTES = 1024 * 1024
export interface RpcBinding { descriptor: BrokerDescriptorV1; attemptId: string; key: Buffer; socketPath: string }
export interface GuestTransport {
  exchange(socketPath: string, payload: Uint8Array, signal: AbortSignal): Promise<Uint8Array>
}
/** Firecracker's host-initiated vsock handshake. No TCP fallback or caller URL. */
export class VsockTransport implements GuestTransport {
  exchange(socketPath: string, payload: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted()
    if (payload.byteLength > RPC_MAX_BYTES) throw new Error('RPC request cap')
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: socketPath }); let buffer = Buffer.alloc(0); let connected = false
      let expected: number | undefined; let settled = false
      const finish = (error?: Error, result?: Buffer) => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', abort); socket.destroy()
        if (error) reject(error); else resolve(result!)
      }
      const abort = () => finish(new Error('RPC aborted'))
      signal.addEventListener('abort', abort, { once: true })
      socket.setTimeout(240_000, () => finish(new Error('RPC deadline')))
      socket.on('error', () => finish(new Error('Guest transport unavailable')))
      socket.on('end', () => finish(new Error('Truncated RPC')))
      socket.on('connect', () => socket.write(`CONNECT ${RPC_PORT}\n`))
      socket.on('data', chunk => {
        if (buffer.length + chunk.length > RPC_MAX_BYTES + 128) return finish(new Error('RPC response cap'))
        buffer = Buffer.concat([buffer, chunk])
        if (!connected) {
          const end = buffer.indexOf(10)
          if (end < 0) { if (buffer.length > 100) finish(new Error('Invalid vsock handshake')); return }
          if (!/^OK [0-9]+$/.test(buffer.subarray(0, end).toString())) return finish(new Error('Invalid vsock handshake'))
          connected = true; buffer = buffer.subarray(end + 1)
          const header = Buffer.alloc(4); header.writeUInt32BE(payload.byteLength)
          socket.write(Buffer.concat([header, Buffer.from(payload)]))
        }
        if (expected === undefined && buffer.length >= 4) {
          expected = buffer.readUInt32BE(); buffer = buffer.subarray(4)
          if (expected < 2 || expected > RPC_MAX_BYTES) return finish(new Error('RPC frame cap'))
        }
        if (expected !== undefined && buffer.length >= expected) {
          if (buffer.length !== expected) return finish(new Error('RPC trailing bytes'))
          finish(undefined, buffer)
        }
      })
    })
  }
}
export function rpcMac(key: Buffer, value: unknown) {
  return createHmac('sha256', key).update(canonicalJson(value)).digest('hex')
}
/** Per-launch secret authenticates a single vsock endpoint. This is transport
 * authenticity, not proof that code inside a guest behaved correctly. */
export class GuestRpc {
  constructor(private readonly transport: GuestTransport = new VsockTransport()) {}
  async call(binding: RpcBinding, action: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    if (binding.key.length !== 32) throw new Error('Invalid RPC key')
    const d = binding.descriptor
    const subject = { schemaVersion: 1, requestId: randomUUID(), operationId: d.operationId,
      attemptId: binding.attemptId, sourceManifestDigest: d.sourceManifestDigest, imageDigest: d.imageDigest,
      leaseEpoch: d.leaseEpoch, expiresAt: d.expiresAt, action, input }
    const payload = Buffer.from(canonicalJson({ ...subject, mac: rpcMac(binding.key, subject) }))
    const bytes = await this.transport.exchange(binding.socketPath, payload, signal)
    if (bytes.byteLength > RPC_MAX_BYTES) throw new Error('RPC response cap')
    const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>
    const { mac, ...body } = response
    if (typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)
      || !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(rpcMac(binding.key, body), 'hex')))
      throw new Error('Unauthenticated guest response')
    if (body.requestDigest !== canonicalHash(subject) || body.requestId !== subject.requestId || body.ok !== true)
      throw new Error('Guest operation failed or mismatched')
    return body.output
  }
}
