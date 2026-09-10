import { websocket } from 'hono/bun';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp(config);

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: (request, server) => {
    // Bun owns the socket and can supply a non-forgeable peer address. Route
    // handlers only receive Fetch Requests, so carry it in a private header.
    const address = server.requestIP(request)?.address;
    if (!address) return app.fetch(request);
    const headers = new Headers(request.headers);
    headers.set('x-gpc-client-ip', address);
    return app.fetch(new Request(request, { headers }));
  },
  websocket,
});

console.log(`gurps-player-companion server listening on http://${server.hostname}:${server.port}`);
