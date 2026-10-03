import { mechanicsUnavailableReason } from './mechanicsUnavailableReason.ts';
import type { EffectAwareCharacterDetail } from './useCharacterDetail.ts';

export function MechanicsUnavailable({ character }: { character: EffectAwareCharacterDetail }) {
  return (
    <p className="alert alert-warning min-w-0 break-words" role="alert">
      {mechanicsUnavailableReason(character)} Calculated stats and rolls are paused until their
      definitions sync. Reconnect to load them; a missing library entry may need the GM's attention.
    </p>
  );
}
