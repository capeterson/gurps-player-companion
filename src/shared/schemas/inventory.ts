import { z } from 'zod';
import { timestamps, uuid } from './common.ts';

/**
 * Per-damage-type DR overrides (GURPS B378, Martial Arts p. 100).
 * Keys are canonical GURPS damage types. When present and non-null,
 * the armor's DR against that type is this value instead of the base
 * `dr`. Unset / null entries fall through to `drCrushing` (for `cr`)
 * or `dr`.
 */
export const typedArmorDr = z
  .object({
    cut: z.number().int().min(0).max(1000).nullable().optional(),
    imp: z.number().int().min(0).max(1000).nullable().optional(),
    pi: z.number().int().min(0).max(1000).nullable().optional(),
    pi_minus: z.number().int().min(0).max(1000).nullable().optional(),
    pi_plus: z.number().int().min(0).max(1000).nullable().optional(),
    pi_pp: z.number().int().min(0).max(1000).nullable().optional(),
    burn: z.number().int().min(0).max(1000).nullable().optional(),
    corr: z.number().int().min(0).max(1000).nullable().optional(),
    fat: z.number().int().min(0).max(1000).nullable().optional(),
    tox: z.number().int().min(0).max(1000).nullable().optional(),
  })
  .strict();

export const armorData = z
  .object({
    /** Hit-location strings; well-known values are in shared/constants/hitLocations.ts. */
    locations: z.array(z.string().min(1).max(40)).default([]),
    /** Default DR against most damage types (B378). */
    dr: z.number().int().min(0).max(1000).default(0),
    /** Crushing-specific DR override — legacy field preserved for backward compat. */
    drCrushing: z.number().int().min(0).max(1000).nullable().optional(),
    /** Per-damage-type DR overrides (cut/imp/pi/burn/corr/fat/tox). */
    typedDr: typedArmorDr.default({}),
    flexible: z.boolean().default(false),
    frontOnly: z.boolean().default(false),
    backOnly: z.boolean().default(false),
    /**
     * Defense Bonus from Deflect enchantments (B287). Non-null marks the
     * armor as granting DB. The highest equipped DB covering the defended
     * location/facing stacks with shield DB and adds to Dodge, every Parry,
     * and Block; overlapping armor DB does not add together.
     */
    db: z.number().int().min(0).max(4).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

/**
 * Ranged stat block (GURPS 4e weapon table columns, B268-271).
 * Numeric where math consumes the value (`acc` feeds the Aim roll
 * preset, B364), free text where book notation is irregular
 * (`range` "100/150" or "x10/x15", `rof` "3~", `shots` "9+1(3)").
 */
export const rangedData = z
  .object({
    acc: z.number().int().min(0).max(20).nullable().optional(),
    range: z.string().max(40).nullable().optional(),
    rof: z.string().max(20).nullable().optional(),
    shots: z.string().max(20).nullable().optional(),
    bulk: z.number().int().min(-12).max(0).nullable().optional(),
    recoil: z.number().int().min(1).max(9).nullable().optional(),
  })
  .strict();

/**
 * One alternate attack mode on a weapon (Basic Set p. 271 weapon tables
 * list several rows per weapon: a rapier swings AND thrusts, a spear can
 * be thrown).  The weapon's own top-level `damage` / `reach` / `parry`
 * are the PRIMARY mode; these are the extra rows.
 *
 * `reach` / `parry` are optional per mode: an alternate that leaves them
 * unset inherits the weapon's primary values (a swing and a thrust with
 * the same reach only has to state it once).  Defence math always uses
 * the primary parry -- you parry with the weapon, not with one of its
 * damage lines.
 */
export const weaponMode = z
  .object({
    /** "Swing", "Thrust", "Thrown", ... */
    name: z.string().min(1).max(40).trim(),
    damage: z.string().max(160).optional(),
    reach: z.string().max(40).nullable().optional(),
    parry: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const weaponData = z
  .object({
    damage: z.string().max(160).optional(),
    reach: z.string().max(40).nullable().optional(),
    parry: z.string().max(40).nullable().optional(),
    stRequired: z.number().int().min(0).max(99).nullable().optional(),
    /**
     * Governing skill, matched by exact case-insensitive name against the
     * character's skills. A name string (not a skillId) because this same
     * object lives on campaign_library_items rows shared across
     * characters. Unset => combat falls back to fuzzy name matching on
     * the weapon's name (matchSkillForWeapon).
     */
    skill: z.string().max(160).trim().nullable().optional(),
    /**
     * Shield Defense Bonus (B287). Non-null marks the item as a shield:
     * when equipped, DB adds to Dodge/Parry/Block and enables the Block
     * row (a DB 0 shield still blocks, so presence — not magnitude — is
     * the marker).
     */
    db: z.number().int().min(0).max(4).nullable().optional(),
    /**
     * Optional hand/side for directional shield DB. A side-specific shield
     * protects the front and its matching side; null preserves legacy
     * omnidirectional behavior.
     */
    wieldedSide: z.enum(['left', 'right']).nullable().optional(),
    /** Ranged stat block; null/absent = melee-only. Melee fields coexist
     *  (a thrown knife has reach AND ranged). Damage is shared via the
     *  top-level `damage` field. */
    ranged: rangedData.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    /**
     * Extra attack modes beyond the primary one (swing/thrust/thrown).
     * Defaults to `[]`, so every pre-existing weapon row parses unchanged.
     */
    alternateModes: z.array(weaponMode).max(10).default([]),
  })
  .strict();

// Effective values are derived, never accepted at a persistence boundary. A
// valid base plus several valid enchantments can exceed the authoring caps.
const effectiveDr = z.number().int().min(0);
const effectiveDb = z.number().int().min(0);
export const effectiveTypedArmorDr = typedArmorDr.extend({
  cut: effectiveDr.nullable().optional(),
  imp: effectiveDr.nullable().optional(),
  pi: effectiveDr.nullable().optional(),
  pi_minus: effectiveDr.nullable().optional(),
  pi_plus: effectiveDr.nullable().optional(),
  pi_pp: effectiveDr.nullable().optional(),
  burn: effectiveDr.nullable().optional(),
  corr: effectiveDr.nullable().optional(),
  fat: effectiveDr.nullable().optional(),
  tox: effectiveDr.nullable().optional(),
});
export const effectiveArmorData = armorData.extend({
  dr: effectiveDr,
  drCrushing: effectiveDr.nullable().optional(),
  typedDr: effectiveTypedArmorDr,
  db: effectiveDb.nullable().optional(),
});
export const effectiveWeaponData = weaponData.extend({
  db: effectiveDb.nullable().optional(),
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
  .strict()
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

export const enchantmentApplicability = z.enum(['weapon', 'armor', 'shield', 'any']);
export const enchantmentEffectTarget = z.enum([
  'weapon_attack',
  'weapon_damage',
  'weapon_accuracy',
  'weapon_parry',
  'weapon_block',
  'armor_divisor',
  'dr',
  'db',
  'weight_reduction_percent',
  'skill',
]);
export const enchantmentEffect = z
  .object({
    target: enchantmentEffectTarget,
    value: z.number().int().min(-100).max(100),
    skillName: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .superRefine((effect, ctx) => {
    if (effect.target === 'skill' && !effect.skillName)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skillName'],
        message: "skillName is required when target='skill'",
      });
    if (effect.target !== 'skill' && effect.skillName)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skillName'],
        message: "skillName is only allowed when target='skill'",
      });
  });
export const enchantmentStackingPolicy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stack') }).strict(),
  z
    .object({
      kind: z.literal('highest'),
      key: z.string().trim().min(1).max(80),
    })
    .strict(),
]);
export const enchantmentLevel = z
  .object({
    level: z.number().int().min(1).max(100),
    label: z.string().trim().min(1).max(80).optional(),
    effects: z.array(enchantmentEffect).max(30).default([]),
  })
  .strict();
export const enchantmentLevels = z
  .array(enchantmentLevel)
  .max(20)
  .superRefine((levels, ctx) => {
    const seen = new Set<number>();
    for (const [index, entry] of levels.entries()) {
      if (seen.has(entry.level))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'level'],
          message: 'enchantment levels must be unique',
        });
      seen.add(entry.level);
    }
  });
