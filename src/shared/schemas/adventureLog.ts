import { z } from 'zod';
import { isoDate, isoTimestamp, uuid } from './common.ts';

export const visibilityEnum = z.enum(['campaign', 'private']);

export const xpAward = z.object({
  characterId: uuid,
  amount: z.number().int().min(-1000).max(1000),
});

export const adventureLogOut = z.object({
  id: uuid,
  campaignId: uuid,
  authorId: uuid,
  authorDisplayName: z.string(),
  sessionDate: isoDate,
  title: z.string().min(1).max(200),
  body: z.string().default(''),
  visibility: visibilityEnum,
  xpAwards: z.array(xpAward).default([]),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const adventureLogCreate = z.object({
  sessionDate: isoDate,
  title: z.string().min(1).max(200).trim(),
  body: z.string().max(200_000).default(''),
  visibility: visibilityEnum.default('campaign'),
  xpAwards: z.array(xpAward).max(50).default([]),
});

export const adventureLogUpdate = adventureLogCreate.partial();

export type AdventureLogOut = z.infer<typeof adventureLogOut>;
export type AdventureLogCreate = z.infer<typeof adventureLogCreate>;
export type AdventureLogUpdate = z.infer<typeof adventureLogUpdate>;
export type XpAward = z.infer<typeof xpAward>;
