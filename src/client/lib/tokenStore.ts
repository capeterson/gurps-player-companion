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