export const enchantmentMechanics = z
  .object({
    applicability: enchantmentApplicability.default('any'),
    effects: z.array(enchantmentEffect).max(30).default([]),
    levels: enchantmentLevels.default([]),
    stackingPolicy: enchantmentStackingPolicy.default({ kind: 'stack' }),
  })
  .strict();

/**
 * One enchantment on an inventory item (B262 enchantment economy, the
 * veteran sheet's "Fortify +3" / "Deflect +2" / "Cornucopia" rows).
 * Legacy entries contain only the four original metadata fields. Structured
 * entries additionally carry a same-campaign definition link plus a complete
 * owned mechanics snapshot, so character calculation remains deterministic
 * offline and after source deletion.
 */
export const enchantmentRef = z
  .object({
    /** The enchantment's spell name, e.g. "Fortify". */
    spellName: z.string().min(1).max(160),
    /** Enchanter's skill when the item was made (GURPS item spells are
     * cast at a fixed level); null = unknown/unrecorded. */
    spellLevel: z.number().int().min(0).max(40).nullable().optional(),
    /** Free-text category label, e.g. "Fortify +3" or "Deflect +2". */
    category: z.string().max(80).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    level: z.number().int().min(1).max(100).nullable().optional(),
    definitionId: uuid.nullable().optional(),
    definitionRevision: z.number().int().min(0).nullable().optional(),
    definitionSource: z.string().max(40).nullable().optional(),
    mechanics: enchantmentMechanics.nullable().optional(),
  })
  .strict();

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
  .strict()
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

