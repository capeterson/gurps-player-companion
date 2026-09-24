import { spawnSync } from 'node:child_process';
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
const result = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
