/**
 * Guards the account-switch detection that keeps one user's local data
 * from surfacing under another's login.
 *
 * Sign-out purges Dexie, so the UI path is safe. The gap this closes is
 * a session that ends WITHOUT a purge — a refresh-token rejection just
 * clears the tokens — after which signing in as a different, already
 * bootstrapped account would render their characters, outbox and
 * journal as the new user's own.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveUser,
  isAccountMismatch,
  readActiveUser,
  writeActiveUser,
} from './activeUser.ts';

afterEach(() => {
  clearActiveUser();
});

describe('activeUser', () => {
  it('reports no mismatch on a fresh install', () => {
    expect(readActiveUser()).toBeNull();
    expect(isAccountMismatch('user-1')).toBe(false);
  });

  it('reports no mismatch for the same account', () => {
    writeActiveUser('user-1');
    expect(isAccountMismatch('user-1')).toBe(false);
  });

  it('detects a different account claiming the local data', () => {
    writeActiveUser('user-1');
    expect(isAccountMismatch('user-2')).toBe(true);
  });

  it('reports no mismatch once cleared by a purge', () => {
    writeActiveUser('user-1');
    clearActiveUser();
    expect(isAccountMismatch('user-2')).toBe(false);
  });
});
