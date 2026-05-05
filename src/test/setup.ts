import '@testing-library/jest-dom/vitest';
// Provide a fake IndexedDB so client tests that touch Dexie don't need
// a real browser.  Dexie checks `typeof indexedDB` lazily, so importing
// this once at setup is enough.
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetLocalDb } from '../client/db/dexie.ts';

afterEach(async () => {
  cleanup();
  // Wipe Dexie between tests so per-test fixtures start fresh.  Done
  // here so individual tests don't have to remember.
  await resetLocalDb();
});
