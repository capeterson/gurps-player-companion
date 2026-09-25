import { type TablePreferences, tablePreferencesCodec } from './tablePreferences.ts';

export type TraitSort = 'custom' | 'name' | 'kind' | 'points' | 'level';
export type TraitTablePreferences = TablePreferences<TraitSort>;

const codec = tablePreferencesCodec<TraitSort>(
  'gurps:traitTable:',
  ['custom', 'name', 'kind', 'points', 'level'],
  'name',
);

export const readTraitTablePreferences = codec.read;
export const saveTraitTablePreferences = codec.save;
export const clearAllTraitTablePreferences = codec.clearAll;
