/**
 * Sync state machine: enforces a 1-second minimum visibility per
 * issue #12 ("if a state is transient for less than a second show
 * the relevant icon for a full second").
 */

import { describe, expect, it, vi } from 'vitest';
import { SyncStateStore } from './state.ts';

describe('SyncStateStore', () => {
  it('starts at synced and notifies subscribers on transition', () => {
    vi.useFakeTimers();
    const now = vi.fn(() => 1_000_000);
    const store = new SyncStateStore('synced', now);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s));
    // After 1 second elapses, syncing transitions immediately.
    now.mockReturnValue(1_001_500);
    store.set('syncing');
    expect(store.value).toBe('syncing');
    expect(seen).toEqual(['syncing']);
    vi.useRealTimers();
  });

  it('holds a transient state for at least 1 second', async () => {
    vi.useFakeTimers();
    let t = 0;
    const now = vi.fn(() => t);
    const store = new SyncStateStore('synced', now);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s));
    // First transition (after 0ms) is allowed -- elapsed since
    // construction would be 0, but the dwell window starts at the
    // *previous* transition.  Move t forward enough.
    t = 2000;
    store.set('syncing');
    expect(store.value).toBe('syncing');
    // Immediate flip back to synced should be deferred by ~1s.
    t = 2050;
    store.set('synced');
    expect(store.value).toBe('syncing');
    // After the dwell expires the deferred commit fires.
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.value).toBe('synced');
    expect(seen).toEqual(['syncing', 'synced']);
    vi.useRealTimers();
  });

  it('lets error short-circuit any pending dwell', async () => {
    vi.useFakeTimers();
    let t = 0;
    const now = vi.fn(() => t);
    const store = new SyncStateStore('synced', now);
    t = 2000;
    store.set('syncing');
    t = 2010;
    // Attempt to flip to synced while still inside the dwell -- this
    // would normally be deferred for ~990ms.
    store.set('synced');
    expect(store.value).toBe('syncing');
    // An error must override and commit immediately.
    store.set('error');
    expect(store.value).toBe('error');
    vi.useRealTimers();
  });
});
