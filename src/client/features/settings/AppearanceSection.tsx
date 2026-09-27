import { DRAFT_FIELD_CLASS } from '../../hooks/useDraftField.ts';
import { useFlashState } from '../../hooks/useFlashState.ts';
import {
  DARK_THEMES,
  LIGHT_THEMES,
  THEME_LABELS,
  type ThemePreferenceField,
  type ThemePreferences,
  setThemePreference,
  useThemeState,
} from '../../lib/theme.ts';
import { themePreferenceFlashKey } from '../../lib/themeSync.ts';

interface ThemePickerProps<F extends ThemePreferenceField> {
  readonly field: F;
  readonly label: string;
  readonly description: string;
  readonly options: readonly ThemePreferences[F][];
  readonly value: ThemePreferences[F];
}

function ThemePicker<F extends ThemePreferenceField>({
  field,
  label,
  description,
  options,
  value,
}: ThemePickerProps<F>) {
  const { flashProps } = useFlashState(themePreferenceFlashKey(field));
  const id = `theme-${field}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span>
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        <span className="text-xs text-muted">{description}</span>
      </span>
      <select
        id={id}
        className={`select select-bordered w-full sm:w-60 ${DRAFT_FIELD_CLASS}`}
        value={value}
        onChange={(event) => setThemePreference(field, event.target.value as ThemePreferences[F])}
        {...flashProps}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {THEME_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AppearanceSection() {
  const { preferences, pending } = useThemeState();
  return (
    <section className="max-w-lg">
      <div className="card gap-4 p-card">
        <div>
          <p className="label-eyebrow">Preferences</p>
          <h2 className="font-display text-2xl">Appearance</h2>
          <p className="text-sm text-muted">
            Choose the theme used in each mode. Saved to your account and used on all your devices;
            switch between dark and light mode from the header.
          </p>
        </div>
        <ThemePicker
          field="darkTheme"
          label="Dark theme"
          description="Used in dark mode."
          options={DARK_THEMES}
          value={preferences.darkTheme}
        />
        <ThemePicker
          field="lightTheme"
          label="Light theme"
          description="Used in light mode."
          options={LIGHT_THEMES}
          value={preferences.lightTheme}
        />
        <output className="block text-xs text-muted">
          {pending ? 'Saved on this device — syncing to your account…' : ''}
        </output>
      </div>
    </section>
  );
}
