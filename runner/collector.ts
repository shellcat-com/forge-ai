import { createHash } from 'node:crypto'
import { canonicalHash } from '../engine/contracts/canonical.ts'
import { assertUniquePaths, sourcePath } from '../engine/contracts/paths.ts'
import { BrokerError } from './auth.ts'

export interface GuestOutput {
  path: string; kind: 'file' | 'symlink' | 'hardlink' | 'device' | 'directory'; mode: string; bytes: number
  data: AsyncIterable<Uint8Array>
}
export interface QuarantineSink {
  begin(path: string): Promise<{ write(chunk: Uint8Array): Promise<void>; finish(): Promise<string>; abort(): Promise<void> }>
}
/** Consumes framed file records through the trusted guest transport. Never opens
 * guest paths on the broker host, extracts archives, or trusts declared lengths. */
export async function collectBuildOutput(records: AsyncIterable<GuestOutput>, sink: QuarantineSink,
  signal: AbortSignal, capBytes = 1024 * 1024 * 1024) {
  if (!Number.isSafeInteger(capBytes) || capBytes < 1 || capBytes > 1024 * 1024 * 1024) throw new BrokerError('INVALID')
  const files: { path: string; bytes: number; sha256: string; objectId: string }[] = []
  let total = 0
  for await (const record of records) {
    signal.throwIfAborted()
    if (files.length >= 10000 || record.kind !== 'file' || record.mode !== '0644' || !Number.isSafeInteger(record.bytes)
      || record.bytes < 0 || record.bytes > capBytes) throw new BrokerError('INVALID')
    // Explicit output roots; .next is not an allowed source root but is an output artifact.
    if (!record.path.startsWith('build/') && !record.path.startsWith('public/')) throw new BrokerError('INVALID')
    sourcePath.parse(record.path)
    assertUniquePaths([...files.map(f => f.path), record.path])
    if (/\.(?:zip|tar|gz|tgz|7z|env)$/i.test(record.path) || /(?:^|\/)\.env(?:\.|$)/.test(record.path)) throw new BrokerError('INVALID')
    const output = await sink.begin(record.path)
    const hash = createHash('sha256'); let bytes = 0
    try {
      for await (const chunk of record.data) {
        signal.throwIfAborted(); bytes += chunk.byteLength; total += chunk.byteLength
        if (bytes > record.bytes || total > capBytes) throw new BrokerError('CAPACITY')
        hash.update(chunk); await output.write(chunk)
      }
      if (bytes !== record.bytes) throw new BrokerError('INVALID')
      files.push({ path: record.path, bytes, sha256: hash.digest('hex'), objectId: await output.finish() })
    } catch (error) { await output.abort(); throw error }
  }
  if (!files.length) throw new BrokerError('INVALID')
  return { schemaVersion: 1 as const, origin: 'untrusted-build-output' as const, files, bytes: total,
    buildOutputDigest: canonicalHash(files.map(({ objectId: _objectId, ...file }) => { void _objectId; return file })) }
}

/** General telemetry never receives guest output. Log artifacts are bounded and
 * explicit canaries/credentials are redacted even when split across frames. */
export async function collectSanitizedLog(chunks: AsyncIterable<Uint8Array>, secrets: readonly string[], capBytes: number): Promise<string> {
  if (!Number.isSafeInteger(capBytes) || capBytes < 1 || capBytes > 10 * 1024 * 1024) throw new BrokerError('INVALID')
  const parts: Uint8Array[] = []; let total = 0
  for await (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, capBytes - total)
    parts.push(chunk.slice(0, take)); total += take
    if (total === capBytes) break
  }
  // Strip controls BEFORE matching secrets, including ANSI sequences inserted inside a canary.
  // eslint-disable-next-line no-control-regex -- Sanitize hostile guest terminal sequences.
  let text = Buffer.concat(parts).toString('utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[REDACTED]')
    if (total === capBytes) {
      for (let size = Math.min(secret.length - 1, text.length); size > 0; size--) {
        if (text.endsWith(secret.slice(0, size))) { text = text.slice(0, -size) + '[REDACTED]'; break }
      }
    }
  }
  return Buffer.from(text).subarray(0, capBytes).toString('utf8')
}
