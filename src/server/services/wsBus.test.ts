import { afterEach, describe, expect, it } from 'bun:test';
import { _resetForTests, closeAll, publish, subscribe, subscriberCount } from './wsBus.ts';

interface FakeWs {
  readyState: number;
  sent: string[];
  send(text: string): void;
}

function makeWs(readyState = 1): FakeWs {
  return {
    readyState,
    sent: [],
    send(text) {
      this.sent.push(text);
    },
  };
}

afterEach(() => {
  _resetForTests();
});

describe('wsBus', () => {
  it('delivers a published message to every subscriber for the user', () => {
    const a = makeWs();
    const b = makeWs();
    subscribe('user-1', a);
    subscribe('user-1', b);
    publish('user-1', { kind: 'sync_invalidate', emittedAt: 'now' });
    expect(a.sent).toEqual([JSON.stringify({ kind: 'sync_invalidate', emittedAt: 'now' })]);
    expect(b.sent).toEqual([JSON.stringify({ kind: 'sync_invalidate', emittedAt: 'now' })]);
  });

  it('skips subscribers whose readyState is not OPEN', () => {
    const open = makeWs(1);
    const closing = makeWs(2);
    subscribe('user-1', open);
    subscribe('user-1', closing);
    publish('user-1', { kind: 'sync_invalidate', emittedAt: 'now' });
    expect(open.sent.length).toBe(1);
    expect(closing.sent.length).toBe(0);
  });

  it('does not deliver to other users', () => {
    const a = makeWs();
    const b = makeWs();
    subscribe('user-1', a);
    subscribe('user-2', b);
    publish('user-1', { kind: 'sync_invalidate', emittedAt: 'now' });
    expect(a.sent.length).toBe(1);
    expect(b.sent.length).toBe(0);
  });

  it('unsubscribe removes the subscriber from the bucket', () => {
    const a = makeWs();
    const unsub = subscribe('user-1', a);
    expect(subscriberCount('user-1')).toBe(1);
    unsub();
    expect(subscriberCount('user-1')).toBe(0);
    publish('user-1', { kind: 'sync_invalidate', emittedAt: 'now' });
    expect(a.sent.length).toBe(0);
  });

  it('publish is a no-op when no subscribers exist', () => {
    expect(() => publish('nobody', { kind: 'sync_invalidate', emittedAt: 'now' })).not.toThrow();
  });
});

describe('wsBus.closeAll', () => {
  it('closes every socket with 1012 and forgets them', () => {
    const closed: Array<[number | undefined, string | undefined]> = [];
    const ws = (readyState = 1) => ({
      ...makeWs(readyState),
      close(code?: number, reason?: string) {
        closed.push([code, reason]);
      },
    });
    subscribe('user-1', ws());
    subscribe('user-1', ws());
    subscribe('user-2', ws());
    expect(closeAll()).toBe(3);
    expect(closed).toEqual([
      [1012, 'server restarting'],
      [1012, 'server restarting'],
      [1012, 'server restarting'],
    ]);
    expect(subscriberCount('user-1')).toBe(0);
    expect(subscriberCount('user-2')).toBe(0);
  });
});
