import { z } from 'zod';
import { revision, uuid } from './common.ts';
import { traitEffect } from './effects.ts';

/** Read-only sync projection owned by a character child row. Null effects mean unresolved. */
export const libraryMechanics = z.object({
  sourceId: uuid,
  campaignId: uuid.nullable(),
  sourceRevision: revision.nullable(),
  effects: z.array(traitEffect).nullable(),
});
export type LibraryMechanics = z.infer<typeof libraryMechanics>;

export function ownedLibraryEffects(
  sourceId: string | null,
  campaignId: string | null,
  snapshot: unknown,
): z.infer<typeof traitEffect>[] | null {
  if (!sourceId) return [];
  const parsed = libraryMechanics.safeParse(snapshot);
  if (!parsed.success || parsed.data.sourceId !== sourceId || parsed.data.campaignId !== campaignId)
    return null;
  return parsed.data.effects;
}
