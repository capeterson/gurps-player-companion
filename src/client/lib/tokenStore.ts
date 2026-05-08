/**
 * LocalStorage-backed token store.  Tokens are mirrored into IndexedDB
 * later for offline boot, but the synchronous read at app start needs
 * localStorage.
 */

const ACCESS_KEY = 'gpc.access';
const REFRESH_KEY = 'gpc.refresh';

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresIn: number;
}

export const tokenStore = {
  read(): Tokens | null {
    if (typeof window === 'undefined') return null;
    const access = window.localStorage.getItem(ACCESS_KEY);
    const refresh = window.localStorage.getItem(REFRESH_KEY);
    if (!access || !refresh) return null;
    return { accessToken: access, refreshToken: refresh, accessTokenExpiresIn: 0 };
  },
  write(tokens: Tokens): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    if (typeof window === 'undefined') return;
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
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64)) as unknown;
    if (typeof decoded !== 'object' || decoded === null) return null;
    const sub = (decoded as Record<string, unknown>).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}
