/** Built browser acceptance with the real notification worker on the test DB. */
import { loadConfig } from '../src/server/config.ts';
import { closeDb } from '../src/server/db/client.ts';
import {
  startNotificationMaintenance,
  stopNotificationMaintenance,
} from '../src/server/services/notificationMaintenance.ts';

const config = loadConfig();
if (config.environment !== 'test' || process.env.NODE_ENV === 'test') {
  throw new Error(
    'Built browser acceptance requires ENVIRONMENT=test and NODE_ENV other than test',
  );
}

// Import the actual build without starting its import.meta.main entrypoint.
// The source worker uses the same revision and database, with its own pool.
const { startServer, shutdownServer } = (await import(
  new URL('../dist/server/index.js', import.meta.url).href
)) as typeof import('../src/server/index.ts');
const server = startServer(config);
startNotificationMaintenance('development');
console.log(`built test server listening on http://${server.hostname}:${server.port}`);

let shuttingDown = false;
const onSignal = () => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  void Promise.all([
    shutdownServer(server, config.shutdownGraceSeconds * 1_000),
    stopNotificationMaintenance().then(closeDb),
  ]).then(
    () => process.exit(0),
    (error) => {
      console.error('built test server shutdown failed', error);
      process.exit(1);
    },
  );
};
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
