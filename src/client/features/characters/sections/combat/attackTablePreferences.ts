import { type TablePreferences, tablePreferencesCodec } from '../tablePreferences.ts';

export type AttackSort = 'custom' | 'weapon' | 'skill' | 'type';
export type AttackTablePreferences = TablePreferences<AttackSort>;

const codec = tablePreferencesCodec<AttackSort>(
  'gurps:attackTable:',
  ['custom', 'weapon', 'skill', 'type'],
  'custom',
);

export const readAttackTablePreferences = codec.read;
export const saveAttackTablePreferences = codec.save;
export const clearAllAttackTablePreferences = codec.clearAll;
