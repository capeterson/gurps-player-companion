import { useEffect, useMemo, useState } from 'react';
import { MANA_LEVEL_LABELS } from '../../../../shared/constants/magic.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut, PowerstoneData } from '../../../../shared/schemas/inventory.ts';
import type { SpellOut } from '../../../../shared/schemas/spell.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { useDialogState } from '../../../hooks/useDialogState.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

interface CastSpellDialogProps {
  character: CharacterDetail;
  spell: SpellOut;
  /** 'cast' pays the casting cost; 'maintain' pays the per-interval
   * maintenance cost to keep an already-running spell up. */
  mode?: 'cast' | 'maintain';
  onClose(): void;
}

interface Allocation {
  fromFp: number;
  fromHp: number;
  /** Map of inventory item id → energy drawn from that powerstone. */
  fromStones: Map<string, number>;
}

function emptyAllocation(): Allocation {
  return { fromFp: 0, fromHp: 0, fromStones: new Map() };
}

function totalAllocation(a: Allocation): number {
  let stoneTotal = 0;
  for (const v of a.fromStones.values()) stoneTotal += v;
  return a.fromFp + a.fromHp + stoneTotal;
}

/**
 * Auto-pick a sensible default allocation: FP first, then a powerstone,
 * HP only as last resort.  A single casting may draw from at most ONE
 * powerstone (B481 / M69), so the suggestion picks the fullest stone
 * rather than splitting across several.  The player can redistribute by
 * editing the per-source numbers.
 */
function suggestAllocation(
  cost: number,
  fpAvailable: number,
  hpAvailable: number,
  stones: readonly InventoryItemOut[],
): Allocation {
  const out = emptyAllocation();
  let remaining = cost;
  if (remaining <= 0) return out;

  const drawFromFp = Math.min(remaining, Math.max(0, fpAvailable));
  out.fromFp = drawFromFp;
  remaining -= drawFromFp;

  if (remaining > 0) {
    let best: InventoryItemOut | null = null;
    let bestEnergy = 0;
    for (const stone of stones) {
      const have = stone.powerstoneData?.currentEnergy ?? 0;
      if (have > bestEnergy) {
        best = stone;
        bestEnergy = have;
      }
    }
    if (best) {
      const draw = Math.min(remaining, bestEnergy);
      out.fromStones.set(best.id, draw);
      remaining -= draw;
    }
  }

  if (remaining > 0) {
    const drawFromHp = Math.min(remaining, Math.max(0, hpAvailable));
    out.fromHp = drawFromHp;
    remaining -= drawFromHp;
  }
  return out;
}

