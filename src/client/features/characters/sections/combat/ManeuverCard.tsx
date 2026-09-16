import { useState } from 'react';
import { MANEUVERS } from '../../../../../shared/constants/combat.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { ConditionChip } from '../../../../components/ui/ConditionChip.tsx';
import { FoldSection } from '../../../../components/ui/FoldSection.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../../hooks/useDraftField.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';

// Mirrors CharacterSheetPage's StatusPanel maneuver field exactly (S10:
// one draft-on-blur pattern, don't fork it) — same nullable-text parser
// and flash-bus key convention. The 3-line parser itself isn't shared
// anywhere, so it's duplicated rather than exported for one caller.
function nullableTextParser(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

export interface ManeuverCardProps {
  character: CharacterDetail;
  canWrite: boolean;
  patchCombat: (field: string, value: unknown) => Promise<void>;
}

export function ManeuverCard({ character, canWrite, patchCombat }: ManeuverCardProps) {
  const stored = character.combat?.maneuver ?? null;
  const [customOpen, setCustomOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const active = MANEUVERS.find(
    (m) => stored != null && m.label.toLowerCase() === stored.trim().toLowerCase(),
  );

  // serverValue is `?? ''`, not `?? null` — matches CharacterSheetPage's
  // StatusPanel maneuverField exactly. useDraftField's default `format`
  // is `String(v)`, which renders a literal null as the string "null";
  // an unedited custom-maneuver input would then show and could persist
  // that literal text.
  const maneuverField = useDraftField<string | null>({
    name: 'maneuver',
    serverValue: stored ?? '',
    parse: nullableTextParser,
    onSave: (v) => patchCombat('maneuver', v),
    flashKey: makeFlashKey('character_combat', character.id, 'maneuver'),
  });

  function pick(label: string) {
    if (!canWrite) return;
    const isActive = active?.label === label;
    void patchCombat('maneuver', isActive ? null : label);
    setChoosing(false);
  }

  return (
    <FoldSection
      preferenceKey={`${character.id}:maneuver`}
      title="Maneuver"
      summary={stored ?? 'None'}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{stored ?? 'No maneuver'}</span>
        {canWrite && (
          <div className="flex gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={choosing}
              onClick={() => setChoosing(!choosing)}
            >
              Change
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setCustomOpen((o) => !o);
                setChoosing(true);
              }}
            >
              {customOpen ? 'Presets' : 'Custom…'}
            </button>
          </div>
        )}
      </div>

      <div hidden={!choosing} className="pt-3">
        {customOpen && canWrite ? (
          <input
            aria-label="custom maneuver"
            className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm w-full`}
            placeholder="e.g. Ready — draw sword"
            {...maneuverField.inputProps}
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {MANEUVERS.map((m) => (
                <ConditionChip
                  key={m.id}
                  label={m.label}
                  active={active?.id === m.id}
                  onClick={() => pick(m.label)}
                  disabled={!canWrite}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {active && <p className="mt-2 text-xs text-base-content/70">{active.blurb}</p>}
    </FoldSection>
  );
}
