export type ThemeName = 'arcane-dark' | 'arcane-light';

const THEME_KEY = 'gpc.theme';
const DARK: ThemeName = 'arcane-dark';
const LIGHT: ThemeName = 'arcane-light';

export function readStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return DARK;
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === DARK || stored === LIGHT) return stored;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? LIGHT : DARK;
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function storeTheme(theme: ThemeName) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, theme);
}

export function themeLabel(theme: ThemeName) {
  return theme === DARK ? 'Dark' : 'Light';
}

export function oppositeTheme(theme: ThemeName): ThemeName {
  return theme === DARK ? LIGHT : DARK;
}