export function CastSpellDialog({
  character,
  spell,
  mode = 'cast',
  onClose,
}: CastSpellDialogProps) {
  const ref = useDialogState(true);
  const toasts = useToasts();

  const maintaining = mode === 'maintain';
  const seedCost = maintaining ? (spell.effectiveMaintenanceCost ?? 0) : spell.effectiveCost;
  // Energy actually spent this casting.  Seeded from the discounted
  // cost but editable: a critical success costs 0, an ordinary failure
  // costs 1, a critical failure costs the full base cost (B236), and
  // Area / Missile spells scale their cost per casting.
  const [energyRaw, setEnergyRaw] = useState(String(seedCost));
  const cost = clamp(Number(energyRaw), 0, 999);
  // A powerstone only powers a spell if the caster is touching it
  // (B481), so stones stored elsewhere (external location) don't count.
  const stones = useMemo(
    () =>
      character.inventory.filter(
        (i): i is InventoryItemOut & { powerstoneData: PowerstoneData } =>
          i.powerstoneData != null && i.externalLocation == null,
      ),
    [character.inventory],
  );
  const fpAvailable = character.combat?.currentFp ?? character.derived.fp;
  const hpAvailable = character.combat?.currentHp ?? character.derived.hp;

  const [alloc, setAlloc] = useState<Allocation>(() =>
    suggestAllocation(cost, fpAvailable, hpAvailable, stones),
  );
  const [casting, setCasting] = useState(false);

  // Re-seed the editable amount if the discounted cost itself shifts
  // (e.g. user edits base cost while the dialog is open in another tab).
  useEffect(() => {
    setEnergyRaw(String(seedCost));
  }, [seedCost]);

  // Re-suggest the allocation whenever the amount to spend or the pool
  // sizes shift.
  useEffect(() => {
    setAlloc(suggestAllocation(cost, fpAvailable, hpAvailable, stones));
  }, [cost, fpAvailable, hpAvailable, stones]);

  const allocated = totalAllocation(alloc);
  const remaining = cost - allocated;
  const overspent = allocated > cost;
  // One casting can draw from at most one powerstone (B481 / M69).
  // Warn-don't-block, matching the app's rules philosophy.
  const stonesUsed = [...alloc.fromStones.values()].filter((v) => v > 0).length;

  function setFp(next: number) {
    setAlloc((a) => ({ ...a, fromFp: clamp(next, 0, fpAvailable) }));
  }
  function setHp(next: number) {
    setAlloc((a) => ({ ...a, fromHp: clamp(next, 0, hpAvailable) }));
  }
  function setStone(id: string, next: number, max: number) {
    setAlloc((a) => {
      const copy = new Map(a.fromStones);
      const v = clamp(next, 0, max);
      if (v === 0) copy.delete(id);
      else copy.set(id, v);
      return { ...a, fromStones: copy };
    });
  }

  async function performCast() {
    if (cost > 0 && allocated !== cost) {
      toasts.push(`Allocate exactly ${cost} energy (currently ${allocated}).`, { kind: 'error' });
      return;
    }
    setCasting(true);
    try {
      // FP / HP go through the combat-state field patch path.  We need
      // a local combat row to patch, so materialize one if missing
      // (mirrors CombatPanel's first-edit upsert).
      if (alloc.fromFp > 0 || alloc.fromHp > 0) {
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
        if (alloc.fromFp > 0) {
          await enqueueFieldPatch({
            entityClass: 'character_combat',
            entityId: character.id,
            fieldPath: 'currentFp',
            attemptedValue: fpAvailable - alloc.fromFp,
            humanName: 'FP',
            flashKey: makeFlashKey('character_combat', character.id, 'currentFp'),
            characterId: character.id,
          });
        }
        if (alloc.fromHp > 0) {
          await enqueueFieldPatch({
            entityClass: 'character_combat',
            entityId: character.id,
            fieldPath: 'currentHp',
            attemptedValue: hpAvailable - alloc.fromHp,
            humanName: 'HP',
            flashKey: makeFlashKey('character_combat', character.id, 'currentHp'),
            characterId: character.id,
          });
        }
      }
      // Each stone we drew from gets its own patch.  Whole-jsonb so the
      // field validator accepts the full PowerstoneData shape.
      for (const stone of stones) {
        const draw = alloc.fromStones.get(stone.id) ?? 0;
        if (draw <= 0) continue;
        const data = stone.powerstoneData;
        const next: PowerstoneData = {
          maxEnergy: data.maxEnergy,
          currentEnergy: Math.max(0, data.currentEnergy - draw),
          ...(data.notes != null ? { notes: data.notes } : {}),
        };
        await enqueueFieldPatch({
          entityClass: 'character_inventory',
          entityId: stone.id,
          fieldPath: 'powerstoneData',
          attemptedValue: next,
          humanName: `${stone.name} charge`,
          flashKey: makeFlashKey('character_inventory', stone.id, 'powerstoneData'),
          characterId: character.id,
        });
      }
      const verb = maintaining ? 'Maintained' : 'Cast';
      toasts.push(
        cost === 0 ? `${verb} ${spell.name} (free).` : `${verb} ${spell.name} for ${cost} energy.`,
        { kind: 'success' },
      );
      onClose();
    } catch (err) {
      toasts.push(`Couldn't cast — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCasting(false);
    }
  }

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl max-w-xl">
        <h3 className="font-display text-2xl">
          {maintaining ? `Maintain ${spell.name}` : spell.name}
        </h3>
        <p className="text-sm text-base-content/70 mt-1">
          {spell.college ?? 'No college'} · IQ/{spell.difficulty} · effective skill{' '}
          <span className="num text-base-content">{spell.level ?? '—'}</span>
          {character.manaLevel !== 'normal' && (
            <> · {MANA_LEVEL_LABELS[character.manaLevel].toLowerCase()}</>
          )}
        </p>
        <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
          <div>
            <p className="label-eyebrow">{maintaining ? 'Base upkeep' : 'Base cost'}</p>
            <p className="num text-xl">
              {maintaining ? (spell.maintenanceCost ?? 0) : spell.baseEnergyCost}
            </p>
          </div>
          <div>
            <p className="label-eyebrow">After discount</p>
            <p className="num text-xl text-primary">{seedCost}</p>
          </div>
          <div>
            <p className="label-eyebrow">{maintaining ? 'Cast cost' : 'Maintain'}</p>
            <p className="num text-xl">
              {maintaining
                ? spell.effectiveCost
                : spell.effectiveMaintenanceCost != null
                  ? spell.effectiveMaintenanceCost
                  : '—'}
            </p>
          </div>
          <div>
            <p className="label-eyebrow">{maintaining ? 'Duration' : 'Casting time'}</p>
            <p className="text-base-content/80">
              {(maintaining ? spell.duration : spell.castingTime) ?? '—'}
            </p>
          </div>
        </div>

        <div className="divider my-3" />

        <div className="flex items-end gap-3 mb-2">
          <label className="form-control w-28 shrink-0">
            <span className="label-text text-xs">Energy to spend</span>
            <input
              type="number"
              className="input input-bordered input-sm num text-right"
              min={0}
              value={energyRaw}
              onChange={(e) => setEnergyRaw(e.target.value)}
            />
          </label>
          <p className="text-xs text-base-content/60">
            {maintaining
              ? 'Paid once per duration interval; a maintenance of 0 keeps the spell up for free.'
              : 'Critical success costs 0, a failure costs 1, a critical failure costs the full ' +
                'base cost; Area and Missile spells scale with size.'}
          </p>
        </div>
        {!maintaining && (
          <p className="text-xs text-base-content/50 mb-2">
            Resisted spells: effective skill is capped at 16 against the subject&apos;s resistance
            unless the resistance is higher (Rule of 16, B349).
          </p>
        )}
        <p className="label-eyebrow mb-2">Draw {cost} energy from</p>
        <ul className="space-y-2">
          <SourceRow
            label="Fatigue Points (FP)"
            available={fpAvailable}
            value={alloc.fromFp}
            onChange={setFp}
          />
          {stones.map((stone) => (
            <SourceRow
              key={stone.id}
              label={`${stone.name} (powerstone)`}
              available={stone.powerstoneData.currentEnergy}
              value={alloc.fromStones.get(stone.id) ?? 0}
              onChange={(v) => setStone(stone.id, v, stone.powerstoneData.currentEnergy)}
            />
          ))}
          <SourceRow
            label="Hit Points (HP) — risky"
            available={hpAvailable}
            value={alloc.fromHp}
            onChange={setHp}
            tone="warning"
          />
        </ul>

        {stonesUsed > 1 && (
          <p className="mt-2 text-xs text-warning">
            A single casting can draw energy from only one powerstone (B481) — you&apos;ve allocated
            from {stonesUsed}.
          </p>
        )}
        <div className="mt-3 flex items-baseline justify-between text-sm">
          <span className="text-base-content/70">
            Allocated <span className="num text-base-content">{allocated}</span> / {cost}
          </span>
          {overspent ? (
            <span className="text-error num">Over by {-remaining}</span>
          ) : remaining > 0 ? (
            <span className="text-warning num">{remaining} more needed</span>
          ) : (
            <span className="text-success">Ready</span>
          )}
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={casting || (cost > 0 && remaining !== 0)}
            onClick={() => void performCast()}
          >
            {casting ? 'Paying…' : maintaining ? 'Pay upkeep' : 'Cast'}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

interface SourceRowProps {
  label: string;
  available: number;
  value: number;
  onChange(next: number): void;
  tone?: 'warning';
}

function SourceRow({ label, available, value, onChange, tone }: SourceRowProps) {
  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
      <span className={tone === 'warning' ? 'text-warning' : ''}>{label}</span>
      <span className="text-xs text-base-content/60 num">avail {available}</span>
      <input
        type="number"
        className="input input-bordered input-sm w-20 num text-right"
        value={value}
        min={0}
        max={available}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </li>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
