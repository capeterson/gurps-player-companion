import { useCallback, useState } from 'react';
import { parse, stringify } from 'yaml';
import type {
  LibraryEnchantmentOut,
  LibraryItemCreate,
  LibraryItemOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import {
  type ArmorData,
  type MagicItemData,
  type PowerstoneData,
  type WeaponData,
  armorData,
  magicItemData,
  powerstoneData,
  weaponData as weaponSchema,
} from '../../../shared/schemas/inventory.ts';
import { libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { ArmorFacetEditor } from './ArmorFacetEditor.tsx';
import { CalculationEditor } from './CalculationEditor.tsx';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { LibraryFormFooter } from './LibraryFormFooter.tsx';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';
import { WeaponModesEditor } from './WeaponModesEditor.tsx';
import { libraryFormError } from './libraryFormErrors.ts';

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
  const [metadata, setMetadata] = useState(() => libraryMetadata.parse(initial ?? {}));
  const [calculation, setCalculation] = useState(initial?.calculation ?? null);
  const [calculationValid, setCalculationValid] = useState(true);
  const [weaponText, setWeaponText] = useState(() =>
    initial?.weaponData ? stringify(initial.weaponData) : '',
  );
  const [armorText, setArmorText] = useState(() =>
    initial?.armor ? stringify(initial.armor) : '',
  );
  const [powerstoneText, setPowerstoneText] = useState(() =>
    initial?.powerstoneData ? stringify(initial.powerstoneData) : '',
  );
  const [magicItemText, setMagicItemText] = useState(() =>
    initial?.magicItemData ? stringify(initial.magicItemData) : '',
  );
  const [weaponError, setWeaponError] = useState<string | null>(null);
  const [armorError, setArmorError] = useState<string | null>(null);
  const [armorValid, setArmorValid] = useState(true);
  const handleArmorValidityChange = useCallback((valid: boolean) => {
    setArmorValid(valid);
    setArmorError(
      valid ? null : 'Armor cannot be both front only and back only. Choose one facing.',
    );
  }, []);
  const [powerstoneError, setPowerstoneError] = useState<string | null>(null);
  const [magicItemError, setMagicItemError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
    setWeaponError(null);
    setArmorError(null);
    setPowerstoneError(null);
    setMagicItemError(null);
    setSubmitError(null);
    let weapon: WeaponData | null = null;
    let armor: ArmorData | null = null;
    let powerstone: PowerstoneData | null = null;
    let magicItem: MagicItemData | null = null;
    try {
      weapon = weaponText.trim() ? weaponSchema.parse(parse(weaponText)) : null;
    } catch (error) {
      setWeaponError(
        `Weapon YAML: ${libraryFormError(error, { modes: 'Attack mode', key: 'Mode key', parry: 'Parry', reach: 'Reach', stRequired: 'Minimum ST' })}`,
      );
      return;
    }
    try {
      armor = armorText.trim() ? armorData.parse(parse(armorText)) : null;
      if (armor?.frontOnly && armor.backOnly) {
        setArmorError('Armor cannot be both front only and back only. Choose one facing.');
        setArmorValid(false);
        return;
      }
    } catch (error) {
      setArmorError(
        `Armor YAML: ${libraryFormError(error, { dr: 'DR', drCrushing: 'Crushing DR', typedDr: 'Damage type DR', locations: 'Coverage' })}`,
      );
      return;
    }
    try {
      powerstone = powerstoneText.trim() ? powerstoneData.parse(parse(powerstoneText)) : null;
    } catch (error) {
      setPowerstoneError(`Powerstone YAML: ${libraryFormError(error)}`);
      return;
    }
    try {
      magicItem = magicItemText.trim() ? magicItemData.parse(parse(magicItemText)) : null;
    } catch (error) {
      setMagicItemError(`Magic-item YAML: ${libraryFormError(error)}`);
      return;
    }
    try {
      onSubmit({
        ...metadata,
        calculation,
        name: name.trim(),
        category: category.trim() || 'general',
        defaultQuantity,
        weightLbs,
        cost,
        description: description.trim() || null,
        source: source.trim() || null,
        isArmor: armor !== null,
        armor,
        weaponData: weapon,
        isContainer,
        hideawayCapacityLbs: isContainer ? hideawayCapacityLbs : 0,
        weightReductionPercent: isContainer ? weightReductionPercent : 0,
        // Full powerstone / magic-item editors stay YAML-authored for now
        // (same as armor/weapon); pass through so editing name/cost etc.
        // doesn't wipe YAML-authored data.
        powerstoneData: powerstone,
        magicItemData: magicItem,
        enchantments,
      });
    } catch (error) {
      setSubmitError((error as Error).message);
    }
  }

  return (
    <fieldset disabled={isPending} className="card p-card space-y-3 border border-primary/30">
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
        {!calculation && (
          <>
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
          </>
        )}
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
      <LibraryMetadataEditor value={metadata} onChange={setMetadata} />
      <CalculationEditor
        value={calculation}
        onChange={setCalculation}
        onValidityChange={setCalculationValid}
        output="cost"
        unit="currency"
        defaultAmount={cost}
        defaultWeight={weightLbs}
      />
      <LibraryAdvancedFields
        title="Weapon and shield facets"
        defaultOpen={Boolean(weaponText)}
        error={weaponError}
        hint="Add attack modes and shield defense data when this item needs them."
      >
        <WeaponModesEditor
          text={weaponText}
          onChange={(value) => {
            setWeaponText(value);
            setWeaponError(null);
          }}
        />
        {weaponError && (
          <p role="alert" className="text-error break-words">
            {weaponError}
          </p>
        )}
      </LibraryAdvancedFields>
      {submitError && (
        <p role="alert" className="text-error break-words">
          {submitError}
        </p>
      )}
      <LibraryAdvancedFields
        title="Armor facets"
        defaultOpen={Boolean(armorText)}
        error={armorError}
        hint="Set protection and coverage here. Optional fields and source-specific details remain available in armor YAML. Leave armor off for ordinary equipment."
      >
        <ArmorFacetEditor
          text={armorText}
          onChange={(value) => {
            setArmorText(value);
            setArmorError(null);
            setArmorValid(true);
          }}
          onValidityChange={handleArmorValidityChange}
        />
        {armorError && (
          <p role="alert" className="text-error break-words">
            {armorError}
          </p>
        )}
      </LibraryAdvancedFields>
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
      <LibraryAdvancedFields
        title={`Enchantments${enchantments.length ? ` (${enchantments.length})` : ''}`}
        defaultOpen={enchantments.length > 0}
        hint="Attach a campaign enchantment to this item when applicable."
      >
        <div className="space-y-2">
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
      </LibraryAdvancedFields>
      <LibraryAdvancedFields
        title="Powerstone and magic-item facets (YAML)"
        defaultOpen={Boolean(powerstoneText || magicItemText)}
        error={powerstoneError ?? magicItemError}
        hint="Optional structured magic-item data. Leave both sections empty for ordinary equipment."
      >
        <label>
          Powerstone data
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={4}
            value={powerstoneText}
            onChange={(e) => {
              setPowerstoneText(e.target.value);
              setPowerstoneError(null);
            }}
          />
        </label>
        {powerstoneError && (
          <p role="alert" className="text-error break-words">
            {powerstoneError}
          </p>
        )}
        <label>
          Magic-item data
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={5}
            value={magicItemText}
            onChange={(e) => {
              setMagicItemText(e.target.value);
              setMagicItemError(null);
            }}
          />
        </label>
        {magicItemError && (
          <p role="alert" className="text-error break-words">
            {magicItemError}
          </p>
        )}
      </LibraryAdvancedFields>
      <LibraryFormFooter
        noun="item"
        editing={Boolean(initial)}
        isPending={isPending}
        canSubmit={Boolean(name.trim()) && calculationValid && armorValid}
        error={error}
        onCancel={onCancel}
        onSubmit={handleSubmit}
      />
    </fieldset>
  );
}
