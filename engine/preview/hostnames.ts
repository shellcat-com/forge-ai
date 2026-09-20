/** Deliberately narrow v1 provider adapter, not a home-grown public-suffix parser.
 * PSL and real Chromium evidence cover sibling one-label vercel.app domains.
 * Other arrangements require a separately reviewed/tested site adapter. */
export function validateDefaultHostnameBoundary(forgeOrigin: string, previewHostname: string) {
  const forge = new URL(forgeOrigin)
  const issued = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/
  if (
    forge.protocol !== 'https:' ||
    forge.origin !== forgeOrigin ||
    forge.port ||
    !issued.test(forge.hostname) ||
    !issued.test(previewHostname) ||
    forge.hostname === previewHostname
  )
    throw new Error('UNVERIFIED_PREVIEW_SITE_BOUNDARY')
}
