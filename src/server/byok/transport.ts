import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import { isPublicProviderAddress } from '../../../engine/providers/destination'
import { providerDefaults } from '../../shared/byok'
import type { ConnectionInput } from '../../shared/byok'
export class ByokError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly safeToRetry = false
  ) {
    super(message)
  }
}
export function validateDestination(
  input: Pick<ConnectionInput, 'provider' | 'protocol' | 'baseUrl'>,
  environment: Record<string, string | undefined> = process.env
) {
  const url = new URL(input.baseUrl)
  const privateAllowed =
    environment.FORGE_AUTH_MODE !== 'hosted' &&
    (environment.FORGE_BYOK_PRIVATE_BASE_URLS ?? '').split(',').includes(input.baseUrl)
  const localOllama =
    environment.FORGE_AUTH_MODE !== 'hosted' &&
    input.provider === 'ollama' &&
    input.baseUrl === providerDefaults.ollama.baseUrl
  if (
    input.baseUrl !== url.href ||
    !url.pathname.endsWith('/') ||
    !/^\/[a-zA-Z0-9/_-]*$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ByokError(
      'DESTINATION',
      'Use a canonical API base URL ending in / without credentials, queries or fragments.'
    )
  if (
    input.provider !== 'custom' &&
    input.provider !== 'ollama' &&
    (input.baseUrl !== providerDefaults[input.provider].baseUrl ||
      input.protocol !== providerDefaults[input.provider].protocol)
  )
    throw new ByokError(
      'DESTINATION',
      'The provider requires its official API address and protocol.'
    )
  if (input.provider === 'ollama' && input.protocol !== 'ollama')
    throw new ByokError('DESTINATION', 'Choose the Ollama protocol.')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (privateAllowed || localOllama)))
    throw new ByokError(
      'DESTINATION',
      'Public APIs require HTTPS. Private APIs require self-hosted administrator configuration.'
    )
  if (!(privateAllowed || localOllama) && (url.port || isIP(url.hostname.replace(/^\[|\]$/g, ''))))
    throw new ByokError(
      'DESTINATION',
      'Public APIs require a DNS hostname and standard HTTPS port.'
    )
  return { url, privateAllowed: privateAllowed || localOllama }
}
const resolveAddresses = (host: string) => lookup(host, { all: true, verbatim: true })
export type ModelTransport = (
  path: string,
  body: unknown | undefined,
  headers: Record<string, string>,
  signal: AbortSignal
) => Promise<Response>
export function createTransport(
  connection: Pick<ConnectionInput, 'provider' | 'protocol' | 'baseUrl'>
): ModelTransport {
  return async (path, body, headers, inputSignal) => {
    const { url: base, privateAllowed } = validateDestination(connection)
    const target = new URL(path, base)
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith(base.pathname) ||
      target.hash ||
      target.search ||
      target.username ||
      target.password
    )
      throw new ByokError('DESTINATION', 'The API operation left the configured destination.')
    const signal = AbortSignal.any([inputSignal, AbortSignal.timeout(120_000)])
    const host = base.hostname.replace(/^\[|\]$/g, '')
    const answers = await new Promise<Awaited<ReturnType<typeof resolveAddresses>>>(
      (resolve, reject) => {
        const abort = () =>
          reject(new ByokError('CANCELLED', 'Destination lookup was cancelled.', 409))
        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener('abort', abort, { once: true })
        resolveAddresses(host)
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort))
      }
    )
    signal.throwIfAborted()
    if (
      !answers.length ||
      answers.length > 32 ||
      answers.some(
        (a) =>
          isIP(a.address) !== a.family || (!privateAllowed && !isPublicProviderAddress(a.address))
      )
    )
      throw new ByokError('DESTINATION', 'The API hostname resolves to a restricted destination.')
    const address = answers[0]
    const serialized = body === undefined ? undefined : JSON.stringify(body)
    return new Promise<Response>((resolve, reject) => {
      const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        target,
        {
          method: serialized === undefined ? 'GET' : 'POST',
          agent: false,
          signal,
          servername: host,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          family: address.family,
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
          headers: {
            ...headers,
            Accept: 'application/json',
            ...(serialized
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(serialized),
                }
              : {}),
          },
        },
        (response) => {
          const status = response.statusCode ?? 502
          if (status < 200 || status >= 300) {
            response.destroy()
            resolve(
              new Response(null, {
                status,
                headers: { 'retry-after': String(response.headers['retry-after'] ?? '') },
              })
            )
            return
          }
          resolve(
            new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
              status,
              headers: { 'content-type': String(response.headers['content-type'] ?? '') },
            })
          )
        }
      )
      request.on('error', () =>
        reject(
          new ByokError(
            'NETWORK_UNKNOWN',
            'Connection interrupted; the provider may have processed this request.',
            502
          )
        )
      )
      request.setTimeout(120_000, () => request.destroy())
      request.end(serialized)
    })
  }
}
export function checkResponse(response: Response) {
  if (response.ok) return
  if ([401, 403].includes(response.status))
    throw new ByokError(
      'AUTH',
      'The provider rejected this connection. Replace the key or check model access.',
      400
    )
  if (response.status === 429)
    throw new ByokError('RATE_LIMIT', 'Provider rate limit reached. Retry later.', 429, true)
  if (response.status === 402)
    throw new ByokError('CREDITS', 'Add funds with your model provider, then retry.', 400, true)
  throw new ByokError(
    'PROVIDER',
    'The provider rejected or could not complete this operation.',
    502
  )
}
