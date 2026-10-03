import { type DamageDice, damageForSt } from '../constants/damage.ts';
import type { WeaponMode } from '../schemas/inventory.ts';

export function weaponStrengthKind(mode: Pick<WeaponMode, 'strengthKind' | 'skill' | 'ranged'>) {
  if (mode.strengthKind) return mode.strengthKind;
  if (/^crossbow(?:\W|$)/i.test(mode.skill ?? '')) return 'crossbow';
  if (/^bow(?:\W|$)/i.test(mode.skill ?? '')) return 'bow';
  return 'ordinary';
}

/** Preserve character flat damage adds after changing the ST-table base.
 * MinST caps ordinary melee damage; natural weapons remain uncapped (B270).
 * Bows/crossbows use purchased weapon ST for damage and range (B275). */
export function weaponDamageBases(
  mode: WeaponMode | undefined,
  effectiveSt: number,
  derivedThrust: DamageDice | null,
  derivedSwing: DamageDice | null,
) {
  if (!mode || !derivedThrust || !derivedSwing)
    return { thrust: derivedThrust, swing: derivedSwing };
  const kind = weaponStrengthKind(mode);
  const purchasedSt = mode.weaponSt ?? mode.stRequired;
  const st =
    kind === 'bow' || kind === 'crossbow'
      ? purchasedSt
      : kind === 'ordinary' && !mode.ranged && mode.stRequired != null && mode.stRequired > 0
        ? Math.min(effectiveSt, mode.stRequired * 3)
        : effectiveSt;
  if (st == null) return { thrust: null, swing: null };
  const original = damageForSt(effectiveSt);
  const selected = damageForSt(st);
  return {
    thrust: {
      ...selected.thrust,
      adds: selected.thrust.adds + derivedThrust.adds - original.thrust.adds,
    },
    swing: {
      ...selected.swing,
      adds: selected.swing.adds + derivedSwing.adds - original.swing.adds,
    },
  };
}
