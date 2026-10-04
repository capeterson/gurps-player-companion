import type { EffectAwareCharacterDetail } from './useCharacterDetail.ts';

/** Local calculation blockers, with the owned entry names rather than source IDs. */
export function mechanicsUnavailableReason(character: EffectAwareCharacterDetail): string {
  const reasons: string[] = [];
  if (character.libraryEffectsKnown === false) {
    const entries = character.unavailableMechanics ?? [];
    reasons.push(
      entries.length
        ? `Linked rules are unavailable for ${entries.map((entry) => `${entry.kind} “${entry.name}”`).join(', ')}.`
        : 'Linked rules are unavailable.',
    );
  }
  if (character.houseRulesKnown === false) reasons.push('Campaign house rules are unavailable.');
  return reasons.join(' ');
}
