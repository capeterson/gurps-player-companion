import { DRAFT_FIELD_CLASS } from '../../hooks/useDraftField.ts';
import { useFlashState } from '../../hooks/useFlashState.ts';
import {
  LIGHT_THEMES,
  type LightThemeName,
  THEME_LABELS,
  setThemePreference,
  useThemeState,
} from '../../lib/theme.ts';
import { themePreferenceFlashKey } from '../../lib/themeSync.ts';

export function AppearanceSection() {
  const { preferences, pending } = useThemeState();
  const { flashProps } = useFlashState(themePreferenceFlashKey('lightTheme'));
  return (
    <section className="max-w-lg">
      <div className="card gap-4 p-card">
        <div>
          <p className="label-eyebrow">Preferences</p>
          <h2 className="font-display text-2xl">Appearance</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <label htmlFor="theme-lightTheme" className="font-medium">
            Light theme
          </label>
          <select
            id="theme-lightTheme"
            className={`select select-bordered w-full sm:w-60 ${DRAFT_FIELD_CLASS}`}
            value={preferences.lightTheme}
            onChange={(event) =>
              setThemePreference('lightTheme', event.target.value as LightThemeName)
            }
            {...flashProps}
          >
            {LIGHT_THEMES.map((option) => (
              <option key={option} value={option}>
                {THEME_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <dl className="flex items-center justify-between gap-4">
          <dt className="font-medium">Dark theme</dt>
          <dd>{THEME_LABELS[preferences.darkTheme]}</dd>
        </dl>
        <output className="block text-xs text-muted">
          {pending ? 'Saved on this device — syncing to your account…' : ''}
        </output>
      </div>
    </section>
  );
}
