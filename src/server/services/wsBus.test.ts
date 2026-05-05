import { afterEach, describe, expect, it } from 'bun:test';
import { _resetForTests, publish, subscribe, subscriberCount } from './wsBus.ts';

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
