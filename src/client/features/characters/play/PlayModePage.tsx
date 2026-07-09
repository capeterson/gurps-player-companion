/**
 * Play Mode — a dedicated live-gameplay surface: pools, maneuver,
 * defenses, attacks, skills, and a session roll log, all reachable
 * without diving into the full editable sheet.
 *
 * Data loading mirrors CharacterSheetPage exactly (Dexie via
 * useCharacterDetail + campaigns + meId), because either page can be
 * the first surface a session opens.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { api } from '../../../lib/api.ts';
import { hpVarFor } from '../sections/hpColor.ts';
import { useCombatPatch } from '../sections/useCombatPatch.ts';
import { usePoolBumpers } from '../sections/usePoolBumpers.ts';
import { type CampaignSummary, useCharacterAccess } from '../useCharacterAccess.ts';
import { useCharacterDetail } from '../useCharacterDetail.ts';
import { useMirrorCampaigns } from '../useMirrorCampaigns.ts';
import { AttacksCard } from './AttacksCard.tsx';
import { DefensesCard } from './DefensesCard.tsx';
import { ManeuverCard } from './ManeuverCard.tsx';
import { PoolsCard } from './PoolsCard.tsx';
import { RollHistoryStrip } from './RollHistoryStrip.tsx';
import { RollSheet } from './RollSheet.tsx';
import { SkillsCard } from './SkillsCard.tsx';
import type { RollRequest } from './rollTypes.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function PlayModePage() {
  const { id = '' } = useParams<{ id: string }>();

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  const character = useCharacterDetail(id);

  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignSummary[]>('/campaigns'),
    enabled: !!me.data,
  });

  const access = useCharacterAccess(character, campaigns.data, me.data?.id);

  useMirrorCampaigns(campaigns.data);

  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);

  if (character === undefined) {
    return <p className="text-muted">Loading…</p>;
  }
  if (character === null) {
    return (
      <div className="space-y-3">
        <p className="text-error">Couldn't load character — not found locally.</p>
        <Link to="/characters" className="btn btn-sm btn-ghost">
          ← Back to characters
        </Link>
      </div>
    );
  }

  const { canWrite, isMinimal } = access;

  // Play Mode surfaces combat-relevant sheet data; the share-gated
  // minimal view has none of it, so bounce back to the sheet route
  // (which already knows how to render the minimal view itself).
  if (isMinimal) {
    return <Navigate to={`/characters/${character.id}`} replace />;
  }

  return (
    <PlayModeContent
      character={character}
      canWrite={canWrite}
      rollRequest={rollRequest}
      setRollRequest={setRollRequest}
    />
  );
}

/**
 * Split out so `usePoolBumpers`/`useCombatPatch` — which assume a
 * loaded, non-minimal `CharacterDetail` — can be called unconditionally
 * at the top of a component, matching every other hook's rules-of-hooks
 * requirement, instead of being gated behind the early returns above.
 */
function PlayModeContent({
  character,
  canWrite,
  rollRequest,
  setRollRequest,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  rollRequest: RollRequest | null;
  setRollRequest: (r: RollRequest | null) => void;
}) {
  const patchCombat = useCombatPatch(character);
  const bumpers = usePoolBumpers(character, canWrite, patchCombat);

  const hpRatio = bumpers.hpMax > 0 ? bumpers.hp / bumpers.hpMax : 0;
  const hpColor = hpVarFor(hpRatio);

  function openRoll(req: RollRequest) {
    setRollRequest(req);
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="label-eyebrow">Play Mode</p>
          <h1 className="truncate font-display text-3xl font-semibold">{character.name}</h1>
        </div>
        <Link to={`/characters/${character.id}`} className="btn btn-ghost btn-sm shrink-0">
          Full sheet
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PoolsCard
          character={character}
          canWrite={canWrite}
          patchCombat={patchCombat}
          bumpers={bumpers}
        />
        <ManeuverCard character={character} canWrite={canWrite} patchCombat={patchCombat} />
        <DefensesCard character={character} openRoll={openRoll} />
        <AttacksCard character={character} openRoll={openRoll} />
        <SkillsCard character={character} canWrite={canWrite} openRoll={openRoll} />
        <div className="md:col-span-2 xl:col-span-3">
          <RollHistoryStrip characterId={character.id} />
        </div>
      </div>

      {/* Sticky bottom bar, mobile only. Shares the SAME usePoolBumpers
          instance as PoolsCard (lifted above) — a second instance here
          would race the first and silently drop a rapid tap. */}
      <div className="play-bottom-bar md:hidden">
        <span className="num text-2xl font-bold" style={{ color: hpColor }}>
          {bumpers.hp}
        </span>
        <span className="num text-xs text-dim">/ {bumpers.hpMax}</span>
        {canWrite && (
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => bumpers.bumpHp(-1)}
              aria-label="HP -1"
            >
              HP −1
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => bumpers.bumpHp(+1)}
              aria-label="HP +1"
            >
              HP +1
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => bumpers.bumpFp(-1)}
              aria-label="FP -1"
            >
              FP −1
            </button>
          </div>
        )}
      </div>

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
