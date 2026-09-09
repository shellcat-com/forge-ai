/** Only workspace paths may be used as post-authentication destinations. */
export function authReturn(value: string | null): string {
  if (
    !value ||
    !/^\/app(?:\/|\?|$)/.test(value) ||
    [...value].some((c) => c.charCodeAt(0) < 32) ||
    value.includes('\\')
  )
    return '/app'
  try {
    const parsed = new URL(value, 'https://forge.invalid')
    return parsed.origin === 'https://forge.invalid' && /^\/app(?:\/|$)/.test(parsed.pathname)
      ? parsed.pathname + parsed.search
      : '/app'
  } catch {
    return '/app'
  }
}
