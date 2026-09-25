import { type TablePreferences, tablePreferencesCodec } from '../tablePreferences.ts';

export type DefenseSort = 'custom' | 'defense' | 'skill' | 'final';
export type DefenseTablePreferences = TablePreferences<DefenseSort>;

const codec = tablePreferencesCodec<DefenseSort>(
  'gurps:defenseTable:',
  ['custom', 'defense', 'skill', 'final'],
  'custom',
);

export const readDefenseTablePreferences = codec.read;
export const saveDefenseTablePreferences = codec.save;
export const clearAllDefenseTablePreferences = codec.clearAll;
