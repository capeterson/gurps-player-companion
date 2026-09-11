/** Presentation choices shared by armor inspection and incoming damage. */
export const DAMAGE_TYPES = [
  ['cr', 'Crushing (cr)'],
  ['cut', 'Cutting (cut)'],
  ['imp', 'Impaling (imp)'],
  ['pi-', 'Small piercing (pi−)'],
  ['pi', 'Piercing (pi)'],
  ['pi+', 'Large piercing (pi+)'],
  ['pi++', 'Huge piercing (pi++)'],
  ['burn', 'Burning (burn)'],
  ['burn_tight', 'Tight-beam burning'],
  ['cor', 'Corrosion (cor)'],
  ['tox', 'Toxic (tox)'],
] as const;

export const ARMOR_DIVISORS = [
  ['', 'Normal DR'],
  ['2', 'Divisor (2) · half DR'],
  ['3', 'Divisor (3) · one-third DR'],
  ['5', 'Divisor (5) · one-fifth DR'],
  ['10', 'Divisor (10) · one-tenth DR'],
  ['100', 'Divisor (100)'],
  ['ignore', 'Ignores DR'],
] as const;

export function locationLabel(location: string): string {
  if (location === 'eye') return 'Eyes';
  const parts = location.split('_');
  const words =
    parts.length === 2 && ['left', 'right'].includes(parts[1] ?? '') ? [parts[1], parts[0]] : parts;
  return words.map((word) => (word ? word[0]?.toUpperCase() + word.slice(1) : '')).join(' ');
}
