import { z } from '@hono/zod-openapi';

/**
 * Per-user colour theme choices. The client switches between a dark and a
 * light mode on each device; these pick which palette each mode uses, and are
 * stored on the server so every device shows the same palettes.
 */
export const DARK_THEMES = [
  'gilded-tome',
  'midnight-gilt',
  'verdigris-brass',
  'arcane-dark',
] as const;
export const LIGHT_THEMES = ['illuminated-manuscript', 'heraldic-vellum', 'arcane-light'] as const;

export const darkThemeName = z.enum(DARK_THEMES);
export const lightThemeName = z.enum(LIGHT_THEMES);
export type DarkThemeName = z.infer<typeof darkThemeName>;
export type LightThemeName = z.infer<typeof lightThemeName>;
export type ThemeName = DarkThemeName | LightThemeName;

export const DEFAULT_DARK_THEME: DarkThemeName = 'gilded-tome';
export const DEFAULT_LIGHT_THEME: LightThemeName = 'illuminated-manuscript';

export const THEME_LABELS: Record<ThemeName, string> = {
  'arcane-dark': 'Arcane Purple',
  'arcane-light': 'Arcane Purple',
  'gilded-tome': 'Gilded Tome',
  'midnight-gilt': 'Midnight Gilt',
  'verdigris-brass': 'Verdigris & Brass',
  'illuminated-manuscript': 'Illuminated Manuscript',
  'heraldic-vellum': 'Heraldic Vellum',
};

export const themePreferences = z
  .object({
    darkTheme: darkThemeName,
    lightTheme: lightThemeName,
  })
  .openapi('ThemePreferences');
export type ThemePreferences = z.infer<typeof themePreferences>;

export const themePreferencesPatch = z
  .object({
    darkTheme: darkThemeName.optional(),
    lightTheme: lightThemeName.optional(),
  })
  .strict()
  .refine((body) => body.darkTheme !== undefined || body.lightTheme !== undefined, {
    message: 'at least one theme is required',
  })
  .openapi('ThemePreferencesPatch');
export type ThemePreferencesPatch = z.infer<typeof themePreferencesPatch>;
