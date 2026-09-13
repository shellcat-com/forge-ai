/** Protected loader. Only the disposable guest database credential is accepted. */
export function appDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('Guest database configuration unavailable')
  const url = new URL(value)
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5432' || url.pathname !== '/forge_app'
    || url.username !== 'forge_app' || !url.password || url.search || url.hash) throw new Error('Invalid guest database configuration')
  return url.toString()
}
