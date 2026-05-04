import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';

export const armorData = z.object({
  /** Hit-location strings; well-known values are in shared/constants/hitLocations.ts. */
  locations: z.array(z.string().min(1).max(40)).default([]),
  dr: z.number().int().min(0).max(1000).default(0),
  drCrushing: z.number().int().min(0).max(1000).nullable().optional(),
  flexible: z.boolean().default(false),
  frontOnly: z.boolean().default(false),
  backOnly: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
});

export const weaponData = z.object({
  damage: z.string().max(160).optional(),
  reach: z.string().max(40).nullable().optional(),
  parry: z.string().max(40).nullable().optional(),
  stRequired: z.number().int().min(0).max(99).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const inventoryItemOut = z.object({
  id: uuid,
  characterId: uuid,
  name: z.string().min(1).max(160),
  quantity: z.number().int().min(0).max(1_000_000),
  weightLbs: z.number().min(0).max(1_000_000),
  cost: z.number().min(0).max(100_000_000_000),
  notes: z.string().max(20_000).nullable(),
  parentId: uuid.nullable(),
  externalLocation: z.string().max(160).nullable(),
  worn: z.boolean(),
  equipped: z.boolean(),
  isContainer: z.boolean(),
  hideawayCapacityLbs: z.number().min(0).max(1_000_000),
  weightReductionPercent: z.number().int().min(0).max(100),
  isArmor: z.boolean(),
  armor: armorData.nullable(),
  weaponData: weaponData.nullable(),
  libraryItemId: uuid.nullable(),
  /** Server-computed convenience field. */
  effectiveWeightLbs: z.number(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const inventoryItemCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  quantity: z.number().int().min(0).max(1_000_000).default(1),
  weightLbs: z.number().min(0).max(1_000_000).default(0),
  cost: z.number().min(0).max(100_000_000_000).default(0),
  notes: z.string().max(20_000).nullable().optional(),
  parentId: uuid.nullable().optional(),
  externalLocation: z.string().max(160).trim().nullable().optional(),
  worn: z.boolean().default(false),
  equipped: z.boolean().default(false),
  isContainer: z.boolean().default(false),
  hideawayCapacityLbs: z.number().min(0).max(1_000_000).default(0),
  weightReductionPercent: z.number().int().min(0).max(100).default(0),
  isArmor: z.boolean().default(false),
  armor: armorData.nullable().optional(),
  weaponData: weaponData.nullable().optional(),
  libraryItemId: uuid.nullable().optional(),
});

export const inventoryItemUpdate = inventoryItemCreate.partial();

export type InventoryItemOut = z.infer<typeof inventoryItemOut>;
export type InventoryItemCreate = z.infer<typeof inventoryItemCreate>;
export type InventoryItemUpdate = z.infer<typeof inventoryItemUpdate>;
export type ArmorData = z.infer<typeof armorData>;
export type WeaponData = z.infer<typeof weaponData>;
