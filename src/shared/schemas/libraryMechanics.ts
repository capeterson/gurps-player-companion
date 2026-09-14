import { z } from 'zod';
import { revision, uuid } from './common.ts';
import { traitEffect } from './effects.ts';
import { skillDefaults, skillPrerequisites, skillTechLevelPolicy } from './skillRules.ts';

export const ownedSkillRules = z.object({
  techLevelPolicy: skillTechLevelPolicy,
  prerequisites: skillPrerequisites,
  defaults: skillDefaults,
  groups: z.array(z.string().min(1).max(40)).max(100),
  tags: z.array(z.string().min(1).max(40)).max(100),
  /** Durable labels explicitly granted by the campaign owner for this copy. */
  gmPermissions: z.array(z.string().min(1).max(200)).max(50).default([]),
  /** Specialization for which the durable GM labels were granted. */
  gmPermissionSpecialization: z.string().trim().min(1).max(160).nullable().default(null),
});

/** Read-only owned declarations. Null effects mean unresolved; detached copies retain provenance. */
export const libraryMechanics = z.object({
  sourceId: uuid,
  campaignId: uuid.nullable(),
  sourceRevision: revision.nullable(),
  effects: z.array(traitEffect).nullable(),
  skillRules: ownedSkillRules.optional(),
  detached: z.boolean().optional(),
});
export type LibraryMechanics = z.infer<typeof libraryMechanics>;

export function ownedLibraryEffects(
  sourceId: string | null,
  campaignId: string | null,
  snapshot: unknown,
): z.infer<typeof traitEffect>[] | null {
  const parsed = libraryMechanics.safeParse(snapshot);
  if (!sourceId) return parsed.success && parsed.data.detached ? parsed.data.effects : [];
  if (!parsed.success || parsed.data.sourceId !== sourceId || parsed.data.campaignId !== campaignId)
    return null;
  return parsed.data.effects;
}
