import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_CHANGE_EVENT, OFFLINE_MODE_KEY, connectionStore } from './connectionState.ts';

afterEach(() => {
  vi.restoreAllMocks();
  connectionStore.reset();
});

describe('connectionStore', () => {
  it('persists the manual offline choice and clears it on reset', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    connectionStore.reset();

    connectionStore.setManualOffline(true);
    expect(localStorage.getItem(OFFLINE_MODE_KEY)).toBe('true');
    expect(connectionStore.status).toMatchObject({ manualOffline: true, online: false });

    connectionStore.reset();
    expect(localStorage.getItem(OFFLINE_MODE_KEY)).toBeNull();
    expect(connectionStore.status).toMatchObject({ manualOffline: false, online: true });
  });

  it('observes another tab changing the stored choice', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    connectionStore.reset();
    const changed = vi.fn();
    const unsubscribe = connectionStore.subscribe(changed);

    localStorage.setItem(OFFLINE_MODE_KEY, 'true');
    window.dispatchEvent(new StorageEvent('storage', { key: OFFLINE_MODE_KEY }));
    expect(connectionStore.status).toMatchObject({ manualOffline: true, online: false });
    expect(changed).toHaveBeenCalled();

    localStorage.removeItem(OFFLINE_MODE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: OFFLINE_MODE_KEY }));
    expect(connectionStore.status).toMatchObject({ manualOffline: false, online: true });
    unsubscribe();
  });

  it('does not let a browser online event override manual offline mode', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    connectionStore.reset();
    const changedEvent = vi.fn();
    window.addEventListener(CONNECTION_CHANGE_EVENT, changedEvent);
    const unsubscribe = connectionStore.subscribe(() => {});
    connectionStore.setManualOffline(true);
    changedEvent.mockClear();

    window.dispatchEvent(new Event('online'));

    expect(connectionStore.status).toEqual({
      manualOffline: true,
      deviceOnline: true,
      online: false,
    });
    expect(changedEvent).not.toHaveBeenCalled();
    unsubscribe();
    window.removeEventListener(CONNECTION_CHANGE_EVENT, changedEvent);
  });

  it('keeps the previous mode when saving the preference fails', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });

    expect(() => connectionStore.setManualOffline(true)).toThrow('storage full');
    expect(connectionStore.status.manualOffline).toBe(false);
    expect(localStorage.getItem(OFFLINE_MODE_KEY)).toBeNull();
  });

  it('continues probing an unreachable origin but not manual or device offline mode', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    connectionStore.reset();
    connectionStore.markUnavailable();
    expect(connectionStore.status.online).toBe(false);
    expect(connectionStore.canAttemptNetwork()).toBe(true);

    connectionStore.markReachable();
    expect(connectionStore.status.online).toBe(true);
    connectionStore.setManualOffline(true);
    expect(connectionStore.canAttemptNetwork()).toBe(false);

    connectionStore.setManualOffline(false);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(connectionStore.canAttemptNetwork()).toBe(false);
  });
});
