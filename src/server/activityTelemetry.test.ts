import { describe, expect, it, spyOn } from 'bun:test';
import { isUserActivityRequest, observeSweep, observedOperation } from './telemetry.ts';

describe('observed activity', () => {
  it('counts meaningful successful requests but excludes polling and rejected requests', () => {
    expect(isUserActivityRequest('/api/v1/characters', 200)).toBe(true);
    expect(isUserActivityRequest('/api/v1/sync/operations', 200)).toBe(true);
    for (const path of [
      '/api/v1/auth/refresh',
      '/api/v1/sync/cursor',
      '/api/v1/notifications',
      '/api/v1/media/file',
    ]) {
      expect(isUserActivityRequest(path, 200)).toBe(false);
    }
    expect(isUserActivityRequest('/api/v1/characters', 403)).toBe(false);
    expect(isUserActivityRequest('/mcp', 200)).toBe(false);
  });
});

it('reports sweep start, finish and partial committed progress after failure', async () => {
  const info = spyOn(console, 'log').mockImplementation(() => {});
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(
      observeSweep('test', async (processed) => {
        processed(2);
        throw new Error('failure');
      }),
    ).rejects.toThrow();
    const start = JSON.parse(String(info.mock.calls[0]?.[0]));
    const finish = JSON.parse(String(errors.mock.calls[0]?.[0]));
    expect(start.event).toBe('worker.sweep.started');
    expect(finish).toMatchObject({
      event: 'worker.sweep.finished',
      worker: 'test',
      rows_processed: 2,
      outcome: 'failure',
      started_at: start.started_at,
    });
    expect(Date.parse(finish.ended_at)).toBeGreaterThanOrEqual(Date.parse(start.started_at));
    expect(finish.duration_seconds).toBeGreaterThanOrEqual(0);
  } finally {
    info.mockRestore();
    errors.mockRestore();
  }
});

it('classifies sensitive operations without exposing paths or values', () => {
  expect(observedOperation('POST', '/api/v1/admin/users/synthetic-id/suspend')).toBe(
    'admin.suspend',
  );
  expect(observedOperation('POST', '/api/v1/campaigns/synthetic-id/library/import')).toBe(
    'library.import',
  );
  expect(observedOperation('POST', '/api/v1/oauth/authorization')).toBe('oauth.consent');
  expect(observedOperation('POST', '/api/v1/auth/reset-password')).toBe('password_reset.complete');
  expect(observedOperation('GET', '/api/v1/auth/api-keys')).toBeUndefined();
  expect(observedOperation('POST', '/api/v1/characters/synthetic-id')).toBeUndefined();
});
