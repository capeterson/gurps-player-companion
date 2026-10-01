import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bun's "node" fallback can make Vitest exit successfully after running zero
// tests. Require actual Node so the full-suite command never passes silently.
if (process.versions.bun) {
  console.error(
    'Client tests require Node.js. Use the Compose client-tests service or run this script with Node 22.',
  );
  process.exit(1);
}

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const args = process.argv.slice(2);
const resultsDir = resolve(process.env.TEST_RESULTS_DIR ?? '.local/test-results');
mkdirSync(resultsDir, { recursive: true });
// Explicit reporter flags still allow focused diagnostics with another format.
if (!args.some((arg) => arg === '--reporter' || arg.startsWith('--reporter='))) {
  args.push(
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${resolve(resultsDir, 'client.json')}`,
  );
}
const startedAt = new Date().toISOString();
const started = performance.now();
const result = spawnSync(process.execPath, [vitest, 'run', ...args], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
writeFileSync(
  resolve(resultsDir, 'client-timing.json'),
  `${JSON.stringify({ startedAt, wallSeconds: (performance.now() - started) / 1000, exitCode: result.status, signal: result.signal }, null, 2)}\n`,
);
process.exit(result.status ?? 1);
