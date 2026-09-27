import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { flashBus, makeFlashKey } from '../sync/flashBus.ts';
import {
  THEME_FIELD_LABELS,
  type ThemePreferenceField,
  fetchServerThemePreferences,
  subscribeThemeRejections,
} from './theme.ts';
import { useToasts } from './toast.tsx';

export const THEME_PREFERENCES_QUERY_KEY = ['auth', 'preferences'] as const;

/** Flash key for a theme picker, shared by the rollback emitter and the control. */
export function themePreferenceFlashKey(field: ThemePreferenceField): string {
  return makeFlashKey('user_preferences', 'me', field);
}

/**
 * Keeps the signed-in user's palette choices in step with the server:
 * reads the server copy (again on focus/reconnect, so other devices'
 * changes arrive), and turns a server rejection into a toast plus a
 * flash on the affected picker (AGENTS.md rule 2).
 */
export function useThemePreferenceSync() {
  const toasts = useToasts();
  useQuery({
    queryKey: THEME_PREFERENCES_QUERY_KEY,
    queryFn: fetchServerThemePreferences,
  });

  useEffect(
    () =>
      subscribeThemeRejections(({ fields, reason }) => {
        const names = fields.map((field) => THEME_FIELD_LABELS[field]).join(' and ');
        toasts.push(`Couldn't save ${names || 'theme'} — ${reason}`, { kind: 'error' });
        for (const field of fields) {
          flashBus.emit({ key: themePreferenceFlashKey(field), reason });
        }
      }),
    [toasts],
  );
}
