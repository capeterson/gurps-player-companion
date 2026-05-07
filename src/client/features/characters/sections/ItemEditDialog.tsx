import { type FormEvent, useEffect, useState } from 'react';
import { HIT_LOCATIONS, type HitLocation } from '../../../../shared/constants/hitLocations.ts';
import type {
  ArmorData,
  InventoryItemOut,
  InventoryItemUpdate,
  MagicItemData,
  MagicItemMode,
  PowerstoneData,
} from '../../../../shared/schemas/inventory.ts';
import { useDialogState } from '../../../hooks/useDialogState.ts';
import { useToasts } from '../../../lib/toast.tsx';

const REDUCTIONS = [0, 25, 50] as const;
const MAGIC_ITEM_MODES: readonly MagicItemMode[] = ['charged', 'powered', 'continuous'];

function defaultArmor(): ArmorData {
  return {
    locations: [],
    dr: 0,
    drCrushing: null,
    flexible: false,
    frontOnly: false,
    backOnly: false,
    notes: null,
  };
}

function defaultPowerstone(): PowerstoneData {
  return {
    maxEnergy: 5,
    currentEnergy: 0,
    notes: null,
  };
}

function defaultMagicItem(): MagicItemData {
  return {
    spellName: '',
    spellSkillLevel: 15,
    mode: 'charged',
    chargesMax: 10,
    chargesCurrent: 10,
    energyCost: null,
    notes: null,
  };
}

export interface ItemEditDialogProps {
  open: boolean;
  item: InventoryItemOut | null;
  onSubmit: (patch: InventoryItemUpdate) => void;
  onCancel: () => void;
}

