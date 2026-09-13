import { createServer } from 'node:http'
import { createIntegrations, integrationRoute, IntegrationError } from '../server/integrations.mjs'
// Read-only development harness: no host credentials or provider calls are loaded.
const service = createIntegrations({ env: {} })
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:5179') { res.writeHead(403); res.end('{}'); return }
  try { const result = await integrationRoute(service, req.url, req.method); res.writeHead(result ? 200 : 404); res.end(JSON.stringify(result)) }
  catch (error) { res.writeHead(error instanceof IntegrationError ? error.status : 502); res.end(JSON.stringify({ error: error.message })) }
}).listen(3015, '127.0.0.1', () => console.log('Integration verification API: http://127.0.0.1:3015'))
