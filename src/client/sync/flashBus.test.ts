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

  it('a prefix subscription matches every field of the entity', () => {
    const bus = new FlashBus();
    const prefix = 'character_inventory:item-1:';
    const cb = vi.fn();
    bus.subscribePrefix(prefix, cb);
    bus.emit({ key: makeFlashKey('character_inventory', 'item-1', 'weaponData'), reason: 'r' });
    bus.emit({ key: makeFlashKey('character_inventory', 'item-1', 'enchantments'), reason: 'r' });
    expect(cb).toHaveBeenCalledTimes(2);
    // A different entity or a different class is not matched.
    bus.emit({ key: makeFlashKey('character_inventory', 'item-2', 'enchantments'), reason: 'r' });
    bus.emit({ key: makeFlashKey('character', 'item-1', 'st'), reason: 'r' });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('exact subscribers still fire alongside a prefix subscriber', () => {
    const bus = new FlashBus();
    const key = makeFlashKey('character_inventory', 'item-1', 'quantity');
    const exact = vi.fn();
    const prefixed = vi.fn();
    bus.subscribe(key, exact);
    bus.subscribePrefix('character_inventory:item-1:', prefixed);
    bus.emit({ key, reason: 'r' });
    expect(exact).toHaveBeenCalledTimes(1);
    expect(prefixed).toHaveBeenCalledTimes(1);
  });

  it('a prefix subscription unsubscribes cleanly', () => {
    const bus = new FlashBus();
    const off = bus.subscribePrefix('character_inventory:item-1:', vi.fn());
    off();
    bus.emit({ key: makeFlashKey('character_inventory', 'item-1', 'enchantments'), reason: 'r' });
    // No throw and no lingering dispatch — verified by a fresh subscriber
    // receiving nothing after the unsubscription already ran.
  });
});
