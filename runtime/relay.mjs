import { createServer, connect } from 'node:net';
const target = process.argv[2];
if (!/^forge-run-[a-f0-9-]{36}$/.test(target)) throw new Error('Invalid relay destination');
const server = createServer(client => {
  const upstream = connect({ host: target, port: 3000 });
  client.setTimeout(30000, () => client.destroy()); upstream.setTimeout(30000, () => upstream.destroy());
  client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
  client.pipe(upstream); upstream.pipe(client);
});
server.maxConnections = 32; server.listen(3000, '0.0.0.0');
