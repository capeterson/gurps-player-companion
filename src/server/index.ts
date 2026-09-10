import { websocket } from 'hono/bun';
import { createApp } from './app.ts';
import { type AppConfig, loadConfig } from './config.ts';

export function startServer(config: AppConfig) {
  const app = createApp(config);
  return Bun.serve({
    port: config.port,
    hostname: config.host,
    // Preserve Bun's server binding and original request for peer IP lookup
    // and WebSocket upgrades. Never carry trusted metadata in client headers.
    fetch: app.fetch,
    websocket,
  });
}

if (import.meta.main) {
  const server = startServer(loadConfig());
  console.log(
    `gurps-player-companion server listening on http://${server.hostname}:${server.port}`,
  );
}
