import { z } from '@hono/zod-openapi';

/**
 * Per-user colour theme choices. The client switches between a dark and a
 * light mode on each device; these pick which palette each mode uses, and are
 * stored on the server so every device shows the same palettes.
 */
export const DARK_THEMES = ['corona-obsidian'] as const;
export const LIGHT_THEMES = ['heliolance', 'daybreak-lens'] as const;

export const darkThemeName = z.enum(DARK_THEMES);
export const lightThemeName = z.enum(LIGHT_THEMES);
export type DarkThemeName = z.infer<typeof darkThemeName>;
export type LightThemeName = z.infer<typeof lightThemeName>;
export type ThemeName = DarkThemeName | LightThemeName;

export const DEFAULT_DARK_THEME: DarkThemeName = 'corona-obsidian';
export const DEFAULT_LIGHT_THEME: LightThemeName = 'heliolance';

export const THEME_LABELS: Record<ThemeName, string> = {
  heliolance: 'Heliolance',
  'daybreak-lens': 'Daybreak Lens',
  'corona-obsidian': 'Corona Obsidian',
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
