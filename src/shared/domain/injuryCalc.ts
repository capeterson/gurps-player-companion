/**
 * GURPS 4e incoming-damage resolution: DR subtraction (B378), armor
 * divisors (B102/B378), and wounding modifiers by damage type and hit
 * location (B379, B398-400).
 *
 * Deliberately partial, matching `damageParse.ts`'s lenient-by-contract
 * stance: the B379 core table plus the high-traffic location overrides
 * (skull/eye ×4, vitals ×3 for imp/pi, neck cr/cut, limb & extremity
 * caps). The skull's natural DR 2 (B400) is added on top of any armor
 * at that location. Not modeled: tight-beam burning ×2 vs vitals/eye
 * (can't be told apart from area burn in free text), huge-piercing vs
 * homebrew hybrids, diffuse/homogenous injury tolerance, and blunt
 * trauma. Unknown/homebrew damage types get ×1; unknown/custom
 * locations get the type's base multiplier.
 *
 * Pure TS (shared domain) — runs in Bun, browser, and service worker.
 */

import type { DrByLocationMap } from './armorDr.ts';

const LIMB_LOCATIONS = new Set(['arm_left', 'arm_right', 'leg_left', 'leg_right']);
const EXTREMITY_LOCATIONS = new Set(['hand_left', 'hand_right', 'foot_left', 'foot_right']);

function normalizeType(type: string | null): string {
  return type?.trim().toLowerCase() ?? '';
}

/** Base wounding multiplier by damage type (B379). Unknown types → 1. */
function baseMultiplier(type: string): number {
  switch (type) {
    case 'cut':
      return 1.5;
    case 'imp':
      return 2;
    case 'pi-':
      return 0.5;
    case 'pi+':
      return 1.5;
    case 'pi++':
      return 2;
    default:
      return 1; // cr, burn, cor, tox, pi, fat, homebrew, untyped
  }
}

/**
 * Wounding multiplier for a damage type landing on a hit location
 * (B379 base table + B398-400 location overrides).
 */
export function woundingMultiplier(type: string | null, location: string): number {
  const t = normalizeType(type);
  const isPiercing = t.startsWith('pi');

  // Skull and eye: ×4 for every type except toxic (B399-400).
  if (location === 'skull' || location === 'eye') {
    return t === 'tox' ? 1 : 4;
  }
  // Vitals: ×3 for impaling and all piercing (B399). Other types keep
  // their base multiplier (tight-beam burn ×3 not inferable, see module doc).
  if (location === 'vitals' && (t === 'imp' || isPiercing)) {
    return 3;
  }
  // Neck: crushing ×1.5, cutting ×2 (B399).
  if (location === 'neck') {
    if (t === 'cr') return 1.5;
    if (t === 'cut') return 2;
  }
  // Limbs and extremities: imp / pi+ / pi++ capped at ×1 (B399).
  if (LIMB_LOCATIONS.has(location) || EXTREMITY_LOCATIONS.has(location)) {
    if (t === 'imp' || t === 'pi+' || t === 'pi++') return 1;
  }
  return baseMultiplier(t);
}

/**
 * Parse an armor-divisor string into a positive number, or null for
 * missing/garbage. Accepts both the bare form stored by
 * `damageParse.ts` ("2", "0.5", "10") and the parenthesized book
 * notation players naturally type/copy into the incoming-damage
 * dialog ("(2)", "(0.5)").
 */
export function parseArmorDivisor(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw
    .trim()
    .replace(/^\((.+)\)$/, '$1')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  return value > 0 ? value : null;
}

export interface DamageApplication {
  /** Aggregated DR at the location (crushing override honored for 'cr'),
   *  plus the skull's natural DR 2 (B400) when the location is 'skull'. */
  readonly drAtLocation: number;
  /** DR after the armor divisor: floor(dr / divisor). A fractional
   *  divisor like (0.5) *increases* effective DR (B102). */
  readonly effectiveDr: number;
  readonly penetrating: number;
  readonly multiplier: number;
  /** floor(penetrating × multiplier), min 1 when anything penetrated (B379). */
  readonly injury: number;
}

/**
 * Resolve incoming basic damage against the character's own armor:
 * basic − DR(location)/divisor → penetrating × wounding multiplier =
 * injury (B378-379).
 */
export function applyDamage(
  basic: number,
  type: string | null,
  location: string,
  drMap: DrByLocationMap,
  armorDivisor: string | null | undefined,
): DamageApplication {
  const entry = drMap.get(location);
  const t = normalizeType(type);
  const armorDr = t === 'cr' && entry?.drCrushing != null ? entry.drCrushing : (entry?.dr ?? 0);
  // The skull is naturally DR 2 (B400), stacking with any helmet DR.
  const naturalDr = location === 'skull' ? 2 : 0;
  const drAtLocation = armorDr + naturalDr;

  const divisor = parseArmorDivisor(armorDivisor);
  const effectiveDr = divisor != null ? Math.floor(drAtLocation / divisor) : drAtLocation;

  const penetrating = Math.max(0, basic - effectiveDr);
  const multiplier = woundingMultiplier(type, location);
  const injury = penetrating > 0 ? Math.max(1, Math.floor(penetrating * multiplier)) : 0;

  return { drAtLocation, effectiveDr, penetrating, multiplier, injury };
}
