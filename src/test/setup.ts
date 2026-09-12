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

afterEach(async () => {
  cleanup();
  // Wipe Dexie between tests so per-test fixtures start fresh.  Done
  // here so individual tests don't have to remember.
  await resetLocalDb();
});
