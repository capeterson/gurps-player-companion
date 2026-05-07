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

/**
 * Powerstone metadata -- attached to an inventory item that stores
 * castable energy.  `currentEnergy` is mutable game state; recharges
 * are user-driven (manual + / -).  The item itself still carries the
 * gem's weight and cost via the existing inventory columns.
 *
 * The capacity refinement is essential: independent bounds let a
 * crafted payload set a 5-cap stone to 100 current energy, and the
 * cast dialog trusts `currentEnergy` as drawable energy without
 * cross-checking max.  Refinement is applied at the field level so
 * `inventoryItemCreate.partial()` (used as inventoryItemUpdate)
 * inherits it cleanly.
 */
export const powerstoneData = z
  .object({
    maxEnergy: z.number().int().min(1).max(100),
    currentEnergy: z.number().int().min(0).max(100),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => d.currentEnergy <= d.maxEnergy, {
    message: 'currentEnergy must not exceed maxEnergy',
    path: ['currentEnergy'],
  });

/**
 * Magic-item metadata -- attached to an inventory item that casts a
 * spell.  Three modes:
 *   `charged`     - a wand-style item with chargesCurrent of N uses
 *   `powered`     - draws from the user's FP/HP each cast (energyCost)
 *   `continuous`  - always-on, no per-use cost
 *
 * `spellSkillLevel` is fixed at the enchanter's skill at creation, so
 * casting from a magic item is independent of the user's own Magery.
 */
export const magicItemMode = z.enum(['charged', 'powered', 'continuous']);

export const magicItemData = z
  .object({
    spellName: z.string().min(1).max(160),
    spellSkillLevel: z.number().int().min(0).max(40),
    mode: magicItemMode,
    chargesMax: z.number().int().min(0).max(1000).nullable().optional(),
    chargesCurrent: z.number().int().min(0).max(1000).nullable().optional(),
    energyCost: z.number().int().min(0).max(99).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(
    // chargesCurrent must not exceed chargesMax when both are present.
    // Either field may legitimately be absent on `powered` / `continuous`
    // items; we only enforce the inequality when both are non-null.
    (d) => d.chargesCurrent == null || d.chargesMax == null || d.chargesCurrent <= d.chargesMax,
    {
      message: 'chargesCurrent must not exceed chargesMax',
      path: ['chargesCurrent'],
    },
  );

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
  powerstoneData: powerstoneData.nullable(),
  magicItemData: magicItemData.nullable(),
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
  powerstoneData: powerstoneData.nullable().optional(),
  magicItemData: magicItemData.nullable().optional(),
  libraryItemId: uuid.nullable().optional(),
});

export const inventoryItemUpdate = inventoryItemCreate.partial();

export type InventoryItemOut = z.infer<typeof inventoryItemOut>;
export type InventoryItemCreate = z.infer<typeof inventoryItemCreate>;
export type InventoryItemUpdate = z.infer<typeof inventoryItemUpdate>;
export type ArmorData = z.infer<typeof armorData>;
export type WeaponData = z.infer<typeof weaponData>;
export type PowerstoneData = z.infer<typeof powerstoneData>;
export type MagicItemData = z.infer<typeof magicItemData>;
export type MagicItemMode = z.infer<typeof magicItemMode>;
