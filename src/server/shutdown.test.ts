import { afterEach, describe, expect, it } from 'bun:test';
import { shutdownServer } from './index.ts';
import { _resetDrainingForTests, isDraining } from './lifecycle.ts';

afterEach(() => {
  _resetDrainingForTests();
});

function slowServer(delayMs: number) {
  return Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      if (new URL(request.url).pathname === '/slow') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return new Response('finished');
      }
      return new Response('fast');
    },
  });
}

const noDeps = () => {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      closeWebSockets: () => {
        calls.push('websockets');
        return 0;
      },
      stopBackgroundWork: async () => {
        calls.push('background');
      },
      closeDatabase: async () => {
        calls.push('database');
      },
    },
  };
};

describe('graceful shutdown', () => {
  it('lets in-flight requests finish while refusing new connections', async () => {
    const server = slowServer(300);
    const url = new URL('/slow', server.url);
    const inFlight = fetch(url);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const { calls, deps } = noDeps();

    const shutdown = shutdownServer(server, 5_000, deps);
    expect(isDraining()).toBe(true);
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('finished');
    expect(await shutdown).toBe('drained');
    expect(calls).toEqual(['websockets', 'background', 'database']);
    await expect(fetch(new URL('/fast', server.url))).rejects.toThrow();
  });

  it('force-closes requests that outlive the grace period', async () => {
    const server = slowServer(10_000);
    const inFlight = fetch(new URL('/slow', server.url)).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const { calls, deps } = noDeps();

    const started = Date.now();
    expect(await shutdownServer(server, 200, deps)).toBe('forced');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await inFlight).toBeInstanceOf(Error);
    expect(calls).toContain('database');
  });
});
