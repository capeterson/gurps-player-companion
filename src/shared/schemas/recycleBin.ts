import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';

/** Days a deleted character or campaign stays restorable before the nightly purge. */
export const RECYCLE_BIN_RETENTION_DAYS = 30;

export const recycledCharacter = z.object({
  id: uuid,
  name: z.string(),
  deletedAt: isoTimestamp,
  /** Earliest moment the item may be permanently removed (never earlier). */
  purgeAfter: isoTimestamp,
});

export const recycledCampaign = recycledCharacter.extend({
  /** Characters the campaign released when it was deleted. */
  characterCount: z.number().int().nonnegative(),
});

export const recycleBinOut = z.object({
  characters: z.array(recycledCharacter),
  campaigns: z.array(recycledCampaign),
});

export type RecycledCharacter = z.infer<typeof recycledCharacter>;
export type RecycledCampaign = z.infer<typeof recycledCampaign>;
export type RecycleBinOut = z.infer<typeof recycleBinOut>;
