/**
 * Update *discovery*. `registerType: 'autoUpdate'` only means the new
 * worker skips waiting — the browser still only looks for one on a
 * navigation, and this SPA's router never navigates. So a long-lived
 * tab has to go looking, and an update installed by another tab (parked
 * in `waiting`) never fires `updatefound` here at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SW_UPDATE_POLL_MS,
  clearPendingSwUpdate,
  dismissPendingSwUpdate,
  getPendingSwUpdate,
  registerSwLifecycle,
  swEvents,
} from './registerSW.ts';

class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage = vi.fn();
  setState(next: string) {
    this.state = next;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}

let registration: FakeRegistration;
let container: EventTarget & { controller: unknown; getRegistration(): Promise<unknown> };

function installFakeServiceWorker(controller: unknown = {}, options: { ready?: boolean } = {}) {
  registration = new FakeRegistration();
  const target = new EventTarget() as EventTarget & {
    controller: unknown;
    getRegistration(): Promise<unknown>;
    ready: Promise<unknown>;
  };
  target.controller = controller;
  // `options.ready` models a first visit: vite-plugin-pwa registers the
  // worker on window `load`, long after this module runs, so
  // getRegistration() resolves null and only `ready` ever produces one.
  target.getRegistration = () => Promise.resolve(options.ready ? null : registration);
  target.ready = Promise.resolve(registration);
  container = target;
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
    writable: true,
  });
}

/** Let the `getRegistration()` promise settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clearPendingSwUpdate();
  installFakeServiceWorker();
});

afterEach(() => {
  clearPendingSwUpdate();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('registerSwLifecycle update discovery', () => {
  it('announces an update once a new worker finishes installing', async () => {
    const onUpdateReady = vi.fn();
    const events: Event[] = [];
    window.addEventListener(swEvents.UPDATE_READY, (e) => events.push(e));

    const teardown = registerSwLifecycle({ onUpdateReady });
    await flush();

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');

    expect(onUpdateReady).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    // Latched, so a React subscriber that mounts later still sees it.
    expect(getPendingSwUpdate()).toBeTypeOf('function');
    teardown();
  });

  it('does not announce an update on a first-ever install', async () => {
    // No controller => this page was never controlled, so an installed
    // worker is the initial registration, not a new build.
    installFakeServiceWorker(null);
    const onUpdateReady = vi.fn();
    const teardown = registerSwLifecycle({ onUpdateReady });
    await flush();

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');

    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(getPendingSwUpdate()).toBeNull();
    teardown();
  });

  it('announces an update already parked in `waiting` by another tab', async () => {
    // This never fires `updatefound` in this tab, so without an
    // explicit check the update stays invisible forever.
    registration.waiting = new FakeWorker();
    const onUpdateReady = vi.fn();

    const teardown = registerSwLifecycle({ onUpdateReady });
    await flush();

    expect(onUpdateReady).toHaveBeenCalledOnce();
    expect(getPendingSwUpdate()).toBeTypeOf('function');
    teardown();
  });

  it('polls for a new build so a long-lived tab notices one', async () => {
    vi.useFakeTimers();
    const teardown = registerSwLifecycle();
    await vi.advanceTimersByTimeAsync(0);

    expect(registration.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS + 10);
    expect(registration.update).toHaveBeenCalledOnce();

    teardown();
  });

  it('checks on focus, throttled so focus churn cannot hammer the server', async () => {
    vi.useFakeTimers();
    const teardown = registerSwLifecycle();
    await vi.advanceTimersByTimeAsync(0);

    // Immediately after registration the throttle window is open.
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledOnce();

    teardown();
  });

  it('resumes checking after the user dismisses the prompt', async () => {
    vi.useFakeTimers();
    const teardown = registerSwLifecycle();
    await vi.advanceTimersByTimeAsync(0);

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');
    expect(getPendingSwUpdate()).toBeTypeOf('function');

    // While an announcement is outstanding, checks are pointless.
    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS + 10);
    expect(registration.update).not.toHaveBeenCalled();

    // Dismissing means "not now", not "stop looking" -- without this
    // the latch stays closed and the tab never learns about any future
    // release either.
    dismissPendingSwUpdate();
    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS + 10);
    expect(registration.update).toHaveBeenCalled();

    teardown();
  });

  it('does not re-nag about a build the user already dismissed', async () => {
    vi.useFakeTimers();
    const onUpdateReady = vi.fn();
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const teardown = registerSwLifecycle({ onUpdateReady });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdateReady).toHaveBeenCalledOnce();

    dismissPendingSwUpdate();
    // The same worker is still parked in `waiting` on every later poll.
    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS * 3);
    expect(onUpdateReady).toHaveBeenCalledOnce();

    // A genuinely newer build still gets through.
    registration.waiting = new FakeWorker();
    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS + 10);
    expect(onUpdateReady).toHaveBeenCalledTimes(2);

    teardown();
  });

  it('starts polling on a first visit, where no registration exists yet', async () => {
    // The regression: getRegistration() resolves null before the worker
    // is registered on window `load`, so bailing out left that tab with
    // no timer and no listeners for the rest of its life.
    vi.useFakeTimers();
    installFakeServiceWorker({}, { ready: true });

    const teardown = registerSwLifecycle();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS + 10);

    expect(registration.update).toHaveBeenCalled();
    teardown();
  });

  it('detects an update found after a first-visit registration', async () => {
    vi.useFakeTimers();
    installFakeServiceWorker({}, { ready: true });
    const onUpdateReady = vi.fn();

    const teardown = registerSwLifecycle({ onUpdateReady });
    await vi.advanceTimersByTimeAsync(0);

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');

    expect(onUpdateReady).toHaveBeenCalledOnce();
    teardown();
  });

  it('adopts a worker that was already installing when we attached', async () => {
    // A navigation-triggered update can start before the async
    // registration lookup resolves: `updatefound` fires with nobody
    // listening, `waiting` is still null, and once autoUpdate activates
    // that worker no later update() call can recreate the lost event --
    // the release would never prompt at all.
    const installing = new FakeWorker();
    registration.installing = installing;
    const onUpdateReady = vi.fn();

    const teardown = registerSwLifecycle({ onUpdateReady });
    await flush();

    installing.setState('installed');

    expect(onUpdateReady).toHaveBeenCalledOnce();
    teardown();
  });

  it('adopts an already-installed worker that never fired an event here', async () => {
    const installing = new FakeWorker();
    installing.state = 'installed';
    registration.installing = installing;
    const onUpdateReady = vi.fn();

    const teardown = registerSwLifecycle({ onUpdateReady });
    await flush();

    expect(onUpdateReady).toHaveBeenCalledOnce();
    teardown();
  });

  it('stops polling after teardown', async () => {
    vi.useFakeTimers();
    const teardown = registerSwLifecycle();
    await vi.advanceTimersByTimeAsync(0);
    teardown();

    await vi.advanceTimersByTimeAsync(SW_UPDATE_POLL_MS * 3);
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('is inert when the browser has no service worker support', () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    // biome-ignore lint/performance/noDelete: restoring the absent-API shape is the point
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(() => registerSwLifecycle()()).not.toThrow();
  });
});
