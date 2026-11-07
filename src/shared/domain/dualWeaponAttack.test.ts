import { describe, expect, it } from 'bun:test';
import {
  type DualWeaponState,
  INITIAL_DUAL_WEAPON_STATE,
  canPick,
  chooseOffHand,
  hasAmbidexterity,
  hasOffHandWeaponTraining,
  toggleDualWeapon,
  togglePick,
  weaponOfLine,
} from './dualWeaponAttack.ts';

const active: DualWeaponState = { ...INITIAL_DUAL_WEAPON_STATE, active: true };

describe('Dual-Weapon Attack helpers', () => {
  it('detects Ambidexterity by trait name', () => {
    expect(hasAmbidexterity([{ name: 'Ambidexterity' }])).toBe(true);
    expect(hasAmbidexterity([{ name: 'Ambidextrous' }])).toBe(true);
    expect(hasAmbidexterity([{ name: 'Absolute Direction' }])).toBe(false);
    expect(hasAmbidexterity([])).toBe(false);
  });

  it('matches Off-Hand Weapon Training per skill', () => {
    const traits = [{ name: 'Off-Hand Weapon Training', variantName: 'Rapier' }];
    expect(hasOffHandWeaponTraining(traits, 'Rapier')).toBe(true);
    expect(hasOffHandWeaponTraining(traits, 'rapier')).toBe(true);
    expect(hasOffHandWeaponTraining(traits, 'Broadsword')).toBe(false);
    expect(
      hasOffHandWeaponTraining([{ name: 'Off-Hand Weapon Training (Rapier)' }], 'Rapier'),
    ).toBe(true);
    expect(hasOffHandWeaponTraining([{ name: 'Ambidexterity' }], 'Rapier')).toBe(false);
  });

  it('toggles the mode on and resets picks and off hand when turned off', () => {
    const on = toggleDualWeapon(INITIAL_DUAL_WEAPON_STATE);
    expect(on.active).toBe(true);
    const chosen = chooseOffHand(togglePick(togglePick(on, 'a'), 'b'), 'b');
    expect(toggleDualWeapon(chosen)).toEqual(INITIAL_DUAL_WEAPON_STATE);
  });

  it('refuses a third pick rather than replacing an earlier one', () => {
    const two = togglePick(togglePick(active, 'a'), 'b');
    expect(togglePick(two, 'c').picks).toEqual(['a', 'b']);
  });

  it('clears the off hand when that pick is removed', () => {
    const two = chooseOffHand(togglePick(togglePick(active, 'a'), 'b'), 'b');
    expect(two.offHand).toBe('b');
    const afterB = togglePick(two, 'b');
    expect(afterB.picks).toEqual(['a']);
    expect(afterB.offHand).toBeNull();
    expect(togglePick(two, 'a').offHand).toBe('b');
  });

  it('ignores an off hand that was not picked', () => {
    expect(chooseOffHand(togglePick(active, 'a'), 'z').offHand).toBeNull();
  });

  it('extracts the weapon id from a line key', () => {
    expect(weaponOfLine('w1|swing')).toBe('w1');
    expect(weaponOfLine('w1|primary')).toBe('w1');
    expect(weaponOfLine('plain')).toBe('plain');
  });

  it('refuses a second line of an already-picked weapon', () => {
    const one = togglePick(active, 'w1|thrust');
    expect(canPick(one, 'w1|swing')).toBe(false);
    expect(togglePick(one, 'w1|swing')).toBe(one);
    expect(canPick(one, 'w2|primary')).toBe(true);
    expect(togglePick(one, 'w2|primary').picks).toEqual(['w1|thrust', 'w2|primary']);
  });

  it('keeps picked lines selectable and refuses anything once two are chosen', () => {
    const two = togglePick(togglePick(active, 'w1|a'), 'w2|a');
    expect(canPick(two, 'w1|a')).toBe(true);
    expect(canPick(two, 'w3|a')).toBe(false);
    expect(togglePick(togglePick(two, 'w1|a'), 'w1|b').picks).toEqual(['w2|a', 'w1|b']);
  });
});
