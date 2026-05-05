import { describe, expect, it, vi } from 'vitest';
import { FlashBus, makeFlashKey } from './flashBus.ts';

describe('FlashBus', () => {
  it('delivers events only to subscribers of the matching key', () => {
    const bus = new FlashBus();
    const k1 = makeFlashKey('character', 'a', 'st');
    const k2 = makeFlashKey('character', 'b', 'st');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bus.subscribe(k1, cb1);
    bus.subscribe(k2, cb2);
    bus.emit({ key: k1, reason: 'rejected' });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers per key', () => {
    const bus = new FlashBus();
    const key = makeFlashKey('character', 'a', 'st');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bus.subscribe(key, cb1);
    bus.subscribe(key, cb2);
    bus.emit({ key, reason: 'r' });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes cleanly', () => {
    const bus = new FlashBus();
    const key = makeFlashKey('character', 'a', 'st');
    const cb = vi.fn();
    const off = bus.subscribe(key, cb);
    off();
    bus.emit({ key, reason: 'r' });
    expect(cb).not.toHaveBeenCalled();
  });
});
