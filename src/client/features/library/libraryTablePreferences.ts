import { tablePreferencesCodec } from '../characters/sections/tablePreferences.ts';

export const LIBRARY_SORTS = [
  'name',
  'points',
  'difficulty',
  'energy',
  'weight',
  'cost',
  'stacking',
  'duration',
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

/** Device-only sort choice per campaign section, keyed `${campaignId}:${section}`. */
const codec = tablePreferencesCodec<LibrarySort>('gurps:libraryTable:', LIBRARY_SORTS, 'name');

export const readLibraryTablePreferences = codec.read;
export const saveLibraryTablePreferences = codec.save;
export const clearAllLibraryTablePreferences = codec.clearAll;
