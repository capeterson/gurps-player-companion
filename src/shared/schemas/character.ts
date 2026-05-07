import { z } from 'zod';
import { combatStateOut } from './combat.ts';
import { isoTimestamp, revision, uuid } from './common.ts';
import { inventoryItemOut } from './inventory.ts';
import { skillOut } from './skill.ts';
import { spellOut } from './spell.ts';
import { traitOut } from './trait.ts';

const attr = z.number().int().min(1).max(99);
const mod = z.number().int().min(-50).max(50);

export const characterAttributesShape = {
  st: attr.default(10),
  dx: attr.default(10),
  iq: attr.default(10),
  ht: attr.default(10),

  hpMod: mod.default(0),
  willMod: mod.default(0),
  perMod: mod.default(0),
  fpMod: mod.default(0),
  speedQuarterMod: mod.default(0),
  moveMod: mod.default(0),

  tempSt: mod.default(0),
  tempDx: mod.default(0),
  tempIq: mod.default(0),
  tempHt: mod.default(0),
  tempHpMod: mod.default(0),
  tempWillMod: mod.default(0),
  tempPerMod: mod.default(0),
  tempFpMod: mod.default(0),
  tempSpeedQuarterMod: mod.default(0),
  tempMoveMod: mod.default(0),
} as const;

export const characterIdentityShape = {
  name: z.string().min(1).max(120).trim(),
  playerName: z.string().max(120).trim().nullable().optional(),
  height: z.string().max(40).nullable().optional(),
  weight: z.string().max(40).nullable().optional(),
  age: z.number().int().min(0).max(10_000).nullable().optional(),
  appearance: z.string().max(20_000).nullable().optional(),
  techLevel: z.number().int().min(0).max(12).nullable().optional(),
  campaignId: uuid.nullable().optional(),
} as const;

export const characterCreate = z.object({
  ...characterIdentityShape,
  ...characterAttributesShape,
});

export const characterUpdate = characterCreate.partial();

export const dismissWarningRequest = z.object({
  code: z.string().min(1).max(80),
  dismissed: z.boolean(),
});

export const derivedStatsOut = z.object({
  effectiveSt: z.number().int(),
  effectiveDx: z.number().int(),
  effectiveIq: z.number().int(),
  effectiveHt: z.number().int(),
  hp: z.number().int(),
  will: z.number().int(),
  per: z.number().int(),
  fp: z.number().int(),
  basicSpeedQuarters: z.number().int(),
  basicSpeed: z.number(),
  basicMove: z.number().int(),
  dodge: z.number().int(),
  basicLift: z.number(),
});

export const pointBreakdownOut = z.object({
  attributes: z.number().int(),
  secondary: z.number().int(),
  advantages: z.number().int(),
  disadvantages: z.number().int(),
  quirks: z.number().int(),
  skills: z.number().int(),
  total: z.number().int(),
});

export const warningOut = z.object({
  code: z.string(),
  severity: z.enum(['warn', 'note']),
  message: z.string(),
});

export const encumbranceOut = z.object({
  level: z.number().int().min(0).max(4),
  label: z.enum(['None', 'Light', 'Medium', 'Heavy', 'X-Heavy']),
  moveMultiplier: z.number(),
  dodgePenalty: z.number().int(),
  playerWeightLbs: z.number(),
  basicLift: z.number(),
  ratio: z.number(),
});

export const characterListItem = z.object({
  id: uuid,
  ownerId: uuid,
  campaignId: uuid.nullable(),
  name: z.string(),
  playerName: z.string().nullable(),
  techLevel: z.number().int().nullable(),
  st: z.number().int(),
  dx: z.number().int(),
  iq: z.number().int(),
  ht: z.number().int(),
  updatedAt: isoTimestamp,
  revision,
});

export const characterDetail = z.object({
  /** Discriminator so the client can switch between full and minimal views. */
  view: z.literal('full').default('full'),
  id: uuid,
  ownerId: uuid,
  ...characterIdentityShape,
  ...characterAttributesShape,
  dismissedWarnings: z.array(z.string()),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  revision,
  derived: derivedStatsOut,
  points: pointBreakdownOut,
  encumbrance: encumbranceOut,
  warnings: z.array(warningOut),
  traits: z.array(traitOut),
  skills: z.array(skillOut),
  spells: z.array(spellOut),
  inventory: z.array(inventoryItemOut),
  combat: combatStateOut.nullable(),
});

/**
 * Minimal "readily apparent" view of a character. Returned to non-owner
 * non-author members of campaigns where `share_character_sheets=false`,
 * so other players can still see the public-facing identity bits without
 * accessing private stats / inventory / log entries.
 */
export const characterMinimalOut = z.object({
  view: z.literal('minimal'),
  id: uuid,
  ownerId: uuid,
  campaignId: uuid.nullable(),
  name: z.string().min(1),
  playerName: z.string().nullable(),
  height: z.string().nullable(),
  weight: z.string().nullable(),
  age: z.number().int().nullable(),
  appearance: z.string().nullable(),
  techLevel: z.number().int().nullable(),
  updatedAt: isoTimestamp,
});

/** Discriminated union of the two character payloads. */
export const characterDetailEnvelope = z.discriminatedUnion('view', [
  characterDetail,
  characterMinimalOut,
]);

export type CharacterCreate = z.infer<typeof characterCreate>;
export type CharacterUpdate = z.infer<typeof characterUpdate>;
export type CharacterDetail = z.infer<typeof characterDetail>;
export type CharacterMinimalOut = z.infer<typeof characterMinimalOut>;
export type CharacterDetailEnvelope = z.infer<typeof characterDetailEnvelope>;
export type CharacterListItem = z.infer<typeof characterListItem>;
export type DerivedStatsOut = z.infer<typeof derivedStatsOut>;
export type PointBreakdownOut = z.infer<typeof pointBreakdownOut>;
export type WarningOut = z.infer<typeof warningOut>;
export type EncumbranceOut = z.infer<typeof encumbranceOut>;
export type DismissWarningRequest = z.infer<typeof dismissWarningRequest>;
