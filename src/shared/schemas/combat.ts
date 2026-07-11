import { z } from 'zod';
import { POSTURES } from '../constants/combat.ts';
import { timestamps, uuid } from './common.ts';

export const postureEnum = z.enum(POSTURES);

export const combatStateOut = z.object({
  id: uuid,
  characterId: uuid,
  currentHp: z.number().int(),
  currentFp: z.number().int(),
  conditions: z.array(z.string().min(1).max(80)),
  maneuver: z.string().max(80).nullable(),
  posture: postureEnum,
  ...timestamps,
});

export const combatStateUpdate = z
  .object({
    currentHp: z.number().int().min(-1000).max(1000),
    currentFp: z.number().int().min(-1000).max(1000),
    conditions: z.array(z.string().min(1).max(80)).max(64),
    maneuver: z.string().max(80).trim().nullable(),
    posture: postureEnum,
  })
  .partial();

export type CombatStateOut = z.infer<typeof combatStateOut>;
export type CombatStateUpdate = z.infer<typeof combatStateUpdate>;
