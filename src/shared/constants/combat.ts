export const POSTURES = [
  'standing',
  'prone',
  'kneeling',
  'crawling',
  'sitting',
  'crouching',
  'lying',
] as const;

export type Posture = (typeof POSTURES)[number];

/**
 * Common conditions presented as one-tap chips in the combat tracker UI.
 * The data model accepts arbitrary strings; this list is just the seeded
 * shortcut set so players don't have to type the same words repeatedly.
 */
export const COMMON_CONDITIONS = [
  'shock',
  'stunned',
  'unconscious',
  'mortally_wounded',
  'reeling',
  'bleeding',
  'grappled',
  'restrained',
  'pinned',
  'on_fire',
  'poisoned',
  'sleeping',
] as const;

/**
 * The maneuvers a character may choose on their turn (GURPS 4e Basic
 * Set p. 363-366). `blurb` is a one-line summary of the mechanical
 * effect for display in the combat tracker UI.
 */
export const MANEUVERS = [
  { id: 'do_nothing', label: 'Do Nothing', blurb: 'No action; may still make free actions' },
  { id: 'move', label: 'Move', blurb: 'Move up to full Move; no attack' },
  {
    id: 'change_posture',
    label: 'Change Posture',
    blurb: 'Stand, kneel, or lie down; no step (crouching is a free action)',
  },
  { id: 'aim', label: 'Aim', blurb: 'Ranged accuracy bonus builds up while held' },
  { id: 'evaluate', label: 'Evaluate', blurb: '+1 to hit that foe in melee next turn (max +3)' },
  { id: 'attack', label: 'Attack', blurb: 'One attack at normal skill; step and defenses allowed' },
  {
    id: 'feint',
    label: 'Feint',
    blurb: "Quick Contest of skill to penalize the foe's next defense",
  },
  {
    id: 'all_out_attack',
    label: 'All-Out Attack',
    blurb: '+4 melee/+1 ranged to hit, or double attack; NO defenses; move half forward only',
  },
  {
    id: 'move_and_attack',
    label: 'Move and Attack',
    blurb: 'full move; attack at -4, skill capped at 9; no parry/retreat',
  },
  {
    id: 'all_out_defense',
    label: 'All-Out Defense',
    blurb: '+2 to one defense, or two defenses vs one attack',
  },
  {
    id: 'concentrate',
    label: 'Concentrate',
    blurb: 'Focus on a mental task; broken by damage or distraction',
  },
  { id: 'ready', label: 'Ready', blurb: 'Draw, reload, or otherwise prepare equipment' },
  { id: 'wait', label: 'Wait', blurb: 'Hold an action to trigger on a specified condition' },
] as const;

export type Maneuver = (typeof MANEUVERS)[number];
