import { z } from 'zod';
import { SPELL_DIFFICULTIES } from '../constants/skills.ts';
import { timestamps, uuid } from './common.ts';

/**
 * GURPS 4e spells.  Mechanically a spell is an IQ skill (Hard for
 * most, Very Hard for a few), but we track it in its own table so
 * spell-specific fields (college, energy cost, casting time, duration,
 * prerequisites) and spell-specific UI can stay separate from the
 * regular skill panel.  Effective skill level adds the caster's Magery
 * level on top of the standard skill formula -- see
 * `src/shared/domain/spellCalc.ts`.
 */
export const spellDifficulty = z.enum(SPELL_DIFFICULTIES);

export const spellOut = z.object({
  id: uuid,
  characterId: uuid,
  name: z.string().min(1).max(160),
  /** Free-text college name (e.g. "Fire", "Healing").  No enum yet --
   * different campaigns rearrange the college list in their own ways. */
  college: z.string().max(80).nullable(),
  /** IQ/Hard for most spells; a few (Major Healing, Enchant, ...) are VH. */
  difficulty: spellDifficulty,
  /** min 0 here only to tolerate legacy rows on read; new writes
   * require >= 1 (spells have no default in GURPS). */
  points: z.number().int().min(0).max(1000),
  /** Pre-discount energy cost the player records from the book. */
  baseEnergyCost: z.number().int().min(0).max(99),
  /** Per-tick maintenance cost while sustained.  Null = not sustained. */
  maintenanceCost: z.number().int().min(0).max(99).nullable(),
  /** Free-form casting time text (e.g. "1 second", "5 minutes"). */
  castingTime: z.string().max(40).nullable(),
  duration: z.string().max(40).nullable(),
  prerequisites: z.string().max(2000).nullable(),
  notes: z.string().max(20_000).nullable(),
  librarySpellId: uuid.nullable(),
  /** Server-computed convenience field: IQ/H + Magery + skill offset.
   * Null for a legacy 0-point row — spells have no default in GURPS. */
  level: z.number().int().nullable(),
  /** Server-computed convenience field: cost after skill discount. */
  effectiveCost: z.number().int(),
  /** Server-computed: maintenance cost after the same skill discount.
   * Null when the spell has no maintenance cost recorded. */
  effectiveMaintenanceCost: z.number().int().nullable(),
  ...timestamps,
});

export const spellCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  college: z.string().max(80).trim().nullable().optional(),
  difficulty: spellDifficulty.default('H'),
  /** Spells have no default skill in GURPS: knowing one takes >= 1 point. */
  points: z.number().int().min(1).max(1000).default(1),
  baseEnergyCost: z.number().int().min(0).max(99).default(1),
  maintenanceCost: z.number().int().min(0).max(99).nullable().optional(),
  castingTime: z.string().max(40).trim().nullable().optional(),
  duration: z.string().max(40).trim().nullable().optional(),
  prerequisites: z.string().max(2000).trim().nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  librarySpellId: uuid.nullable().optional(),
});

export const spellUpdate = spellCreate.partial();

export type SpellOut = z.infer<typeof spellOut>;
export type SpellCreate = z.infer<typeof spellCreate>;
export type SpellUpdate = z.infer<typeof spellUpdate>;
