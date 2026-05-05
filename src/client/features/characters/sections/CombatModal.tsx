/**
 * Combat modal — the prototype's bottom-right FAB target.
 * Edits flow through the local Dexie outbox (same path as the in-sheet
 * CombatPanel): each bumper / chip toggle calls `enqueueFieldPatch`,
 * which the orchestrator drains to the server. Posture/conditions
 * toggles update live; HP damage triggers the `flash` keyframe and
 * the `num-tween` pop on the big HP number.
 */

import { useEffect, useRef, useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { Bumper } from '../../../components/ui/Bumper.tsx';
import { ConditionChip } from '../../../components/ui/ConditionChip.tsx';
import { PoolMeter } from '../../../components/ui/PoolMeter.tsx';
import { getLocalDb } from '../../../db/dexie.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';
import { hpVarFor } from './hpColor.ts';

const POSTURES = [
  'standing',
  'crouching',
  'kneeling',
  'prone',
  'sitting',
  'crawling',
  'lying',
] as const;

const CONDITIONS = ['Stunned', 'Shock', 'Bleeding', 'Grappled', 'Reeling', 'Unconscious'] as const;

interface CombatModalProps {
  character: CharacterDetail;
  canWrite: boolean;
  onClose: () => void;
}

export function CombatModal({ character, canWrite, onClose }: CombatModalProps) {
  const combat = character.combat;
  const hp = combat?.currentHp ?? character.derived.hp;
  const fp = combat?.currentFp ?? character.derived.fp;
  const hpMax = character.derived.hp;
  const fpMax = character.derived.fp;
  const posture = combat?.posture ?? 'standing';
  const conditions = combat?.conditions ?? [];

  // Latest-intended values for HP/FP, updated synchronously on every
  // bumper tap. Without these refs, two taps that fire before React
  // commits a new `combat` prop would read the same render-time `hp`
  // and enqueue duplicate patches, dropping the second tap. The refs
  // resync from the prop whenever Dexie surfaces a new value.
  const hpRef = useRef(hp);
  const fpRef = useRef(fp);
  useEffect(() => {
    hpRef.current = hp;
  }, [hp]);
  useEffect(() => {
    fpRef.current = fp;
  }, [fp]);

  const [flashHp, setFlashHp] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // Close on Escape — mirrors any standard modal behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Combat is 1:1 keyed by characterId. If a local row doesn't exist
  // yet, materialize a default in Dexie so the per-field patch has a
  // row to update; the orchestrator's whole-body upsert handles the
  // server side. Mirrors CharacterSheetPage's CombatPanel.patchCombat.
  async function patchCombat(field: string, value: unknown) {
    const db = getLocalDb();
    const existing = await db.characterCombat.get(character.id);
    if (!existing) {
      await db.characterCombat.put({
        id: character.id,
        characterId: character.id,
        currentHp: character.derived.hp,
        currentFp: character.derived.fp,
        conditions: [],
        maneuver: null,
        posture: 'standing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: -1,
      });
    }
    await enqueueFieldPatch({
      entityClass: 'character_combat',
      entityId: character.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: field,
      flashKey: makeFlashKey('character_combat', character.id, field),
      characterId: character.id,
    });
  }

  function bumpHp(d: number) {
    if (!canWrite || hpMax <= 0) return;
    // Compose against the latest-intended value (hpRef), not the
    // render snapshot, so rapid same-frame taps each compound
    // instead of overwriting the prior tap.
    const next = Math.max(-hpMax * 4, Math.min(hpMax, hpRef.current + d));
    hpRef.current = next;
    void patchCombat('currentHp', next);
    if (d < 0) {
      setFlashHp(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashHp(false), 500);
    }
  }

  function bumpFp(d: number) {
    if (!canWrite || fpMax <= 0) return;
    const next = Math.max(-fpMax, Math.min(fpMax, fpRef.current + d));
    fpRef.current = next;
    void patchCombat('currentFp', next);
  }

  function setPosture(p: (typeof POSTURES)[number]) {
    if (!canWrite) return;
    void patchCombat('posture', p);
  }

  function toggleCondition(c: string) {
    if (!canWrite) return;
    const next = conditions.includes(c)
      ? conditions.filter((x: string) => x !== c)
      : [...conditions, c];
    void patchCombat('conditions', next);
  }

  const hpRatio = hpMax > 0 ? hp / hpMax : 0;
  const fpRatio = fpMax > 0 ? fp / fpMax : 0;
  const hpColor = hpVarFor(hpRatio);
  const fpColor = hpVarFor(fpRatio);

  return (
    <div
      className="modal-back"
      // biome-ignore lint/a11y/useSemanticElements: a fixed positioned <dialog> with showModal()
      // is a heavier lift; this aria-roled div is functionally equivalent and the Escape key
      // is wired up via a global keydown listener above.
      role="dialog"
      aria-modal="true"
      aria-label="Combat tracker"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div
        className="card relative w-[24rem] max-w-[calc(100vw-3rem)] max-h-[calc(100vh-3rem)] overflow-auto p-5 shadow-arcane-lg"
        style={{ background: 'var(--color-base-100)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="label-eyebrow">Combat</p>
            <h2 className="font-display text-2xl font-semibold">{character.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={`card mb-3 p-4 ${flashHp ? 'flash' : ''}`}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label-eyebrow">Hit Points</span>
            <span className="num text-xs text-dim">
              max {hpMax} · reeling at {Math.ceil(hpMax / 3)}
            </span>
          </div>
          <div className="mb-3 flex items-baseline gap-1.5">
            <span
              className={`num font-bold leading-none ${flashHp ? 'num-tween' : ''}`}
              style={{ fontSize: '4.5rem', color: hpColor, letterSpacing: '-0.03em' }}
            >
              {hp}
            </span>
            <span className="num text-2xl text-dim">/ {hpMax}</span>
          </div>
          <PoolMeter current={hp} max={hpMax} tone="hp" height="lg" ariaLabel="Hit points" />
          {canWrite && (
            <>
              <div className="mt-3 flex gap-1.5">
                <Bumper tone="dmg" onClick={() => bumpHp(-5)} ariaLabel="HP -5">
                  −5
                </Bumper>
                <Bumper tone="dmg" onClick={() => bumpHp(-1)} ariaLabel="HP -1">
                  −1
                </Bumper>
                <Bumper tone="heal" onClick={() => bumpHp(+1)} ariaLabel="HP +1">
                  +1
                </Bumper>
                <Bumper tone="heal" onClick={() => bumpHp(+5)} ariaLabel="HP +5">
                  +5
                </Bumper>
              </div>
              <button
                type="button"
                className="mt-2 w-full rounded-field border border-dashed border-border-strong py-1.5 text-xs text-muted transition hover:bg-base-200"
                onClick={() => {
                  hpRef.current = hpMax;
                  void patchCombat('currentHp', hpMax);
                }}
              >
                Reset to {hpMax}
              </button>
            </>
          )}
        </div>

        <div className="card mb-3 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-eyebrow">Fatigue</span>
            <div className="flex items-baseline gap-1">
              <span
                className="num font-bold leading-none"
                style={{ fontSize: '2rem', color: fpColor }}
              >
                {fp}
              </span>
              <span className="num text-sm text-dim">/ {fpMax}</span>
            </div>
          </div>
          <PoolMeter current={fp} max={fpMax} tone="fp" height="md" ariaLabel="Fatigue points" />
          {canWrite && (
            <div className="mt-2.5 flex gap-1.5">
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(-5)}>
                −5
              </button>
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(-1)}>
                −1
              </button>
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(+1)}>
                +1
              </button>
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(+5)}>
                +5
              </button>
            </div>
          )}
        </div>

        <div className="card mb-3 p-3">
          <p className="label-eyebrow mb-2">Posture</p>
          <div className="flex flex-wrap gap-1">
            {POSTURES.map((p) => (
              <ConditionChip
                key={p}
                label={p}
                active={posture === p}
                onClick={() => setPosture(p)}
                disabled={!canWrite}
                className="capitalize"
              />
            ))}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-eyebrow">Conditions</span>
            <span className="num text-[10px] text-dim">{conditions.length} active</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CONDITIONS.map((c) => (
              <ConditionChip
                key={c}
                label={c}
                active={conditions.includes(c)}
                onClick={() => toggleCondition(c)}
                disabled={!canWrite}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
