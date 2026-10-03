import { describe, expect, it } from 'bun:test';
import { damageForSt } from '../constants/damage.ts';
import { weaponMode } from '../schemas/inventory.ts';
import { weaponDamageBases } from './weaponDamage.ts';

describe('weaponDamageBases', () => {
  it('caps ordinary melee damage at three times MinST and preserves flat character adds', () => {
    const mode = weaponMode.parse({ name: 'Swing', damage: 'sw cut', stRequired: 6 });
    const derived = damageForSt(30);
    const result = weaponDamageBases(mode, 30, derived.thrust, {
      ...derived.swing,
      adds: derived.swing.adds + 1,
    });
    expect(result.swing).toEqual({
      ...damageForSt(18).swing,
      adds: damageForSt(18).swing.adds + 1,
    });
  });

  it('uses purchased bow ST for damage while preserving the wielder flat add', () => {
    const mode = weaponMode.parse({
      name: 'Bow',
      skill: 'Bow',
      damage: 'thr+1 imp',
      stRequired: 8,
    });
    const derived = damageForSt(15);
    const result = weaponDamageBases(
      mode,
      15,
      {
        ...derived.thrust,
        adds: derived.thrust.adds + 2,
      },
      derived.swing,
    );
    expect(result.thrust).toEqual({
      ...damageForSt(8).thrust,
      adds: damageForSt(8).thrust.adds + 2,
    });
  });

  it('does not apply the three-times-MinST cap to natural weapons', () => {
    const mode = weaponMode.parse({
      name: 'Claw',
      damage: 'sw cut',
      stRequired: 6,
      strengthKind: 'natural',
    });
    const derived = damageForSt(30);
    expect(weaponDamageBases(mode, 30, derived.thrust, derived.swing).swing).toEqual(derived.swing);
  });
});
