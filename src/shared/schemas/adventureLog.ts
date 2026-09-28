import { z } from 'zod';
import { isoDate, timestamps, uuid } from './common.ts';

export const visibilityEnum = z.enum(['campaign', 'private']);

export const xpAward = z.object({
  characterId: uuid,
  amount: z.number().int().min(-1000).max(1000),
});

export const xpAwardsField = z
  .array(xpAward)
  .max(500)
  .refine((awards) => new Set(awards.map((award) => award.characterId)).size === awards.length, {
    message: 'each character may receive only one award per entry',
  });
const pointsGained = z.number().int().min(0).max(1000).nullable();

export const adventureLogOut = z.object({
  id: uuid,
  campaignId: uuid,
  characterId: uuid.nullable().optional(),
  authorId: uuid,
  authorDisplayName: z.string(),
  sessionDate: isoDate,
  sessionNumber: z.number().int().min(0).nullable(),
  title: z.string().min(1).max(200),
  location: z.string().max(200).nullable(),
  body: z.string().default(''),
  visibility: visibilityEnum,
  pointsGained: pointsGained.optional(),
  // Older stored entries may contain repeated recipients; new writes forbid them.
  xpAwards: z.array(xpAward).default([]),
  ...timestamps,
});

export const adventureLogCreate = z.object({
  characterId: uuid
    .nullable()
    .optional()
    .describe(
      'Attach to an owned character for a private entry; null attaches to Campaign (shared). Omit on update to retain the attachment.',
    ),
  sessionDate: isoDate,
  sessionNumber: z.number().int().min(0).nullable().optional(),
  title: z.string().min(1).max(200).trim(),
  location: z.string().max(200).trim().nullable().optional(),
  body: z.string().max(200_000).default(''),
  visibility: visibilityEnum.default('campaign'),
  pointsGained: pointsGained
    .optional()
    .describe(
      'Points per recipient; omit for notes only, null clears an award. Increases character point caps, not the campaign starting target.',
    ),
  awardCharacterIds: z
    .array(uuid)
    .max(500)
    .nullable()
    .optional()
    .describe(
      'Recipient subset; null or omitted on create awards all current campaign characters. Amount-only edits retain the saved recipients. Only campaign owners may award other players characters.',
    ),
  xpAwards: xpAwardsField.default([]),
});

export const adventureLogUpdate = adventureLogCreate.partial();

export type AdventureLogOut = z.infer<typeof adventureLogOut>;
export type AdventureLogCreate = z.infer<typeof adventureLogCreate>;
export type AdventureLogUpdate = z.infer<typeof adventureLogUpdate>;
export type XpAward = z.infer<typeof xpAward>;
