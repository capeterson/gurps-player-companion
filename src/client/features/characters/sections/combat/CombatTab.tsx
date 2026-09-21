/**
 * CombatTab — the live-gameplay surface, rendered as the first tab on
 * the character sheet. Pools, DR summary, maneuver, defenses, and attacks
 * stay inline on `/characters/:id` so the player taps
 * between live combat and the editable sheet without a route hop.
 *
 * Full-width status, attacks, armor and tracker sections avoid independent
 * columns growing lopsided. Each section folds independently on this device.
 *
 * `usePoolBumpers` is lifted here so the in-grid PoolsCard and the
 * floating top bar share one instance — a second instance would
 * race the first and silently drop a rapid tap (AGENTS.md S3/S10).
 */

import { useEffect, useRef, useState } from 'react';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { RollSheet } from '../RollSheet.tsx';
import type { RollRequest } from '../rollTypes.ts';
import { useCombatPatch } from '../useCombatPatch.ts';
import { usePoolBumpers } from '../usePoolBumpers.ts';
import { AttacksCard } from './AttacksCard.tsx';
import { DrSummaryCard } from './DrSummaryCard.tsx';
import { FloatingPoolsBar } from './FloatingPoolsBar.tsx';
import { ManeuverCard } from './ManeuverCard.tsx';
import { PoolsCard } from './PoolsCard.tsx';
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
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const [showFloatingPools, setShowFloatingPools] = useState(false);
  const [floatingTop, setFloatingTop] = useState(64);
  const tabBoundaryRef = useRef<HTMLSpanElement>(null);
  const patchCombat = useCombatPatch(character);
  const bumpers = usePoolBumpers(character, canWrite, patchCombat);

  // Once the Combat content boundary passes under the app header,
  // the pool controls become a fixed top companion for the long Combat tab.
  useEffect(() => {
    const update = () => {
      const boundary = tabBoundaryRef.current;
      const appHeaderBottom =
        document.querySelector('header')?.getBoundingClientRect().bottom ?? 64;
      setFloatingTop(appHeaderBottom);
      setShowFloatingPools(
        boundary != null && boundary.getBoundingClientRect().top < appHeaderBottom,
      );
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  function openRoll(req: RollRequest) {
    setRollRequest(req);
  }

  return (
    <div className="space-y-4 pb-4">
      <span ref={tabBoundaryRef} aria-hidden="true" className="block h-px" />
      {showFloatingPools && (
        <FloatingPoolsBar
          character={character}
          bumpers={bumpers}
          canWrite={canWrite}
          top={floatingTop}
        />
      )}
      <PoolsCard
        character={character}
        canWrite={canWrite}
        patchCombat={patchCombat}
        bumpers={bumpers}
        openRoll={openRoll}
      />
      <ManeuverCard character={character} canWrite={canWrite} patchCombat={patchCombat} />
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

      {rollRequest && (
        <RollSheet
          request={rollRequest}
          characterId={character.id}
          onClose={() => setRollRequest(null)}
        />
      )}
    </div>
  );
}
