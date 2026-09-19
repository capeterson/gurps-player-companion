/**
 * CombatTab — the live-gameplay surface, rendered as the first tab on
 * the character sheet. Pools, DR summary, maneuver, defenses, attacks,
 * and a roll log, all inline on `/characters/:id` so the player taps
 * between live combat and the editable sheet without a route hop.
 *
 * Full-width status, attacks, armor and tracker sections avoid independent
 * columns growing lopsided. Maneuver and defenses share one responsive row.
 *
 * `usePoolBumpers` is lifted here so the in-grid PoolsCard and the
 * floating top bar share one instance — a second instance would
 * race the first and silently drop a rapid tap (AGENTS.md S3/S10).
 */

import { useEffect, useRef, useState } from 'react';
import type { ArmorFacing } from '../../../../../shared/domain/armorDr.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { RollHistoryStrip } from '../RollHistoryStrip.tsx';
import { RollSheet } from '../RollSheet.tsx';
import type { RollRequest } from '../rollTypes.ts';
import { useCombatPatch } from '../useCombatPatch.ts';
import { usePoolBumpers } from '../usePoolBumpers.ts';
import { AttacksCard } from './AttacksCard.tsx';
import { DefensesCard } from './DefensesCard.tsx';
import { DrSummaryCard } from './DrSummaryCard.tsx';
import { FloatingPoolsBar } from './FloatingPoolsBar.tsx';
import { ManeuverCard } from './ManeuverCard.tsx';
import { PoolsCard } from './PoolsCard.tsx';
import { SoloTrackerCard } from './SoloTrackerCard.tsx';

export interface CombatTabProps {
  character: CharacterDetail;
  canWrite: boolean;
}

export function CombatTab({ character, canWrite }: CombatTabProps) {
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const [hitLocation, setHitLocation] = useState('torso');
  const [facing, setFacing] = useState<ArmorFacing | undefined>(undefined);
  const [showFloatingPools, setShowFloatingPools] = useState(false);
  const [floatingTop, setFloatingTop] = useState(64);
  const tabBoundaryRef = useRef<HTMLSpanElement>(null);
  const patchCombat = useCombatPatch(character);
  const bumpers = usePoolBumpers(character, canWrite, patchCombat);

  // The bar is absent while the sheet's tab list is still on screen. Once
  // this boundary (immediately after that list) passes under the app header,
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ManeuverCard character={character} canWrite={canWrite} patchCombat={patchCombat} />
        <DefensesCard
          character={character}
          openRoll={openRoll}
          hitLocation={hitLocation}
          facing={facing}
        />
      </div>
      <AttacksCard character={character} openRoll={openRoll} />
      <DrSummaryCard
        key={character.id}
        character={character}
        canWrite={canWrite}
        hpMax={bumpers.hpMax}
        bumpHp={bumpers.bumpHp}
        location={hitLocation}
        facing={facing}
        onLocationChange={setHitLocation}
        onFacingChange={setFacing}
      />
      <SoloTrackerCard characterId={character.id} canWrite={canWrite} />

      <RollHistoryStrip characterId={character.id} />

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
