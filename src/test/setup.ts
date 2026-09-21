import '@testing-library/jest-dom/vitest';
import { Window } from 'happy-dom';
// Provide a fake IndexedDB so client tests that touch Dexie don't need
// a real browser.  Dexie checks `typeof indexedDB` lazily, so importing
// this once at setup is enough.
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetLocalDb } from '../client/db/dexie.ts';

// Node 26 exposes an incomplete experimental `localStorage` property on
// globalThis. Vitest copies that undefined value over Happy DOM's working
// implementation, so restore a browser-compatible Storage object when needed.
if (typeof window !== 'undefined' && !window.localStorage) {
  const storage = new Window().localStorage;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

// Happy DOM does not implement responsive media queries. Keep the default
// browser-like state mobile so sheet tests exercise the FAB path explicitly;
// focused navigation tests replace this with a desktop matchMedia as needed.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
}

afterEach(async () => {
  cleanup();
  // Wipe Dexie between tests so per-test fixtures start fresh.  Done
  // here so individual tests don't have to remember.
  await resetLocalDb();
});
