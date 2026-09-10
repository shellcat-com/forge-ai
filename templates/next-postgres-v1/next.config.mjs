import { fileURLToPath, URL } from 'node:url'

// Protected platform configuration: no remote asset fetching or bypass flags.
export default {
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  images: { unoptimized: true, remotePatterns: [] },
  productionBrowserSourceMaps: false,
  experimental: { cpus: 2 },
}
