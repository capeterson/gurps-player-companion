import { totalPowerstoneEnergy } from '../../../../shared/domain/spellCalc.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut, PowerstoneData } from '../../../../shared/schemas/inventory.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

interface PowerstoneRowProps {
  item: InventoryItemOut;
  characterId: string;
  canWrite: boolean;
}

function PowerstoneRow({ item, characterId, canWrite }: PowerstoneRowProps) {
  const data = item.powerstoneData;
  if (!data) return null;
  const ratio = data.maxEnergy > 0 ? data.currentEnergy / data.maxEnergy : 0;

  // Powerstone charge is editable nested JSON; we patch the whole
  // `powerstoneData` field as a single unit to keep the orchestrator's
  // per-field validation happy (the field validator parses the full
  // shape, and we always send a fresh, valid copy).
  const setEnergy = (next: number) => {
    if (!canWrite) return;
    const clamped = Math.max(0, Math.min(data.maxEnergy, Math.round(next)));
    if (clamped === data.currentEnergy) return;
    const updated: PowerstoneData = {
      maxEnergy: data.maxEnergy,
      currentEnergy: clamped,
      ...(data.notes != null ? { notes: data.notes } : {}),
    };
    void enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: item.id,
      fieldPath: 'powerstoneData',
      attemptedValue: updated,
      humanName: `${item.name} charge`,
      flashKey: makeFlashKey('character_inventory', item.id, 'powerstoneData'),
      characterId,
    });
  };

  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      <span className="flex flex-col">
        <span className="font-medium">{item.name}</span>
        {data.notes ? <span className="text-xs text-base-content/60">{data.notes}</span> : null}
      </span>
      <div
        className="w-24 h-2 rounded-full bg-base-300/60 overflow-hidden"
        aria-label={`${item.name} energy meter`}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <span className="num text-right tabular-nums" aria-label={`${item.name} energy`}>
        {data.currentEnergy} / {data.maxEnergy}
      </span>
      {canWrite && (
        <span className="join">
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setEnergy(data.currentEnergy - 1)}
            disabled={data.currentEnergy <= 0}
            aria-label={`Drain 1 from ${item.name}`}
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setEnergy(data.currentEnergy + 1)}
            disabled={data.currentEnergy >= data.maxEnergy}
            aria-label={`Recharge 1 to ${item.name}`}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setEnergy(data.maxEnergy)}
            disabled={data.currentEnergy >= data.maxEnergy}
            aria-label={`Recharge ${item.name} to full`}
            title="Set to max"
          >
            Max
          </button>
        </span>
      )}
    </li>
  );
}

export function PowerstonesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const stones = character.inventory.filter((i) => i.powerstoneData != null);
  const total = totalPowerstoneEnergy(stones);

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Powerstones</p>
          <h2 className="font-display text-2xl">Stored energy</h2>
        </div>
        <p className="num text-base-content/80">
          <span className="text-primary text-xl font-semibold">{total}</span>
          <span className="text-xs text-base-content/60"> available</span>
        </p>
      </header>
      {stones.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No powerstones carried. Add an inventory item and toggle &ldquo;Powerstone&rdquo; on it to
          track its charge here.
        </p>
      ) : (
        <ul>
          {stones.map((s) => (
            <PowerstoneRow key={s.id} item={s} characterId={character.id} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function MagicItemsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const items = character.inventory.filter((i) => i.magicItemData != null);
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="card space-y-3 p-5">
      <header>
        <p className="label-eyebrow">Magic items</p>
        <h2 className="font-display text-2xl">Wands &amp; relics</h2>
      </header>
      <ul>
        {items.map((it) => (
          <MagicItemRow key={it.id} item={it} characterId={character.id} canWrite={canWrite} />
        ))}
      </ul>
    </section>
  );
}

interface MagicItemRowProps {
  item: InventoryItemOut;
  characterId: string;
  canWrite: boolean;
}

function MagicItemRow({ item, characterId, canWrite }: MagicItemRowProps) {
  const data = item.magicItemData;
  if (!data) return null;
  const charged = data.mode === 'charged';

  // For "charged" items only, we expose -/+ controls on chargesCurrent.
  // Same patch-the-whole-jsonb pattern as powerstone, since the field
  // validator parses the entire object shape.
  const setCharges = (next: number) => {
    if (!canWrite || !charged) return;
    const max = data.chargesMax ?? 0;
    const clamped = Math.max(0, Math.min(max, Math.round(next)));
    if (clamped === (data.chargesCurrent ?? 0)) return;
    const updated = { ...data, chargesCurrent: clamped };
    void enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: item.id,
      fieldPath: 'magicItemData',
      attemptedValue: updated,
      humanName: `${item.name} charges`,
      flashKey: makeFlashKey('character_inventory', item.id, 'magicItemData'),
      characterId,
    });
  };

  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      <span className="flex flex-col">
        <span className="font-medium">{item.name}</span>
        <span className="text-xs text-base-content/60">
          casts <em>{data.spellName}</em> at skill {data.spellSkillLevel}
          {' · '}
          {data.mode}
          {data.energyCost != null && data.mode === 'powered' ? `, ${data.energyCost} FP` : ''}
        </span>
      </span>
      {charged ? (
        <span className="num text-right tabular-nums">
          {data.chargesCurrent ?? 0} / {data.chargesMax ?? 0}
        </span>
      ) : (
        <span className="text-xs text-base-content/60">
          {data.mode === 'continuous' ? 'always-on' : 'powered by user'}
        </span>
      )}
      <span />
      {charged && canWrite && (
        <span className="join">
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setCharges((data.chargesCurrent ?? 0) - 1)}
            disabled={(data.chargesCurrent ?? 0) <= 0}
            aria-label={`Use one charge from ${item.name}`}
          >
            Use
          </button>
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setCharges(data.chargesMax ?? 0)}
            disabled={(data.chargesCurrent ?? 0) >= (data.chargesMax ?? 0)}
            aria-label={`Recharge ${item.name} to full`}
            title="Refill charges"
          >
            Refill
          </button>
        </span>
      )}
    </li>
  );
}