export function ItemEditDialog({ open, item, onSubmit, onCancel }: ItemEditDialogProps) {
  const ref = useDialogState(open);
  const toasts = useToasts();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [weight, setWeight] = useState('0');
  const [cost, setCost] = useState('0');
  const [notes, setNotes] = useState('');
  const [externalLocation, setExternalLocation] = useState('');
  const [equipped, setEquipped] = useState(false);
  const [worn, setWorn] = useState(false);

  const [isContainer, setIsContainer] = useState(false);
  const [hideaway, setHideaway] = useState('0');
  const [reduction, setReduction] = useState<number>(0);

  const [isArmor, setIsArmor] = useState(false);
  const [armor, setArmor] = useState<ArmorData>(defaultArmor());
  const [drRaw, setDrRaw] = useState('0');
  const [drCrushingRaw, setDrCrushingRaw] = useState('');
  const [customLocation, setCustomLocation] = useState('');

  const [isPowerstone, setIsPowerstone] = useState(false);
  const [powerstone, setPowerstone] = useState<PowerstoneData>(defaultPowerstone());
  const [psMaxRaw, setPsMaxRaw] = useState('5');
  const [psCurRaw, setPsCurRaw] = useState('0');

  const [isMagicItem, setIsMagicItem] = useState(false);
  const [magicItem, setMagicItem] = useState<MagicItemData>(defaultMagicItem());
  const [miSkillRaw, setMiSkillRaw] = useState('15');
  const [miMaxRaw, setMiMaxRaw] = useState('10');
  const [miCurRaw, setMiCurRaw] = useState('10');
  const [miEnergyRaw, setMiEnergyRaw] = useState('');

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setQuantity(String(item.quantity));
    setWeight(String(item.weightLbs));
    setCost(String(item.cost));
    setNotes(item.notes ?? '');
    setExternalLocation(item.externalLocation ?? '');
    setEquipped(item.equipped);
    setWorn(item.worn);
    setIsContainer(item.isContainer);
    setHideaway(String(item.hideawayCapacityLbs));
    setReduction(item.weightReductionPercent);
    setIsArmor(item.isArmor);
    const armorData = item.armor ?? defaultArmor();
    setArmor(armorData);
    setDrRaw(String(armorData.dr));
    setDrCrushingRaw(armorData.drCrushing == null ? '' : String(armorData.drCrushing));
    setCustomLocation('');
    const ps = item.powerstoneData;
    setIsPowerstone(ps != null);
    setPowerstone(ps ?? defaultPowerstone());
    setPsMaxRaw(String(ps?.maxEnergy ?? 5));
    setPsCurRaw(String(ps?.currentEnergy ?? 0));
    const mi = item.magicItemData;
    setIsMagicItem(mi != null);
    setMagicItem(mi ?? defaultMagicItem());
    setMiSkillRaw(String(mi?.spellSkillLevel ?? 15));
    setMiMaxRaw(String(mi?.chargesMax ?? 10));
    setMiCurRaw(String(mi?.chargesCurrent ?? 10));
    setMiEnergyRaw(mi?.energyCost == null ? '' : String(mi.energyCost));
  }, [item]);

  if (!item) return null;

  const isRoot = item.parentId === null;

  function toggleLocation(loc: string, checked: boolean) {
    setArmor((a) => ({
      ...a,
      locations: checked
        ? Array.from(new Set([...a.locations, loc]))
        : a.locations.filter((l) => l !== loc),
    }));
  }

  function addCustomLocation() {
    const trimmed = customLocation.trim();
    if (!trimmed) return;
    toggleLocation(trimmed, true);
    setCustomLocation('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toasts.push('Item name cannot be blank', { kind: 'error' });
      return;
    }
    const parsedQty = Math.floor(Number(quantity));
    if (!Number.isFinite(parsedQty) || parsedQty < 1) {
      toasts.push('Quantity must be at least 1', { kind: 'error' });
      return;
    }
    const parsedWeight = weight === '' ? 0 : Number(weight);
    if (!Number.isFinite(parsedWeight)) {
      toasts.push('Weight must be a number', { kind: 'error' });
      return;
    }
    const parsedCost = cost === '' ? 0 : Number(cost);
    if (!Number.isFinite(parsedCost)) {
      toasts.push('Cost must be a number', { kind: 'error' });
      return;
    }
    const parsedHideaway = hideaway === '' ? 0 : Number(hideaway);
    let powerstonePatch: PowerstoneData | null = null;
    if (isPowerstone) {
      const max = Math.max(1, Math.floor(Number(psMaxRaw)) || 1);
      const cur = Math.max(0, Math.min(max, Math.floor(Number(psCurRaw)) || 0));
      powerstonePatch = {
        maxEnergy: max,
        currentEnergy: cur,
        ...(powerstone.notes != null && powerstone.notes !== '' ? { notes: powerstone.notes } : {}),
      };
    }
    let magicItemPatch: MagicItemData | null = null;
    if (isMagicItem) {
      if (!magicItem.spellName.trim()) {
        toasts.push('Magic item needs a spell name', { kind: 'error' });
        return;
      }
      const skill = Math.max(0, Math.min(40, Math.floor(Number(miSkillRaw)) || 0));
      const max = Math.max(0, Math.floor(Number(miMaxRaw)) || 0);
      const cur = Math.max(0, Math.min(max, Math.floor(Number(miCurRaw)) || 0));
      const energyCost =
        miEnergyRaw === '' ? null : Math.max(0, Math.floor(Number(miEnergyRaw)) || 0);
      magicItemPatch = {
        spellName: magicItem.spellName.trim(),
        spellSkillLevel: skill,
        mode: magicItem.mode,
        ...(magicItem.mode === 'charged' ? { chargesMax: max, chargesCurrent: cur } : {}),
        ...(magicItem.mode === 'powered' && energyCost != null ? { energyCost } : {}),
        ...(magicItem.notes != null && magicItem.notes !== '' ? { notes: magicItem.notes } : {}),
      };
    }
    const patch: InventoryItemUpdate = {
      name: name.trim(),
      quantity: parsedQty,
      weightLbs: parsedWeight,
      cost: parsedCost,
      notes: notes.trim() === '' ? null : notes.trim(),
      externalLocation:
        isRoot && !worn && externalLocation.trim() !== '' ? externalLocation.trim() : null,
      worn: isRoot ? worn : false,
      equipped,
      isContainer,
      hideawayCapacityLbs: isContainer ? (Number.isFinite(parsedHideaway) ? parsedHideaway : 0) : 0,
      weightReductionPercent: isContainer ? reduction : 0,
      isArmor,
      armor: isArmor ? armor : null,
      powerstoneData: powerstonePatch,
      magicItemData: magicItemPatch,
    };
    onSubmit(patch);
  }

  return (
    <dialog ref={ref} className="modal" onClose={onCancel} onCancel={onCancel}>
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl max-w-2xl">
        <h3 className="font-display text-xl font-semibold">Edit item</h3>
        <form onSubmit={handleSubmit} className="mt-3 space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <label className="sm:col-span-3 flex flex-col gap-1">
              <span className="label-eyebrow">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input input-sm input-bordered"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Qty</span>
              <input
                value={quantity}
                inputMode="numeric"
                onChange={(e) => setQuantity(e.target.value)}
                className="num input input-sm input-bordered text-right"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Weight (lb)</span>
              <input
                value={weight}
                inputMode="decimal"
                onChange={(e) => setWeight(e.target.value)}
                className="num input input-sm input-bordered text-right"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Cost</span>
              <input
                value={cost}
                inputMode="decimal"
                onChange={(e) => setCost(e.target.value)}
                className="num input input-sm input-bordered text-right"
              />
            </label>
            <label className="sm:col-span-6 flex flex-col gap-1">
              <span className="label-eyebrow">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input input-sm input-bordered"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-base-300/60 pt-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={equipped}
                onChange={(e) => setEquipped(e.target.checked)}
              />
              <span>Equipped</span>
            </label>
            {isRoot && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={worn}
                  onChange={(e) => setWorn(e.target.checked)}
                />
                <span>Worn</span>
              </label>
            )}
            {isRoot && !worn && (
              <label className="flex flex-1 items-center gap-2 min-w-[200px]">
                <span className="label-eyebrow shrink-0">External location</span>
                <input
                  value={externalLocation}
                  onChange={(e) => setExternalLocation(e.target.value)}
                  className="input input-sm input-bordered flex-1"
                  placeholder="e.g. Wagon, Inn room"
                />
              </label>
            )}
          </div>

          <fieldset className="border border-base-300/60 rounded-xl p-3">
            <legend className="px-2 label-eyebrow">Container</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={isContainer}
                onChange={(e) => setIsContainer(e.target.checked)}
              />
              <span>This item is a container</span>
            </label>
            {isContainer && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="label-eyebrow">Hideaway capacity (lb)</span>
                  <input
                    value={hideaway}
                    inputMode="decimal"
                    onChange={(e) => setHideaway(e.target.value)}
                    className="num input input-sm input-bordered text-right"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="label-eyebrow">Lighten</span>
                  <div className="join">
                    {REDUCTIONS.map((r) => (
                      <button
                        type="button"
                        key={r}
                        className={`btn btn-sm join-item ${reduction === r ? 'btn-primary' : ''}`}
                        onClick={() => setReduction(r)}
                      >
                        {r}%
                      </button>
                    ))}
                  </div>
                </div>
                {Number(quantity) > 1 && (
                  <p className="sm:col-span-2 text-warning text-xs">
                    Stack of containers — hideaway / lighten only apply once on the worn root.
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="border border-base-300/60 rounded-xl p-3">
            <legend className="px-2 label-eyebrow">Armor</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={isArmor}
                onChange={(e) => setIsArmor(e.target.checked)}
              />
              <span>This item provides DR</span>
            </label>
            {isArmor && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="label-eyebrow">DR</span>
                    <input
                      value={drRaw}
                      inputMode="numeric"
                      onChange={(e) => {
                        setDrRaw(e.target.value);
                        const v = Number(e.target.value);
                        setArmor((a) => ({
                          ...a,
                          dr: Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)),
                        }));
                      }}
                      className="num input input-sm input-bordered text-right"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label-eyebrow">Crushing DR</span>
                    <input
                      value={drCrushingRaw}
                      inputMode="numeric"
                      placeholder="same"
                      onChange={(e) => {
                        setDrCrushingRaw(e.target.value);
                        const raw = e.target.value;
                        const v = Number(raw);
                        setArmor((a) => ({
                          ...a,
                          drCrushing:
                            raw === '' ? null : Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)),
                        }));
                      }}
                      className="num input input-sm input-bordered text-right"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={armor.flexible}
                      onChange={(e) => setArmor((a) => ({ ...a, flexible: e.target.checked }))}
                    />
                    <span>Flexible</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={armor.frontOnly}
                      onChange={(e) => setArmor((a) => ({ ...a, frontOnly: e.target.checked }))}
                    />
                    <span>Front only</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={armor.backOnly}
                      onChange={(e) => setArmor((a) => ({ ...a, backOnly: e.target.checked }))}
                    />
                    <span>Back only</span>
                  </label>
                </div>
                <div>
                  <span className="label-eyebrow">Locations</span>
                  <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1">
                    {HIT_LOCATIONS.map((loc: HitLocation) => {
                      const checked = armor.locations.includes(loc);
                      return (
                        <label key={loc} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs"
                            checked={checked}
                            onChange={(e) => toggleLocation(loc, e.target.checked)}
                          />
                          <span>{loc.replace('_', ' ')}</span>
                        </label>
                      );
                    })}
                  </div>
                  {armor.locations.some((l) => !HIT_LOCATIONS.includes(l as HitLocation)) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {armor.locations
                        .filter((l) => !HIT_LOCATIONS.includes(l as HitLocation))
                        .map((l) => (
                          <button
                            key={l}
                            type="button"
                            className="badge badge-sm badge-ghost gap-1"
                            onClick={() => toggleLocation(l, false)}
                            aria-label={`Remove custom location ${l}`}
                          >
                            {l} ✕
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={customLocation}
                      onChange={(e) => setCustomLocation(e.target.value)}
                      className="input input-xs input-bordered flex-1"
                      placeholder="Custom location (homebrew)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomLocation();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={addCustomLocation}
                      disabled={!customLocation.trim()}
                    >
                      Add
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="label-eyebrow">Armor notes</span>
                  <input
                    value={armor.notes ?? ''}
                    onChange={(e) =>
                      setArmor((a) => ({
                        ...a,
                        notes: e.target.value === '' ? null : e.target.value,
                      }))
                    }
                    className="input input-sm input-bordered"
                  />
                </label>
              </div>
            )}
          </fieldset>

          <fieldset className="border border-base-300/60 rounded-xl p-3">
            <legend className="px-2 label-eyebrow">Powerstone</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={isPowerstone}
                onChange={(e) => setIsPowerstone(e.target.checked)}
              />
              <span>This item is a powerstone</span>
            </label>
            {isPowerstone && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="label-eyebrow">Max energy</span>
                  <input
                    value={psMaxRaw}
                    inputMode="numeric"
                    onChange={(e) => setPsMaxRaw(e.target.value)}
                    className="num input input-sm input-bordered text-right"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label-eyebrow">Current charge</span>
                  <input
                    value={psCurRaw}
                    inputMode="numeric"
                    onChange={(e) => setPsCurRaw(e.target.value)}
                    className="num input input-sm input-bordered text-right"
                  />
                </label>
                <label className="sm:col-span-3 flex flex-col gap-1">
                  <span className="label-eyebrow">Stone notes</span>
                  <input
                    value={powerstone.notes ?? ''}
                    onChange={(e) =>
                      setPowerstone((p) => ({
                        ...p,
                        notes: e.target.value === '' ? null : e.target.value,
                      }))
                    }
                    className="input input-sm input-bordered"
                    placeholder="e.g. Manastone, attuned to fire"
                  />
                </label>
              </div>
            )}
          </fieldset>

          <fieldset className="border border-base-300/60 rounded-xl p-3">
            <legend className="px-2 label-eyebrow">Magic item</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={isMagicItem}
                onChange={(e) => setIsMagicItem(e.target.checked)}
              />
              <span>This item casts a spell</span>
            </label>
            {isMagicItem && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="label-eyebrow">Spell</span>
                    <input
                      value={magicItem.spellName}
                      onChange={(e) => setMagicItem((m) => ({ ...m, spellName: e.target.value }))}
                      className="input input-sm input-bordered"
                      placeholder="e.g. Fireball"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label-eyebrow">Enchanter skill</span>
                    <input
                      value={miSkillRaw}
                      inputMode="numeric"
                      onChange={(e) => setMiSkillRaw(e.target.value)}
                      className="num input input-sm input-bordered text-right"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label-eyebrow">Mode</span>
                    <select
                      className="select select-sm select-bordered"
                      value={magicItem.mode}
                      onChange={(e) =>
                        setMagicItem((m) => ({
                          ...m,
                          mode: e.target.value as MagicItemMode,
                        }))
                      }
                    >
                      {MAGIC_ITEM_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {magicItem.mode === 'charged' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="label-eyebrow">Max charges</span>
                      <input
                        value={miMaxRaw}
                        inputMode="numeric"
                        onChange={(e) => setMiMaxRaw(e.target.value)}
                        className="num input input-sm input-bordered text-right"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="label-eyebrow">Current charges</span>
                      <input
                        value={miCurRaw}
                        inputMode="numeric"
                        onChange={(e) => setMiCurRaw(e.target.value)}
                        className="num input input-sm input-bordered text-right"
                      />
                    </label>
                  </div>
                )}
                {magicItem.mode === 'powered' && (
                  <label className="flex flex-col gap-1 max-w-[14rem]">
                    <span className="label-eyebrow">Energy / use (FP)</span>
                    <input
                      value={miEnergyRaw}
                      inputMode="numeric"
                      onChange={(e) => setMiEnergyRaw(e.target.value)}
                      className="num input input-sm input-bordered text-right"
                      placeholder="e.g. 1"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="label-eyebrow">Item notes</span>
                  <input
                    value={magicItem.notes ?? ''}
                    onChange={(e) =>
                      setMagicItem((m) => ({
                        ...m,
                        notes: e.target.value === '' ? null : e.target.value,
                      }))
                    }
                    className="input input-sm input-bordered"
                  />
                </label>
              </div>
            )}
          </fieldset>

          <div className="modal-action">
            <button type="button" onClick={onCancel} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onCancel}>
          close
        </button>
      </form>
    </dialog>
  );
}
