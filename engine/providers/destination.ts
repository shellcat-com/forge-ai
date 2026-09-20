import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6')
/** Fail closed on mapped, transition, reserved, scoped, metadata and non-global IPs. */
export function isPublicProviderAddress(address: string): boolean {
  if (address.includes('%')) return false
  const family = isIP(address)
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
export type ResolveProviderHost = (
  host: string
) => Promise<readonly { address: string; family: number }[]>
export function providerDestination(endpoint: string, approved: readonly string[]): URL {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('PROVIDER_DESTINATION_DENIED')
  }
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    endpoint !== url.href ||
    !approved.includes(endpoint) ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(url.hostname) ||
    url.pathname !== '/v1/chat/completions'
  )
    throw new Error('PROVIDER_DESTINATION_DENIED')
  return url
}
export async function resolveProviderDestination(
  endpoint: string,
  approved: readonly string[],
  resolve: ResolveProviderHost = (host) => lookup(host, { all: true, verbatim: true })
) {
  const url = providerDestination(endpoint, approved)
  let addresses: Awaited<ReturnType<ResolveProviderHost>>
  try {
    addresses = await resolve(url.hostname)
  } catch {
    throw new Error('PROVIDER_DESTINATION_UNAVAILABLE')
  }
  if (
    !addresses.length ||
    addresses.length > 32 ||
    addresses.some((a) => !isPublicProviderAddress(a.address) || isIP(a.address) !== a.family)
  )
    throw new Error('PROVIDER_DESTINATION_DENIED')
  return { url, address: addresses[0] }
}
/** Dedicated server transport: no proxy env, connection reuse, alternate DNS lookup,
 * redirects, caller headers or URL overrides. TLS checks the original hostname. */
export function pinnedProviderFetch(approved: readonly string[]): typeof globalThis.fetch {
  const endpoints = [...approved]
  return async (input, init) => {
    if (
      typeof input !== 'string' ||
      init?.method !== 'POST' ||
      init.redirect !== 'error' ||
      typeof init.body !== 'string' ||
      !init.signal
    )
      throw new Error('PROVIDER_TRANSPORT_DENIED')
    const signal = init.signal
    signal.throwIfAborted()
    const target = await resolveProviderDestination(input, endpoints)
    signal.throwIfAborted()
    const headers = new Headers(init.headers)
    const authorization = headers.get('authorization')
    if (!authorization || !/^Bearer [!-~]{1,8192}$/.test(authorization))
      throw new Error('PROVIDER_AUTH')
    return new Promise<Response>((resolve, reject) => {
      const fail = () => reject(new Error('PROVIDER_TRANSPORT_UNAVAILABLE'))
      const req = httpsRequest(
        target.url,
        {
          method: 'POST',
          agent: false,
          signal,
          servername: target.url.hostname,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          // Pin the validated address into this connection, keeping Host/SNI intact.
          lookup: (_host, _options, callback) =>
            callback(null, target.address.address, target.address.family),
          family: target.address.family,
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(init.body as string),
          },
        },
        (res) => {
          const status = res.statusCode ?? 502
          if (status < 200 || status >= 300) {
            res.destroy()
            resolve(new Response(null, { status: status >= 300 && status < 400 ? 502 : status }))
            return
          }
          const chunks: Buffer[] = []
          let bytes = 0
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 8 * 1024 * 1024) {
              res.destroy()
              fail()
            } else chunks.push(chunk)
          })
          res.on('error', fail)
          res.on('aborted', fail)
          res.on('end', () =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status,
                headers: { 'content-type': String(res.headers['content-type'] ?? '') },
              })
            )
          )
        }
      )
      req.on('error', fail)
      req.setTimeout(120_000, () => req.destroy())
      req.end(init.body)
    })
  }
}