export const enchantmentContribution = z.object({
  /** Optional for compatibility with character details cached before this field existed. */
  instanceKey: z.string().min(1).max(240).optional(),
  sourceName: z.string().min(1).max(322),
  target: enchantmentEffectTarget,
  value: z.number(),
  active: z.boolean(),
  stackingKey: z.string().max(80).nullable(),
  suppressedByStacking: z.boolean(),
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
  armor: effectiveArmorData.nullable(),
  weaponData: effectiveWeaponData.nullable(),
  powerstoneData: powerstoneData.nullable(),
  magicItemData: magicItemData.nullable(),
  enchantments: z.array(enchantmentRef).max(50).default([]),
  /** Base persisted stat blocks are retained for auditable base-plus-effect UI. */
  baseArmor: armorData.nullable().optional(),
  baseWeaponData: weaponData.nullable().optional(),
  effectiveArmorDivisor: z.number().positive().nullable().optional(),
  effectiveWeightReductionPercent: z.number().min(0).max(100).optional(),
  enchantmentBreakdown: z.array(enchantmentContribution).optional(),
  libraryItemId: uuid.nullable(),
  /** Server-computed convenience field. */
  effectiveWeightLbs: z.number(),
  ...timestamps,
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
  enchantments: z.array(enchantmentRef).max(50).default([]),
  libraryItemId: uuid.nullable().optional(),
});

export const inventoryItemUpdate = inventoryItemCreate.partial();

export type InventoryItemOut = z.infer<typeof inventoryItemOut>;
export type InventoryItemCreate = z.infer<typeof inventoryItemCreate>;
export type InventoryItemUpdate = z.infer<typeof inventoryItemUpdate>;
export type TypedArmorDr = z.infer<typeof typedArmorDr>;
export type ArmorData = z.infer<typeof armorData>;
export type WeaponData = z.infer<typeof weaponData>;
export type WeaponMode = z.infer<typeof weaponMode>;
export type RangedData = z.infer<typeof rangedData>;
export type PowerstoneData = z.infer<typeof powerstoneData>;
export type MagicItemData = z.infer<typeof magicItemData>;
export type MagicItemMode = z.infer<typeof magicItemMode>;
export type EnchantmentRef = z.infer<typeof enchantmentRef>;
export type EnchantmentEffect = z.infer<typeof enchantmentEffect>;
export type EnchantmentEffectTarget = z.infer<typeof enchantmentEffectTarget>;
export type EnchantmentMechanics = z.infer<typeof enchantmentMechanics>;
export type EnchantmentApplicability = z.infer<typeof enchantmentApplicability>;
export type EnchantmentLevel = z.infer<typeof enchantmentLevel>;
export type EnchantmentStackingPolicy = z.infer<typeof enchantmentStackingPolicy>;
