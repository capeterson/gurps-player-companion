import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');
const HOLD_OPEN_FIXTURE = resolve(import.meta.dir, 'holdMaintenanceWakeWindow.test-fixture.ts');
const DATABASE_URL = 'postgres://openapi-test:unreachable@127.0.0.1:1/openapi-test';
const JWT_SECRET = 'openapi-test-secret-which-is-deliberately-long-and-not-a-placeholder';
const PROCESS_TIMEOUT_MS = 15_000;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

async function runOpenApiCommand(entrypoint: 'check.ts' | 'emit.ts'): Promise<CommandResult> {
  const child = Bun.spawn(
    [process.execPath, 'run', `--preload=${HOLD_OPEN_FIXTURE}`, `src/server/openapi/${entrypoint}`],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ENVIRONMENT: 'development',
        NODE_ENV: '',
        DATABASE_URL,
        JWT_SECRET,
        CORS_ORIGINS: '[]',
        MEDIA_STORAGE: 'local',
        MEDIA_LOCAL_DIR: '/tmp/gpc-openapi-command-test-media',
        MEDIA_UPLOADS_ENABLED: 'true',
        MEDIA_S3_ENDPOINT: '',
        MEDIA_S3_BUCKET: '',
        MEDIA_S3_ACCESS_KEY: '',
        MEDIA_S3_SECRET_KEY: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  // Drain both pipes immediately. The emit command writes the full OpenAPI
  // document, which could otherwise fill the child-process output buffer.
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    new Promise<{ exitCode: number; timedOut: boolean }>((resolve) => {
      timeout = setTimeout(() => resolve({ exitCode: -1, timedOut: true }), PROCESS_TIMEOUT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (outcome.timedOut) {
    child.kill();
    await child.exited;
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { ...outcome, stdout, stderr };
}

describe('OpenAPI CLI lifecycle', () => {
  it('checks and emits the snapshot without starting maintenance workers', async () => {
    const commands = [
      {
        entrypoint: 'check.ts' as const,
        expectedStdout: 'OpenAPI: docs/openapi.json is in sync.\n',
      },
      {
        entrypoint: 'emit.ts' as const,
        expectedStdout: readFileSync(resolve(ROOT, 'docs/openapi.json'), 'utf8'),
      },
    ];

    // Both read-only commands retain their full maintenance observation window.
    const results = await Promise.all(
      commands.map((command) => runOpenApiCommand(command.entrypoint)),
    );
    for (const [index, command] of commands.entries()) {
      const result = results[index];
      if (!result) throw new Error(`Missing ${command.entrypoint} result`);
      expect(result.timedOut, `${command.entrypoint} exceeded its process deadline`).toBe(false);
      expect(result.exitCode, `${command.entrypoint} exit status`).toBe(0);
      expect(result.stdout, `${command.entrypoint} output`).toBe(command.expectedStdout);
      expect(result.stderr, `${command.entrypoint} stderr`).toBe('');
    }
  }, 35_000);
});
