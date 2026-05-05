/**
 * Combat modal — the prototype's bottom-right FAB target.
 * Reuses the existing `/characters/:id/combat` PATCH endpoint, so
 * edits made here flow through the same query cache + warnings
 * regeneration path as the in-sheet CombatPanel. Posture/conditions
 * toggles update live; HP damage triggers the `flash` keyframe and
 * the `num-tween` pop on the big HP number.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { CombatStateOut } from '../../../../shared/schemas/combat.ts';
import { api } from '../../../lib/api.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { hpVarFor } from './hpColor.ts';
import { applyDetailToCache } from './useCharacterPatch.ts';

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
  const qc = useQueryClient();
  const toasts = useToasts();
  const combat = character.combat;
  const hp = combat?.currentHp ?? character.derived.hp;
  const fp = combat?.currentFp ?? character.derived.fp;
  const hpMax = character.derived.hp;
  const fpMax = character.derived.fp;
  const posture = combat?.posture ?? 'standing';
  const conditions = combat?.conditions ?? [];

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

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api<{ combat: CombatStateOut; character: CharacterDetail }>(
        `/characters/${character.id}/combat`,
        { method: 'PATCH', body },
      );
      applyDetailToCache(qc, character.id, res.character);
      return res;
    },
    onError: (err) => {
      toasts.push(`Combat update failed — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  function bumpHp(d: number) {
    if (!canWrite || hpMax <= 0) return;
    const next = Math.max(-hpMax * 4, Math.min(hpMax, hp + d));
    patch.mutate({ currentHp: next });
    if (d < 0) {
      setFlashHp(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashHp(false), 500);
    }
  }

  function bumpFp(d: number) {
    if (!canWrite || fpMax <= 0) return;
    const next = Math.max(-fpMax, Math.min(fpMax, fp + d));
    patch.mutate({ currentFp: next });
  }

  function setPosture(p: (typeof POSTURES)[number]) {
    if (!canWrite) return;
    patch.mutate({ posture: p });
  }

  function toggleCondition(c: string) {
    if (!canWrite) return;
    const next = conditions.includes(c)
      ? conditions.filter((x: string) => x !== c)
      : [...conditions, c];
    patch.mutate({ conditions: next });
  }

  const hpRatio = hpMax > 0 ? hp / hpMax : 0;
  const fpRatio = fpMax > 0 ? fp / fpMax : 0;
  const hpColor = hpVarFor(hpRatio);
  const fpColor = hpVarFor(fpRatio);
  const hpPct = Math.max(0, Math.min(1, hpRatio)) * 100;
  const fpPct = Math.max(0, Math.min(1, fpRatio)) * 100;

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
          <div className="hp-bar h-3.5">
            <div style={{ width: `${hpPct}%`, background: hpColor }} />
          </div>
          {canWrite && (
            <>
              <div className="mt-3 flex gap-1.5">
                <button type="button" className="bumper dmg" onClick={() => bumpHp(-5)}>
                  −5
                </button>
                <button type="button" className="bumper dmg" onClick={() => bumpHp(-1)}>
                  −1
                </button>
                <button type="button" className="bumper" onClick={() => bumpHp(+1)}>
                  +1
                </button>
                <button type="button" className="bumper" onClick={() => bumpHp(+5)}>
                  +5
                </button>
              </div>
              <button
                type="button"
                className="mt-2 w-full rounded-field border border-dashed border-border-strong py-1.5 text-xs text-muted transition hover:bg-base-200"
                onClick={() => patch.mutate({ currentHp: hpMax })}
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
          <div className="hp-bar h-2.5">
            <div style={{ width: `${fpPct}%`, background: fpColor }} />
          </div>
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
              <button
                key={p}
                type="button"
                className={`chip capitalize ${posture === p ? 'on' : ''}`}
                onClick={() => setPosture(p)}
                disabled={!canWrite}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-eyebrow">Conditions</span>
            <span className="num text-[10px] text-dim">{conditions.length} active</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CONDITIONS.map((c) => {
              const active = conditions.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  className={`chip ${active ? 'on' : ''}`}
                  onClick={() => toggleCondition(c)}
                  disabled={!canWrite}
                >
                  {active && <span className="chip-dot" aria-hidden="true" />}
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
