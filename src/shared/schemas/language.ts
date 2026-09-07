import { z } from 'zod';
import { timestamps, uuid } from './common.ts';

/**
 * Spoken / written fluency levels (Basic Set p. 23-24).
 *
 * `'n/a'` covers sign languages and other tongues that have no written
 * form at all — distinct from `'none'` ("this character can't read it"),
 * which is a statement about the character rather than the language.
 */
export const FLUENCY_LEVELS = ['none', 'broken', 'accented', 'native', 'n/a'] as const;
export const fluencyLevel = z.enum(FLUENCY_LEVELS);
export type FluencyLevel = z.infer<typeof fluencyLevel>;

/** Human labels for the fluency dropdowns. */
export const FLUENCY_LABELS: Record<FluencyLevel, string> = {
  none: 'None',
  broken: 'Broken',
  accented: 'Accented',
  native: 'Native',
  'n/a': 'N/A',
};

/**
 * Point cost of the spoken half of a language.
 *
 * `native` is 0 because the entry a player writes at native fluency is
 * normally their mother tongue, which is free (B23). A *second* language
 * learned to native fluency does cost points in the book; `points` is an
 * explicit column the player can override, so that case is expressible —
 * the auto-computation just doesn't guess it.
 */
export const SPOKEN_POINTS: Record<FluencyLevel, number> = {
  none: 0,
  broken: 1,
  accented: 2,
  native: 0,
  'n/a': 0,
};

/** Point cost of the written half of a language (B24). */
export const WRITTEN_POINTS: Record<FluencyLevel, number> = {
  none: 0,
  broken: 1,
  accented: 2,
  native: 3,
  'n/a': 0,
};

/**
 * Suggested point cost for a spoken/written fluency pair. The UI seeds
 * the `points` input from this and re-seeds it whenever a fluency
 * dropdown changes, but the stored value is always whatever the player
 * put in the field — house rules and mother-tongue exceptions win.
 */
export function computeLanguagePoints(spoken: FluencyLevel, written: FluencyLevel): number {
  return SPOKEN_POINTS[spoken] + WRITTEN_POINTS[written];
}

export const languageOut = z.object({
  id: uuid,
  characterId: uuid,
  name: z.string().min(1).max(160),
  spokenFluency: fluencyLevel,
  writtenFluency: fluencyLevel,
  points: z.number().int().min(0).max(100),
  notes: z.string().max(20_000).nullable(),
  libraryLanguageId: uuid.nullable(),
  ...timestamps,
});

export const languageCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  spokenFluency: fluencyLevel.default('none'),
  writtenFluency: fluencyLevel.default('none'),
  points: z.number().int().min(0).max(100).default(0),
  notes: z.string().max(20_000).nullable().optional(),
  libraryLanguageId: uuid.nullable().optional(),
});

export const languageUpdate = languageCreate.partial();

export type LanguageOut = z.infer<typeof languageOut>;
export type LanguageCreate = z.infer<typeof languageCreate>;
export type LanguageUpdate = z.infer<typeof languageUpdate>;
