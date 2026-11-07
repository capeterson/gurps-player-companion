/**
 * Dual-Weapon Attack bookkeeping for the Attacks card.
 *
 * Sources (Martial Arts PDF): Dual-Weapon Attack technique, MA83 ("If you
 * attack with two weapons at once, you're normally at -4 on each attack unless
 * you All-Out Attack ... To eliminate the extra -4 for the 'off' hand, you'll
 * also need Off-Hand Weapon Training"; "You're normally at -1 to defend against
 * a Dual-Weapon Attack (p. B417)"); Multiple Attacks, MA127 ("A fighter with
 * two ready weapons in different hands can use one of his attacks to attack
 * with both weapons at once. These two attacks are at an extra -4"); Off-Hand
 * Weapon Training perk, MA50; Handedness B14 and Ambidexterity B39. The -1 is
 * the penalty the target suffers when defending, not one on the attacker. The
 * B417 text itself was not readable.
 */
export const DUAL_WEAPON_ATTACK_PENALTY = -4;
/** Penalty the foe takes to defend against a Dual-Weapon Attack (MA83). */
export const DUAL_WEAPON_TARGET_DEFENSE_PENALTY = -1;
export const OFF_HAND_PENALTY = -4;

interface NamedTrait {
  readonly name: string;
  readonly variantName?: string | null;
}

export function hasAmbidexterity(traits: readonly NamedTrait[]): boolean {
  return traits.some((trait) => /\bambidextrous\b|\bambidexterity\b/i.test(trait.name));
}

/** Off-Hand Weapon Training is bought per skill, e.g. "Off-Hand Weapon Training (Rapier)". */
export function hasOffHandWeaponTraining(
  traits: readonly NamedTrait[],
  skillName: string,
): boolean {
  const skill = skillName.trim().toLowerCase();
  return traits.some((trait) => {
    if (!/off[- ]hand weapon training/i.test(trait.name)) return false;
    return `${trait.name} ${trait.variantName ?? ''}`.toLowerCase().includes(skill);
  });
}

export interface DualWeaponState {
  readonly active: boolean;
  /** Keys of the (at most two) chosen attack lines. */
  readonly picks: readonly string[];
  /** The chosen attack made with the off hand, when one must be named. */
  readonly offHand: string | null;
}

export const INITIAL_DUAL_WEAPON_STATE: DualWeaponState = {
  active: false,
  picks: [],
  offHand: null,
};

export function toggleDualWeapon(state: DualWeaponState): DualWeaponState {
  return state.active ? INITIAL_DUAL_WEAPON_STATE : { ...state, active: true };
}

/** Line keys are `${weaponId}|${mode}`; the two attacks need different weapons (MA127). */
export function weaponOfLine(key: string): string {
  return key.split('|')[0] ?? key;
}

/** Whether `key` could be chosen now: at most two, from different weapons. */
export function canPick(state: DualWeaponState, key: string): boolean {
  if (state.picks.includes(key)) return true;
  if (state.picks.length >= 2) return false;
  return !state.picks.some((pick) => weaponOfLine(pick) === weaponOfLine(key));
}

/** A third pick, or a second line of the same weapon, is refused rather than silently swapped in. */
export function togglePick(state: DualWeaponState, key: string): DualWeaponState {
  if (state.picks.includes(key)) {
    return {
      ...state,
      picks: state.picks.filter((pick) => pick !== key),
      offHand: state.offHand === key ? null : state.offHand,
    };
  }
  if (!canPick(state, key)) return state;
  return { ...state, picks: [...state.picks, key] };
}

export function chooseOffHand(state: DualWeaponState, key: string): DualWeaponState {
  return state.picks.includes(key) ? { ...state, offHand: key } : state;
}
