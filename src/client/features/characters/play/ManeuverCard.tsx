import { useState } from 'react';
import { MANEUVERS } from '../../../../shared/constants/combat.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { ConditionChip } from '../../../components/ui/ConditionChip.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';

// Mirrors CharacterSheetPage's CombatPanel maneuver field exactly (S10:
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

  const active = MANEUVERS.find(
    (m) => stored != null && m.label.toLowerCase() === stored.trim().toLowerCase(),
  );

  const maneuverField = useDraftField<string | null>({
    name: 'maneuver',
    serverValue: stored,
    parse: nullableTextParser,
    onSave: (v) => patchCombat('maneuver', v),
    flashKey: makeFlashKey('character_combat', character.id, 'maneuver'),
  });

  function pick(label: string) {
    if (!canWrite) return;
    const isActive = active?.label === label;
    void patchCombat('maneuver', isActive ? null : label);
  }

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-baseline justify-between">
        <p className="label-eyebrow">Maneuver</p>
        {canWrite && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setCustomOpen((o) => !o)}
          >
            {customOpen ? 'Presets' : 'Custom…'}
          </button>
        )}
      </div>

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
          {active && <p className="text-xs text-base-content/70">{active.blurb}</p>}
          {!active && stored && <p className="text-xs text-base-content/70">Custom: {stored}</p>}
        </>
      )}
    </section>
  );
}
