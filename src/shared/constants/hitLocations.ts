/**
 * Canonical GURPS 4e hit locations.  Each value is also a valid string in
 * `armor.locations[]` on inventory items.  Aim penalties are reference data
 * for the combat tracker UI; they are not enforced server-side.
 *
 * Custom location strings are accepted in the data model — these are the
 * "well-known" defaults used by the library YAML schema.
 */

export const HIT_LOCATIONS = [
  'skull',
  'face',
  'neck',
  'torso',
  'vitals',
  'groin',
  'arm_left',
  'arm_right',
  'hand_left',
  'hand_right',
  'leg_left',
  'leg_right',
  'foot_left',
  'foot_right',
  'eye',
] as const;

export type HitLocation = (typeof HIT_LOCATIONS)[number];

/** Negative aim modifier per Basic Set p. B398-399 (used by combat UI). */
export const HIT_LOCATION_AIM_PENALTY: Record<HitLocation, number> = {
  skull: -7,
  face: -5,
  neck: -5,
  torso: 0,
  vitals: -3,
  groin: -3,
  arm_left: -2,
  arm_right: -2,
  hand_left: -4,
  hand_right: -4,
  leg_left: -2,
  leg_right: -2,
  foot_left: -4,
  foot_right: -4,
  eye: -9,
};
