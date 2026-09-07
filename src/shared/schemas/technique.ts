import { z } from 'zod';
import { timestamps, uuid } from './common.ts';

/**
 * Technique difficulty (GURPS Martial Arts p. 87).  Only Average and
 * Hard exist — techniques have no Easy or Very Hard tier.
 */
export const TECHNIQUE_DIFFICULTIES = ['A', 'H'] as const;
export const techniqueDifficulty = z.enum(TECHNIQUE_DIFFICULTIES);
export type TechniqueDifficulty = z.infer<typeof techniqueDifficulty>;

export const TECHNIQUE_DIFFICULTY_LABELS: Record<TechniqueDifficulty, string> = {
  A: 'Average',
  H: 'Hard',
};

export const techniqueOut = z.object({
  id: uuid,
  characterId: uuid,
  name: z.string().min(1).max(160),
  /**
   * Name of the skill this technique defaults from, matched
   * case-insensitively against the character's skills (including the
   * `Name (Specialization)` display form).  A name rather than a
   * skill id because the same technique definition lives on
   * campaign_library_techniques rows shared across characters.
   */
  defaultSkillName: z.string().min(1).max(160),
  difficulty: techniqueDifficulty,
  points: z.number().int().min(0).max(100),
  /**
   * The technique's default line: how far below its governing skill it
   * starts (GURPS Martial Arts p. 87 — "techniques default at a penalty
   * to the controlling skill").  Stored separately from `points` so a
   * technique that defaults at skill-6 doesn't expose the full skill
   * level as a roll target until points are bought up.  0 = defaults at
   * full skill level.
   */
  defaultModifier: z.number().int().min(-99).max(0).default(0),
  /**
   * Maximum bonus the technique may reach above its default skill
   * level.  Null = uncapped.  GURPS techniques usually cap at +N
   * stated in the technique's write-up.
   */
  maxLevel: z.number().int().min(0).max(20).nullable(),
  notes: z.string().max(20_000).nullable(),
  libraryTechniqueId: uuid.nullable(),
  /**
   * Server-computed: the default skill's effective level plus the
   * default line's penalty and the point-derived bonus, capped by
   * `maxLevel`.  Null when the default skill isn't on the sheet (or has
   * no usable level), which is how the UI shows "Skill 'X' not on sheet".
   */
  level: z.number().int().nullable(),
  /** Server-computed: the resolved default skill's effective level, or null. */
  defaultSkillLevel: z.number().int().nullable(),
  ...timestamps,
});

export const techniqueCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  defaultSkillName: z.string().min(1).max(160).trim(),
  difficulty: techniqueDifficulty.default('A'),
  points: z.number().int().min(0).max(100).default(0),
  defaultModifier: z.number().int().min(-99).max(0).default(0),
  maxLevel: z.number().int().min(0).max(20).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  libraryTechniqueId: uuid.nullable().optional(),
});

export const techniqueUpdate = techniqueCreate.partial();

export type TechniqueOut = z.infer<typeof techniqueOut>;
export type TechniqueCreate = z.infer<typeof techniqueCreate>;
export type TechniqueUpdate = z.infer<typeof techniqueUpdate>;
