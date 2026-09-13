/// <reference types="vite/client" />
if (import.meta.env.VITE_FORGE_AUTH_ENABLED === 'true') {
  import('./cloud/main.ts')
} else {
  import('./main.ts')
}
