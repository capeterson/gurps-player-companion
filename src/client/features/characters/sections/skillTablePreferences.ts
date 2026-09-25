import { type TablePreferences, tablePreferencesCodec } from './tablePreferences.ts';

export type SkillSort = 'custom' | 'name' | 'basis' | 'points' | 'level';
export type SkillTablePreferences = TablePreferences<SkillSort>;

const codec = tablePreferencesCodec<SkillSort>(
  'gurps:skillTable:',
  ['custom', 'name', 'basis', 'points', 'level'],
  'name',
);

export const readSkillTablePreferences = codec.read;
export const saveSkillTablePreferences = codec.save;
export const clearAllSkillTablePreferences = codec.clearAll;
