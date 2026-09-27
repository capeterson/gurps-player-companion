import type { WeaponData, WeaponMode } from '../schemas/inventory.ts';

export function weaponModes(data: WeaponData): Array<WeaponMode & { key: string }> {
  if (data.modes?.length) return data.modes;
  return [
    {
      key: 'primary',
      name: 'Primary',
      damage: data.damage,
      reach: data.reach,
      parry: data.parry,
      skill: data.skill,
      stRequired: data.stRequired,
      ranged: data.ranged,
      notes: data.notes,
    },
    ...(data.alternateModes ?? []).map((mode, index) => ({
      ...mode,
      key: mode.key ?? `alternate-${index + 1}`,
      skill: mode.skill ?? data.skill,
      reach: mode.reach ?? data.reach,
      parry: mode.parry ?? data.parry,
      stRequired: mode.stRequired ?? data.stRequired,
      ranged: mode.ranged === undefined ? data.ranged : mode.ranged,
    })),
  ];
}
/** Retain legacy fields as a primary-mode projection for existing consumers. */
export function normalizeWeaponData(data: WeaponData | null | undefined): WeaponData | null {
  if (!data) return null;
  const modes = weaponModes(data);
  const primary = modes[0];
  if (!primary) return data;
  return {
    ...data,
    damage: primary.damage,
    reach: primary.reach,
    parry: primary.parry,
    skill: primary.skill,
    stRequired: primary.stRequired,
    ranged: primary.ranged,
    notes: primary.notes,
    modes,
    alternateModes: modes.slice(1),
  };
}
