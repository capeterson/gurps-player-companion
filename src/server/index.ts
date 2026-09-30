import { websocket } from 'hono/bun';
import { createApp } from './app.ts';
import { type AppConfig, loadConfig } from './config.ts';
import { closeDb } from './db/client.ts';
import { beginDraining } from './lifecycle.ts';
import { stopMediaMaintenance } from './services/media/maintenance.ts';
import { stopNotificationMaintenance } from './services/notificationMaintenance.ts';
import { stopUserPurgeMaintenance } from './services/userPurge.ts';
import { closeAll as closeAllWebSockets } from './services/wsBus.ts';

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

interface StoppableServer {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

export interface ShutdownDeps {
  closeWebSockets?: () => number;
  stopBackgroundWork?: () => Promise<void>;
  closeDatabase?: () => Promise<void>;
}

async function stopBackgroundMaintenance(): Promise<void> {
  await Promise.all([
    stopMediaMaintenance(),
    stopUserPurgeMaintenance(),
    stopNotificationMaintenance(),
  ]);
}

/**
 * Drain and stop the server. Stops accepting connections, closes push
 * sockets so clients reconnect to the replacement, then waits up to
 * `graceMs` for in-flight requests (sync batches, media processing) and the
 * background maintenance before force-closing whatever remains. Clients
 * recover anything cut off at the deadline through the outbox, but a normal
 * deploy should not need to.
 */
export async function shutdownServer(
  server: StoppableServer,
  graceMs: number,
  deps: ShutdownDeps = {},
): Promise<'drained' | 'forced'> {
  const {
    closeWebSockets = closeAllWebSockets,
    stopBackgroundWork = stopBackgroundMaintenance,
    closeDatabase = closeDb,
  } = deps;
  beginDraining();
  const deadline = Date.now() + graceMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const timeout = (ms: number) =>
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms));

  closeWebSockets();
  const drained = Promise.all([
    Promise.resolve(server.stop(false)),
    stopBackgroundWork().catch(() => undefined),
  ]).then(() => 'drained' as const);
  const result = await Promise.race([drained, timeout(remaining())]);
  if (result === 'timeout') await server.stop(true);
  await closeDatabase().catch(() => undefined);
  return result === 'timeout' ? 'forced' : 'drained';
}

if (import.meta.main) {
  const config = loadConfig();
  const server = startServer(config);
  console.log(
    `gurps-player-companion server listening on http://${server.hostname}:${server.port}`,
  );
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      // A second signal means the operator does not want to wait.
      console.warn(`received ${signal} again; exiting immediately`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(
      `received ${signal}; draining for up to ${config.shutdownGraceSeconds}s (${server.pendingRequests} in-flight requests)`,
    );
    void shutdownServer(server, config.shutdownGraceSeconds * 1000).then(
      (result) => {
        console.log(
          result === 'drained'
            ? 'shutdown complete'
            : 'shutdown grace period elapsed; remaining connections closed',
        );
        process.exit(0);
      },
      (error) => {
        console.error('shutdown failed', error);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
