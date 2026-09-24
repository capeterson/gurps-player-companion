/**
 * CombatTab — the live-gameplay surface, rendered as a dock destination on
 * the character sheet. Attacks, defenses, armor, and the optional solo
 * tracker stay inline on `/characters/:id` so the player taps
 * between live combat and the editable sheet without a route hop.
 *
 * Full-width status, attacks, incoming attack, and tracker sections avoid
 * independent columns growing lopsided. Each section folds independently
 * on this device; incoming attack contains defenses, armor, and damage.
 *
 * Current HP/FP, posture, conditions, and maneuver live in the sheet-level
 * Current Status bar supplied by CombatStatusProvider. The provider owns the
 * one pool-bumper instance so every section shares the same queued intent.
 */

import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { AttacksCard } from './AttacksCard.tsx';
import { useCombatStatus } from './CombatStatusProvider.tsx';
import { DrSummaryCard } from './DrSummaryCard.tsx';
import { SoloTrackerCard } from './SoloTrackerCard.tsx';

export interface CombatTabProps {
  character: CharacterDetail;
  canWrite: boolean;
  experimentalTurnTracker?: boolean;
}

export function CombatTab({
  character,
  canWrite,
  experimentalTurnTracker = false,
}: CombatTabProps) {
  const { bumpers, openRoll } = useCombatStatus();

  return (
    <div className="space-y-4 pb-4">
      <AttacksCard character={character} openRoll={openRoll} />
      <DrSummaryCard
        key={character.id}
        character={character}
        canWrite={canWrite}
        hpMax={bumpers.hpMax}
        bumpHp={bumpers.bumpHp}
        openRoll={openRoll}
      />
      {experimentalTurnTracker && (
        <SoloTrackerCard characterId={character.id} canWrite={canWrite} />
      )}
    </div>
  );
}
