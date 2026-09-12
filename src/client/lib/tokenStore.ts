/**
 * LocalStorage-backed token store.  Tokens are mirrored into IndexedDB
 * later for offline boot, but the synchronous read at app start needs
 * localStorage.
 */

const ACCESS_KEY = 'gpc.access';
const REFRESH_KEY = 'gpc.refresh';
const TOKEN_PAIR_KEY = 'gpc.tokenPair.v1';

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresIn: number;
}

export interface TokenSnapshot extends Tokens {
  /** Identifies one login session across every tab sharing localStorage. */
  readonly sessionId: string;
  /** Increments when that session rotates its token pair. */
  readonly version: number;
}

function newSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function parseStoredPair(raw: string | null): TokenSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TokenSnapshot>;
    if (
      typeof value.accessToken !== 'string' ||
      typeof value.refreshToken !== 'string' ||
      typeof value.accessTokenExpiresIn !== 'number' ||
      typeof value.sessionId !== 'string' ||
      typeof value.version !== 'number'
    ) {
      return null;
    }
    return value as TokenSnapshot;
  } catch {
    return null;
  }
}

function persist(pair: TokenSnapshot): void {
  window.localStorage.setItem(TOKEN_PAIR_KEY, JSON.stringify(pair));
  // Remove the pre-session-fence representation once it has been migrated.
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export const tokenStore = {
  read(): TokenSnapshot | null {
    if (typeof window === 'undefined') return null;
    const stored = parseStoredPair(window.localStorage.getItem(TOKEN_PAIR_KEY));
    if (stored) return stored;

    // One-time migration from the original two-key representation. Giving
    // the pair a session id makes already-signed-in installations safe as
    // soon as the upgraded client boots.
    const access = window.localStorage.getItem(ACCESS_KEY);
    const refresh = window.localStorage.getItem(REFRESH_KEY);
    if (!access || !refresh) return null;
    const migrated: TokenSnapshot = {
      accessToken: access,
      refreshToken: refresh,
      accessTokenExpiresIn: 0,
      sessionId: newSessionId(),
      version: 0,
    };
    persist(migrated);
    return migrated;
  },
  write(tokens: Tokens): void {
    if (typeof window === 'undefined') return;
    persist({ ...tokens, sessionId: newSessionId(), version: 0 });
  },
  /** Replace a rotated pair only if the session that requested it still owns storage. */
  replaceIfCurrent(expected: TokenSnapshot, tokens: Tokens): boolean {
    if (typeof window === 'undefined') return false;
    const current = this.read();
    if (
      !current ||
      current.sessionId !== expected.sessionId ||
      current.version !== expected.version ||
      current.refreshToken !== expected.refreshToken
    ) {
      return false;
    }
    persist({ ...tokens, sessionId: current.sessionId, version: current.version + 1 });
    return true;
  },
  isCurrent(expected: Pick<TokenSnapshot, 'sessionId' | 'version'>): boolean {
    const current = this.read();
    return (
      current !== null &&
      current.sessionId === expected.sessionId &&
      current.version === expected.version
    );
  },
  /** Clear only the pair a rejected request actually presented. */
  clearIfCurrent(expected: Pick<TokenSnapshot, 'sessionId' | 'version'>): boolean {
    if (!this.isCurrent(expected)) return false;
    this.clear();
    return true;
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_PAIR_KEY);
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
  hasToken(): boolean {
    return this.read() !== null;
  },
};

/**
 * Decode the `sub` claim from the stored access token without verifying
 * the signature (verification happens server-side). Used in offline
 * contexts where /auth/me is unreachable so we can still determine
 * ownership for `canWrite` checks.
 */
export function readUserIdFromToken(): string | null {
  const tokens = tokenStore.read();
  if (!tokens) return null;
  try {
    const parts = tokens.accessToken.split('.');
    if (parts.length !== 3) return null;
    // JWT payload is base64url-encoded; convert to standard base64 before decoding.
    // Explicit guard satisfies noUncheckedIndexedAccess (parts[1] is string|undefined).
    const base64Url = parts[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64)) as unknown;
    if (typeof decoded !== 'object' || decoded === null) return null;
    const sub = (decoded as Record<string, unknown>).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}
