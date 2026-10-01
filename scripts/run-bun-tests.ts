import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Native JUnit contains case durations. The separate timing record measures
// command wall time, including imports and hooks, rather than summing cases.
const [suite, ...testArgs] = process.argv.slice(2);
if (!suite || !/^[a-z][a-z0-9-]*$/.test(suite) || testArgs.length === 0) {
  throw new Error(
    'Usage: bun run scripts/run-bun-tests.ts <suite-name> <test-paths> [bun test flags]',
  );
}
const resultsDir = resolve(process.env.TEST_RESULTS_DIR ?? '.local/test-results');
await mkdir(resultsDir, { recursive: true });
const junitPath = resolve(resultsDir, `${suite}.xml`);
const startedAt = new Date().toISOString();
const started = performance.now();
const child = Bun.spawn(
  [process.execPath, 'test', ...testArgs, '--reporter=junit', `--reporter-outfile=${junitPath}`],
  { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
);
const exitCode = await child.exited;
await writeFile(
  resolve(resultsDir, `${suite}-timing.json`),
  `${JSON.stringify({ suite, testArgs, startedAt, wallSeconds: (performance.now() - started) / 1000, exitCode, junitPath }, null, 2)}\n`,
);
process.exit(exitCode);
