import { z } from 'zod';
import { timestamps, uuid } from './common.ts';
export const effectDuration = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('rounds'), amount: z.number().int().min(1) }),
  z.object({ unit: z.literal('minutes'), amount: z.number().int().min(1) }),
  z.object({ unit: z.literal('hours'), amount: z.number().int().min(1) }),
  z.object({ unit: z.literal('indefinite') }),
]);
export const combatantConditionsField = z.array(z.string().min(1).max(80)).max(64);
export const encounterStatusEnum = z.enum(['active', 'ended']);
export const combatantKindEnum = z.enum(['pc', 'npc']);
export const combatantOut = z.object({
  id: uuid,
  encounterId: uuid,
  kind: combatantKindEnum,
  characterId: uuid.nullable(),
  name: z.string(),
  basicSpeed: z.number().nullable(),
  dx: z.number().int().nullable(),
  orderKey: z.number(),
  active: z.boolean(),
  maxHp: z.number().int().nullable(),
  currentHp: z.number().int().nullable(),
  move: z.number().int().nullable(),
  dodge: z.number().int().nullable(),
  dr: z.number().int().nullable(),
  maneuver: z.string().nullable(),
  conditions: combatantConditionsField,
  hiddenFromPlayers: z.boolean(),
  notes: z.string().nullable(),
  ...timestamps,
});
export const combatantCreate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pc'), characterId: uuid }),
  z.object({
    kind: z.literal('npc'),
    name: z.string().min(1).max(120),
    basicSpeed: z.number(),
    dx: z.number().int(),
    maxHp: z.number().int().min(1),
    currentHp: z.number().int().optional(),
    move: z.number().int().optional(),
    dodge: z.number().int().optional(),
    dr: z.number().int().optional(),
    maneuver: z.string().min(1).max(80).optional(),
    conditions: combatantConditionsField.optional(),
    active: z.boolean().optional(),
    hiddenFromPlayers: z.boolean().optional(),
    notes: z.string().optional(),
  }),
]);
export const combatantUpdate = z
  .object({
    name: z.string().min(1).max(120),
    basicSpeed: z.number(),
    dx: z.number().int(),
    orderKey: z.number(),
    active: z.boolean(),
    maxHp: z.number().int(),
    currentHp: z.number().int(),
    move: z.number().int().nullable(),
    dodge: z.number().int().nullable(),
    dr: z.number().int().nullable(),
    maneuver: z.string().nullable(),
    conditions: combatantConditionsField,
    hiddenFromPlayers: z.boolean(),
    notes: z.string().nullable(),
  })
  .partial();
export const effectOut = z.object({
  id: uuid,
  encounterId: uuid,
  targetCombatantId: uuid,
  casterCombatantId: uuid.nullable(),
  createdById: uuid,
  name: z.string(),
  duration: effectDuration,
  startedAtRound: z.number().int(),
  maintenanceCost: z.number().int().nullable(),
  lastMaintainedRound: z.number().int().nullable(),
  expiryAcknowledgedAtRound: z.number().int().nullable(),
  linkedCondition: z.string().nullable(),
  linkedTempEffectId: z.string().nullable(),
  notes: z.string().nullable(),
  ...timestamps,
});
export const effectCreate = z.object({
  targetCombatantId: uuid,
  casterCombatantId: uuid.optional(),
  name: z.string().min(1).max(120),
  duration: effectDuration,
  maintenanceCost: z.number().int().optional(),
  linkedCondition: z.string().optional(),
  linkedTempEffectId: z.string().optional(),
  notes: z.string().optional(),
});
export const effectUpdate = z
  .object({
    name: z.string(),
    duration: effectDuration,
    casterCombatantId: uuid.nullable(),
    maintenanceCost: z.number().int().nullable(),
    lastMaintainedRound: z.number().int().nullable(),
    expiryAcknowledgedAtRound: z.number().int().nullable(),
    linkedCondition: z.string().nullable(),
    linkedTempEffectId: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .partial();
export const encounterCreate = z.object({
  name: z.string().min(1).max(120).optional(),
  combatants: z.array(combatantCreate).max(200).default([]),
});
export const encounterUpdate = z
  .object({
    name: z.string().min(1).max(120),
    status: encounterStatusEnum,
    round: z.number().int().min(1),
    activeCombatantId: uuid.nullable(),
  })
  .partial();
export const advanceRequest = z.object({
  direction: z.enum(['next', 'previous']),
  expectedRound: z.number().int().min(1),
  expectedActiveCombatantId: uuid.nullable(),
});
export const encounterOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string(),
  status: encounterStatusEnum,
  round: z.number().int(),
  activeCombatantId: uuid.nullable(),
  version: z.number().int(),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  combatants: z.array(combatantOut),
  effects: z.array(effectOut),
  ...timestamps,
});
export const soloEffect = z.object({
  id: z.string(),
  name: z.string(),
  duration: effectDuration,
  startedAtRound: z.number().int(),
  maintenanceCost: z.number().int().optional(),
  lastMaintainedRound: z.number().int().optional(),
  expiryAcknowledgedAtRound: z.number().int().optional(),
});
export type EffectDuration = z.infer<typeof effectDuration>;
export type CombatantConditionsField = z.infer<typeof combatantConditionsField>;
export type EncounterOut = z.infer<typeof encounterOut>;
export type EncounterCreate = z.infer<typeof encounterCreate>;
export type EncounterUpdate = z.infer<typeof encounterUpdate>;
export type CombatantCreate = z.infer<typeof combatantCreate>;
export type CombatantUpdate = z.infer<typeof combatantUpdate>;
export type EffectCreate = z.infer<typeof effectCreate>;
export type EffectUpdate = z.infer<typeof effectUpdate>;
export type AdvanceRequest = z.infer<typeof advanceRequest>;
export type SoloEffect = z.infer<typeof soloEffect>;
