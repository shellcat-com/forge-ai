import { createHash } from 'node:crypto'
import { wellFormed } from './primitives.ts'

/** Forge canonical JSON v1: sorted UTF-16 keys, unchanged arrays/Unicode,
 * JSON string escaping, safe integers only, -0 becomes 0. No toJSON coercion. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>()
  function encode(v: unknown, depth: number): string {
    if (depth > 64) throw new Error('Canonical JSON nesting limit')
    if (v === null) return 'null'
    if (typeof v === 'boolean') return String(v)
    if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v === 0 ? 0 : v)
    if (typeof v === 'string' && wellFormed(v)) return JSON.stringify(v)
    if (typeof v !== 'object' || v === null || seen.has(v)) throw new Error('Noncanonical JSON value')
    seen.add(v)
    let result: string
    if (Array.isArray(v)) {
      if (Reflect.ownKeys(v).length !== v.length + 1) throw new Error('Sparse or decorated array')
      const items: string[] = []
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i))
        if (!d || !d.enumerable || !('value' in d)) throw new Error('Sparse/accessor array')
        items.push(encode(d.value, depth + 1))
      }
      result = '[' + items.join(',') + ']'
    } else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
        throw new Error('Only plain JSON objects are supported')
      const keys = Reflect.ownKeys(v)
      if (keys.some(key => typeof key !== 'string' || !wellFormed(key))) throw new Error('Invalid JSON key')
      result = '{' + (keys as string[]).sort().map(key => {
        const d = Object.getOwnPropertyDescriptor(v, key)!
        if (!d.enumerable || !('value' in d)) throw new Error('Accessors are not JSON')
        return JSON.stringify(key) + ':' + encode(d.value, depth + 1)
      }).join(',') + '}'
    }
    seen.delete(v)
    return result
  }
  return encode(value, 0)
}
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export const canonicalHash = (value: unknown): string => sha256(canonicalJson(value))
