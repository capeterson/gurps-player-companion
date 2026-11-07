import { describe, expect, it, mock } from 'bun:test';
import { configureIntegrationTestEnvironment } from '../testConfig.ts';
import {
  nextNightlyAt,
  startNightlyMaintenance,
  stopNightlyMaintenance,
} from './nightlyMaintenance.ts';

configureIntegrationTestEnvironment();

describe('nightly maintenance', () => {
  it('starts one unreferenced nightly timer, skips tests and clears it on shutdown', async () => {
    // Other route suites create development apps and start this singleton.
    // Stop their timer before observing this test's scheduling calls.
    await stopNightlyMaintenance();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const unref = mock(() => {});
    const fakeTimer = { unref };
    const schedule = mock((_callback: unknown, _delay?: number) => fakeTimer);
    const clear = mock((_timer: unknown) => {});
    globalThis.setTimeout = schedule as unknown as typeof setTimeout;
    globalThis.clearTimeout = clear as unknown as typeof clearTimeout;
    try {
      startNightlyMaintenance('test');
      expect(schedule).not.toHaveBeenCalled();
      const before = Date.now();
      startNightlyMaintenance('production');
      startNightlyMaintenance('production');
      expect(schedule).toHaveBeenCalledTimes(1);
      const delay = schedule.mock.calls[0]?.[1];
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(86400000);
      expect(before + (delay ?? 0)).toBeCloseTo(nextNightlyAt(new Date(before)).getTime(), -2);
      expect(unref).toHaveBeenCalledTimes(1);
      await stopNightlyMaintenance();
      expect(clear).toHaveBeenCalledWith(fakeTimer);
    } finally {
      await stopNightlyMaintenance();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('schedules the next 03:00 UTC boundary across month/year and DST dates', () => {
    for (const [input, output] of [
      ['2026-09-29T02:59:59.999Z', '2026-09-29T03:00:00.000Z'],
      ['2026-09-29T03:00:00.000Z', '2026-09-30T03:00:00.000Z'],
      ['2026-12-31T23:59:00.000Z', '2027-01-01T03:00:00.000Z'],
      ['2026-03-08T10:00:00.000Z', '2026-03-09T03:00:00.000Z'],
    ] as const) {
      expect(nextNightlyAt(new Date(input)).toISOString()).toBe(output);
    }
  });
});
