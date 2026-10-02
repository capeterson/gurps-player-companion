import { z } from '@hono/zod-openapi';
import { revision, timestamps, uuid } from './common.ts';
import { libraryTraitEffect } from './effects.ts';
import { libraryMetadataShape } from './libraryMetadata.ts';
import { skillAttributeEnum, skillDifficultyEnum } from './skill.ts';
import { traitKindEnum } from './trait.ts';

export const RACE_ATTRIBUTE_AXES = [
  'st',
  'dx',
  'iq',
  'ht',
  'hp',
  'will',
  'per',
  'fp',
  'speedQuarter',
  'move',
  'sizeModifier',
] as const;
const adjustment = z.number().int().min(-1000).max(1000);
export const raceAttributeModifiers = z
  .object({
    st: adjustment.optional(),
    dx: adjustment.optional(),
    iq: adjustment.optional(),
    ht: adjustment.optional(),
    hp: adjustment.optional(),
    will: adjustment.optional(),
    per: adjustment.optional(),
    fp: adjustment.optional(),
    speedQuarter: adjustment.optional(),
    move: adjustment.optional(),
    sizeModifier: adjustment.optional(),
  })
  .strict()
  .openapi('RaceAttributeModifiers');
const key = z.string().trim().min(1).max(160);
export const racialTrait = z
  .object({
    key,
    name: key,
    kind: traitKindEnum.default('advantage'),
    points: z.number().int().min(-5000).max(10000),
    level: z.number().int().min(0).max(1000).nullable().default(null),
    description: z.string().max(4000).nullable().default(null),
    effects: z.array(libraryTraitEffect).max(30).default([]),
  })
  .strict()
  .openapi('RacialTrait');
export const racialSkill = z
  .object({
    key,
    name: key,
    attribute: skillAttributeEnum.nullable().default(null),
    difficulty: skillDifficultyEnum.nullable().default(null),
    specialization: key.nullable().default(null),
    techLevel: z.number().int().min(0).max(12).nullable().default(null),
    points: z.number().int().min(0).max(1000),
    description: z.string().max(4000).nullable().default(null),
  })
  .strict()
  .openapi('RacialSkill');
export const ownedRacialSkill = z
  .object({
    ...racialSkill.shape,
    effectiveLevel: z.number().int().nullable(),
  })
  .strict()
  .openapi('OwnedRacialSkill');
export const raceProfileShape = {
  points: z.number().int().min(-5000).max(10000).default(0),
  attributeModifiers: raceAttributeModifiers.default({}),
  traits: z.array(racialTrait).max(100).default([]),
  skills: z.array(racialSkill).max(100).default([]),
  features: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  effects: z.array(libraryTraitEffect).max(30).default([]),
};
export const raceProfile = z.object(raceProfileShape).strict().openapi('RaceProfile');
export const raceOption = z
  .object({
    key,
    name: key,
    description: z.string().max(4000).nullable().default(null),
    ...raceProfileShape,
  })
  .strict()
  .openapi('RaceOption');
export const libraryRaceCreate = z
  .object({
    ...libraryMetadataShape,
    name: key,
    description: z.string().max(20000).nullable().optional(),
    source: z.string().max(160).nullable().optional(),
    kind: z.enum(['race', 'lens']).default('race'),
    ...raceProfileShape,
    variants: z.array(raceOption).max(30).default([]),
    forms: z.array(raceOption).max(30).default([]),
    compatibleRaceKeys: z.array(key).max(100).default([]),
    removesTraits: z.array(key).max(100).default([]),
    removesSkills: z.array(key).max(100).default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(100).default([]),
  })
  .strict()
  .openapi('LibraryRaceCreate');
export const libraryRaceUpdate = libraryRaceCreate.partial().openapi('LibraryRaceUpdate');
export const libraryRaceOut = z
  .object({ ...libraryRaceCreate.shape, id: uuid, campaignId: uuid, revision, ...timestamps })
  .openapi('LibraryRaceOut');

export const raceSelection = z
  .object({
    raceId: uuid.nullable().default(null),
    variantKey: key.nullable().default(null),
    lensIds: z.array(uuid).max(10).default([]),
    formKey: key.nullable().default(null),
  })
  .strict()
  .openapi('RaceSelection');
export const raceSourceSnapshot = z
  .object({
    id: uuid,
    campaignId: uuid,
    revision: z.number().int().min(-1),
    key,
    sourceId: uuid.nullable(),
    name: key,
    source: z.string().max(160).nullable(),
    sourceLocator: z.string().max(240).nullable(),
  })
  .strict()
  .openapi('RaceSourceSnapshot');
const ownedRaceName = z.string().trim().min(1).max(2000);
const ownedRaceForm = z
  .object({
    ...raceOption.shape,
    name: ownedRaceName,
    description: z.string().max(20000).nullable().default(null),
  })
  .strict()
  .openapi('OwnedRaceForm');
export const ownedRaceSnapshot = z
  .object({
    name: ownedRaceName,
    description: z.string().max(20000).nullable(),
    ...raceProfileShape,
    sources: z.array(raceSourceSnapshot).max(11),
    naturalForm: ownedRaceForm.optional(),
    // All selectable profiles are retained so a deleted source never erases an owned form.
    forms: z.array(ownedRaceForm).max(30).default([]),
  })
  .strict()
  .openapi('OwnedRaceSnapshot');
export const characterRace = z
  .object({
    selection: raceSelection.default({}),
    snapshot: ownedRaceSnapshot.nullable().default(null),
  })
  .strict()
  .openapi('CharacterRace');
export const HUMAN_RACE = characterRace.parse({ selection: {}, snapshot: null });
export type RaceProfile = z.infer<typeof raceProfile>;
export type RaceOption = z.infer<typeof raceOption>;
export type LibraryRaceCreate = z.infer<typeof libraryRaceCreate>;
export type LibraryRaceOut = z.infer<typeof libraryRaceOut>;
export type CharacterRace = z.infer<typeof characterRace>;
export type RaceSelection = z.infer<typeof raceSelection>;
export type RacialTrait = z.infer<typeof racialTrait>;
export type RacialSkill = z.infer<typeof racialSkill>;
