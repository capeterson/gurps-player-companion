import { tablePreferencesCodec } from './tablePreferences.ts';
export type SpellSort = 'custom' | 'name' | 'level' | 'time' | 'duration' | 'upkeep' | 'cost';
const codec = tablePreferencesCodec<SpellSort>(
  'gurps:spellTable:',
  ['name', 'level', 'time', 'duration', 'upkeep', 'cost'],
  'name',
);
export const readSpellTablePreferences = codec.read;
export const saveSpellTablePreferences = codec.save;
export const clearAllSpellTablePreferences = codec.clearAll;
