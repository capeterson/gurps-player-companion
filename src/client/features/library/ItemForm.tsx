import { useState } from 'react';
import type {
  LibraryEnchantmentOut,
  LibraryItemCreate,
  LibraryItemOut,
} from '../../../shared/schemas/campaignLibrary.ts';

interface ItemFormProps {
  initial?: LibraryItemOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryItemCreate) => void;
  onCancel: () => void;
  definitions: readonly LibraryEnchantmentOut[];
}

export function ItemForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
  definitions,
}: ItemFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'general');
  const [defaultQuantity, setDefaultQuantity] = useState(initial?.defaultQuantity ?? 1);
  const [weightLbs, setWeightLbs] = useState(initial?.weightLbs ?? 0);
  const [cost, setCost] = useState(initial?.cost ?? 0);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [isContainer, setIsContainer] = useState(initial?.isContainer ?? false);
  const [hideawayCapacityLbs, setHideawayCapacityLbs] = useState(initial?.hideawayCapacityLbs ?? 0);
  const [weightReductionPercent, setWeightReductionPercent] = useState(
    initial?.weightReductionPercent ?? 0,
  );
  const [enchantments, setEnchantments] = useState(initial?.enchantments ?? []);
  const [definitionId, setDefinitionId] = useState('');

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      category: category.trim() || 'general',
      defaultQuantity,
      weightLbs,
      cost,
      description: description.trim() || null,
      source: source.trim() || null,
      isArmor: initial?.isArmor ?? false,
      armor: initial?.armor ?? null,
      weaponData: initial?.weaponData ?? null,
      isContainer,
      hideawayCapacityLbs: isContainer ? hideawayCapacityLbs : 0,
      weightReductionPercent: isContainer ? weightReductionPercent : 0,
      // Full powerstone / magic-item editors stay YAML-authored for now
      // (same as armor/weapon); pass through so editing name/cost etc.
      // doesn't wipe YAML-authored data.
      powerstoneData: initial?.powerstoneData ?? null,
      magicItemData: initial?.magicItemData ?? null,
      enchantments,
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Category</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={40}
            placeholder="general"
          />
        </label>
        <label className="form-control w-20">
          <span className="label-text">Qty</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={defaultQuantity}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              setDefaultQuantity(Number.isNaN(v) ? 1 : v);
            }}
            min={0}
          />
        </label>
        <label className="form-control w-24">
          <span className="label-text">Weight (lb)</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={weightLbs}
            onChange={(e) => setWeightLbs(Number.parseFloat(e.target.value) || 0)}
            min={0}
            step={0.1}
          />
        </label>
        <label className="form-control w-24">
          <span className="label-text">Cost ($)</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={cost}
            onChange={(e) => setCost(Number.parseFloat(e.target.value) || 0)}
            min={0}
            step={0.01}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="B288"
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={isContainer}
            onChange={(e) => setIsContainer(e.target.checked)}
          />
          <span>Container</span>
        </label>
        {isContainer && (
          <>
            <label className="form-control w-32">
              <span className="label-text">Hideaway capacity (lb)</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={hideawayCapacityLbs}
                onChange={(e) => setHideawayCapacityLbs(Number.parseFloat(e.target.value) || 0)}
                min={0}
                step={0.1}
              />
            </label>
            <label className="form-control w-28">
              <span className="label-text">Weight reduction %</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={weightReductionPercent}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  setWeightReductionPercent(Number.isNaN(v) ? 0 : Math.max(0, Math.min(100, v)));
                }}
                min={0}
                max={100}
              />
            </label>
          </>
        )}
      </div>
      <div className="space-y-2 rounded-field border border-base-300 p-3">
        <span className="label-text">Enchantments</span>
        {enchantments.map((entry, index) => (
          <div
            key={`${entry.spellName}-${index}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="text-sm">
              {entry.spellName}
              {entry.level ? ` (level ${entry.level})` : ''}
              {!entry.mechanics ? ' · metadata only' : ''}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() =>
                setEnchantments(enchantments.filter((_, entryIndex) => entryIndex !== index))
              }
            >
              Remove
            </button>
          </div>
        ))}
        {definitions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <select
              className="select select-bordered select-sm min-w-[12rem] flex-1"
              value={definitionId}
              onChange={(event) => setDefinitionId(event.target.value)}
              aria-label="Enchantment definition"
            >
              <option value="">Select definition…</option>
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!definitionId}
              onClick={() => {
                const definition = definitions.find((entry) => entry.id === definitionId);
                if (!definition) return;
                setEnchantments([
                  ...enchantments,
                  {
                    spellName: definition.name,
                    definitionId: definition.id,
                    definitionRevision: definition.revision,
                    definitionSource: definition.source,
                    mechanics: {
                      applicability: definition.applicability,
                      effects: definition.effects,
                      levels: definition.levels,
                      stackingPolicy: definition.stackingPolicy,
                    },
                  },
                ]);
                setDefinitionId('');
              }}
            >
              Attach
            </button>
          </div>
        )}
      </div>
      {(initial?.powerstoneData || initial?.magicItemData) && (
        <p className="text-xs text-dim">
          {initial?.powerstoneData && 'This item carries powerstone data. '}
          {initial?.magicItemData && 'This item carries magic-item data. '}
          Edit those fields via YAML import/export for now.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add item'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}
