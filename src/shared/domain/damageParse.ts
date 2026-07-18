/**
 * Lenient parser for weapon damage strings (GURPS 4e notation, B269 /
 * B271), as stored free-text in `weaponData.damage` (see
 * `src/shared/schemas/inventory.ts`).
 *
 * Examples seen in the library data (bootstrap/sample_library.yaml):
 *   "sw+1 cut / thr+1 cr"
 *   "1d+2 cut"
 *   "thr imp"
 *   "2d(2) pi"
 *   "sw+2 cut / thr+1 imp"
 *
 * A damage string is one or more "modes" separated by `/`. Each mode is
 * either a ST-based multiplier (`thr`/`thrust` or `sw`/`swing`) or an
 * explicit dice count (`NdM`, e.g. `2d`, `1d-2`, `3d+1`), optionally
 * followed by a `+N`/`-N` add, an armor divisor in parens (`(2)`,
 * `(0.5)`), and a free-text damage type (`cut`, `cr`, `imp`, `pi`,
 * `pi+`, `pi++`, `burn`, `tox`, ...). The type is never validated
 * against a fixed list — it's passed through verbatim so homebrew
 * damage types round-trip cleanly.
 *
 * This parser is LENIENT BY CONTRACT: weapon damage is free text typed
 * by players and GMs. A mode that doesn't match the grammar is
 * dropped; a string that matches nothing returns []. It must never
 * throw on arbitrary user input.
 */

import type { DamageDice } from '../constants/damage.ts';

// `constants/damage.ts` already exports a "2d-1" / "1d" / "3d+2" formatter;
// reuse it instead of duplicating the logic here.
export { formatDamageDice } from '../constants/damage.ts';

export interface DamageMode {
  readonly base: 'thr' | 'sw' | DamageDice;
  readonly adds: number;
  readonly type: string | null;
  readonly armorDivisor: string | null;
  /** The original mode text (trimmed), kept for display/debugging. */
  readonly raw: string;
}

const THR_SW_RE = /^(thr|thrust|sw|swing)([+-]\d+)?$/i;
const EXPLICIT_DICE_RE = /^(\d+)d([+-]\d+)?$/i;
const ARMOR_DIVISOR_RE = /\(([^)]+)\)/;

/**
 * Parse a single trimmed mode token (one segment of a `/`-separated
 * damage spec) into a `DamageMode`, or `null` if it doesn't match the
 * grammar.
 */
function parseMode(rawMode: string): DamageMode | null {
  const raw = rawMode.trim();
  if (raw === '') return null;

  // Pull the armor divisor out first (it can appear anywhere in the string).
  const divisorMatch = raw.match(ARMOR_DIVISOR_RE);
  const armorDivisor = divisorMatch ? (divisorMatch[1] as string).trim() : null;
  const withoutDivisor = raw.replace(ARMOR_DIVISOR_RE, ' ').trim();

  const tokens = withoutDivisor.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const first = tokens[0] as string;
  const rest = tokens.slice(1).join(' ').trim();

  const thrSwMatch = first.match(THR_SW_RE);
  if (thrSwMatch) {
    const kind = (thrSwMatch[1] as string).toLowerCase();
    const base: 'thr' | 'sw' = kind.startsWith('thr') ? 'thr' : 'sw';
    const adds = thrSwMatch[2] ? Number.parseInt(thrSwMatch[2], 10) : 0;
    return {
      base,
      adds,
      type: rest || null,
      armorDivisor,
      raw,
    };
  }

  const diceMatch = first.match(EXPLICIT_DICE_RE);
  if (diceMatch) {
    const dice = Number.parseInt(diceMatch[1] as string, 10);
    const adds = diceMatch[2] ? Number.parseInt(diceMatch[2], 10) : 0;
    if (!Number.isFinite(dice) || dice <= 0) return null;
    return {
      base: { dice, adds },
      adds: 0,
      type: rest || null,
      armorDivisor,
      raw,
    };
  }

  // Doesn't match either grammar (e.g. "special", "see notes").
  return null;
}

/**
 * Parse a full weapon damage spec into its constituent modes. Modes
 * that don't parse are silently dropped; a spec that yields nothing
 * parseable returns an empty array (never throws).
 */
export function parseDamageSpec(raw: string): DamageMode[] {
  const modes: DamageMode[] = [];
  for (const segment of raw.split('/')) {
    const mode = parseMode(segment);
    if (mode) modes.push(mode);
  }
  return modes;
}

/**
 * Resolve a parsed `DamageMode` against a character's thrust/swing
 * dice, folding the mode's `+N`/`-N` add into the result. Explicit
 * dice modes (e.g. "2d(2) pi") pass through unchanged (their own adds
 * are already baked into `base`). Returns `null` only for an
 * unresolvable base, which should not occur for anything
 * `parseDamageSpec` produced.
 */
export function resolveDamage(
  mode: DamageMode,
  thrust: DamageDice,
  swing: DamageDice,
): { dice: DamageDice; type: string | null; armorDivisor: string | null } | null {
  let dice: DamageDice;
  if (mode.base === 'thr') {
    dice = { dice: thrust.dice, adds: thrust.adds + mode.adds };
  } else if (mode.base === 'sw') {
    dice = { dice: swing.dice, adds: swing.adds + mode.adds };
  } else if (typeof mode.base === 'object' && mode.base !== null) {
    dice = mode.base;
  } else {
    return null;
  }

  return { dice, type: mode.type, armorDivisor: mode.armorDivisor };
}

/**
 * Can an attack of this damage type target the vitals or an eye (B399)?
 * Per B399, only impaling (imp) and piercing (pi, pi-, pi+, pi++) attacks
 * may target the vitals, plus tight-beam burning attacks (e.g. a laser).
 * "Tight-beam" is not something that can be inferred from the free-text
 * `type` string alone (nothing in weapon data distinguishes a tight-beam
 * burn from an area burn), so — deliberately conservative — this helper
 * treats every "burn" mode as NOT vitals-capable rather than guessing.
 * Everything else (cut, cr, tox, homebrew types, ...) is also excluded.
 */
/**
 * Minimum basic damage after adds (B378): attacks that wound by edge or
 * point (cut/imp) always do at least 1 point of basic damage; anything
 * else (cr, burn, homebrew, untyped) can bottom out at 0.
 */
export function minBasicDamageFor(type: string | null): number {
  if (type == null) return 0;
  const normalized = type.trim().toLowerCase();
  return normalized.startsWith('cut') || normalized.startsWith('imp') ? 1 : 0;
}

export function canTargetVitals(type: string | null): boolean {
  if (type == null) return false;
  const normalized = type.trim().toLowerCase();
  return normalized.startsWith('imp') || normalized.startsWith('pi');
}
