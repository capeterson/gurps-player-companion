import { tablePreferencesCodec } from './tablePreferences.ts';
export type SpellSort = 'custom' | 'name' | 'points' | 'level' | 'cost' | 'upkeep' | 'time';
const codec = tablePreferencesCodec<SpellSort>(
  'gurps:spellTable:',
  ['name', 'points', 'level', 'cost', 'upkeep', 'time'],
  'name',
);
export const readSpellTablePreferences = codec.read;
export const saveSpellTablePreferences = codec.save;
export const clearAllSpellTablePreferences = codec.clearAll;
