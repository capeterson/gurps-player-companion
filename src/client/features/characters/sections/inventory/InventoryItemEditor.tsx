import { type ReactNode, useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import type { LibraryEnchantmentOut } from '../../../../../shared/schemas/campaignLibrary.ts';
import type {
  EnchantmentEffectTarget,
  InventoryItemOut,
} from '../../../../../shared/schemas/inventory.ts';
import { LibraryAutocomplete } from '../../../../components/ui/LibraryAutocomplete.tsx';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { useToasts } from '../../../../lib/toast.tsx';
import { ItemField, type ItemFieldSpec } from './ItemField.tsx';
import {
  CATEGORY_LABELS,
  type ItemCategory,
  type ItemSection,
  addCategory,
  categories,
  mutateItem,
  removeCategory,
} from './itemMutations.ts';

const number = (
  path: string,
  label: string,
  advanced = false,
  optional = false,
): ItemFieldSpec => ({ path, label, kind: 'number', advanced, optional });
const text = (path: string, label: string, advanced = false): ItemFieldSpec => ({
  path,
  label,
  advanced,
  optional: true,
});
const check = (path: string, label: string, advanced = false): ItemFieldSpec => ({
  path,
  label,
  kind: 'boolean',
  advanced,
});
const DR_TYPES = {
  cut: 'Cutting',
  imp: 'Impaling',
  pi: 'Piercing',
  pi_minus: 'Small piercing',
  pi_plus: 'Large piercing',
  pi_pp: 'Huge piercing',
  burn: 'Burning',
  corr: 'Corrosion',
  fat: 'Fatigue',
  tox: 'Toxic',
};

function fieldSpecs(
  item: InventoryItemOut,
  section: ItemSection,
  skillNames: readonly string[],
): ItemFieldSpec[] {
  switch (section) {
    case 'basics':
      return [
        { path: 'name', label: 'Name' },
        number('quantity', 'Quantity'),
        number('weightLbs', 'Weight (lb)'),
        number('cost', 'Cost'),
        check('equipped', 'Equipped'),
        ...(item.parentId === null ? [check('worn', 'Worn')] : []),
        ...(item.parentId === null && !item.worn
          ? [text('externalLocation', 'External location', true)]
          : []),
        text('notes', 'Notes', true),
      ];
    case 'armor':
      return [
        number('armor.dr', 'DR'),
        check('armor.flexible', 'Flexible armor'),
        number('armor.drCrushing', 'Crushing DR', true, true),
        number('armor.db', 'Armor defense bonus', true, true),
        ...Object.entries(DR_TYPES).map(([key, label]) =>
          number(`armor.typedDr.${key}`, `${label} DR`, true, true),
        ),
        check('armor.frontOnly', 'Front only', true),
        check('armor.backOnly', 'Back only', true),
        text('armor.notes', 'Armor notes', true),
      ];
    case 'weapon':
      return [
        { path: 'weaponData.damage', label: 'Damage' },
        { ...text('weaponData.skill', 'Governing skill'), suggestions: skillNames },
        text('weaponData.reach', 'Reach'),
        text('weaponData.parry', 'Parry'),
        number('weaponData.stRequired', 'ST required', true, true),
        number('weaponData.db', 'Shield defense bonus', true, true),
        {
          path: 'weaponData.wieldedSide',
          label: 'Shield side',
          choices: ['left', 'right'],
          optional: true,
          advanced: true,
        },
        number('weaponData.ranged.acc', 'Accuracy', true, true),
        text('weaponData.ranged.range', 'Range', true),
        text('weaponData.ranged.rof', 'Rate of fire', true),
        text('weaponData.ranged.shots', 'Shots', true),
        number('weaponData.ranged.bulk', 'Bulk', true, true),
        number('weaponData.ranged.recoil', 'Recoil', true, true),
        text('weaponData.notes', 'Weapon notes', true),
      ];
    case 'container':
      return [
        number('hideawayCapacityLbs', 'Hideaway capacity (lb)'),
        number('weightReductionPercent', 'Weight reduction (%)'),
      ];
    case 'powerstone':
      return [
        number('powerstoneData.currentEnergy', 'Current energy'),
        number('powerstoneData.maxEnergy', 'Maximum energy'),
        text('powerstoneData.notes', 'Powerstone notes', true),
      ];
    case 'magicItem':
      return [
        { path: 'magicItemData.spellName', label: 'Spell name' },
        number('magicItemData.spellSkillLevel', 'Spell skill level'),
        {
          path: 'magicItemData.mode',
          label: 'Activation',
          choices: ['charged', 'powered', 'continuous'],
        },
        // Keep populated fields visible even after the activation mode changes.
        number(
          'magicItemData.chargesCurrent',
          'Current charges',
          item.magicItemData?.mode !== 'charged',
          true,
        ),
        number(
          'magicItemData.chargesMax',
          'Maximum charges',
          item.magicItemData?.mode !== 'charged',
          true,
        ),
        number(
          'magicItemData.energyCost',
          'Energy cost',
          item.magicItemData?.mode !== 'powered',
          true,
        ),
        text('magicItemData.notes', 'Magic item notes', true),
      ];
    default:
      return [];
  }
}

function useItemAction(item: InventoryItemOut) {
  const toasts = useToasts();
  const flash = useFlashState(undefined, undefined, `character_inventory:${item.id}:`);
  const [pending, setPending] = useState(false);
  async function run(label: string, action: () => Promise<void>, done?: () => void) {
    setPending(true);
    try {
      await action();
      done?.();
    } catch (error) {
      flash.trigger();
      toasts.push(`Couldn't ${label} — ${error instanceof Error ? error.message : String(error)}`, {
        kind: 'error',
      });
    } finally {
      setPending(false);
    }
  }
  return { run, pending, flash };
}

function ArmorLocations({ item, more }: { item: InventoryItemOut; more: boolean }) {
  const [custom, setCustom] = useState('');
  const { run, flash } = useItemAction(item);
  const locations = item.armor?.locations ?? [];
  const customLocations = locations.filter(
    (location) => !(HIT_LOCATIONS as readonly string[]).includes(location),
  );
  function toggle(location: string) {
    void run('change armor coverage', () =>
      mutateItem(item.id, 'Armor coverage', (current) => {
        if (!current.armor) throw new Error('Armor was removed');
        const before = current.armor.locations;
        return {
          armor: {
            ...current.armor,
            locations: before.includes(location)
              ? before.filter((value) => value !== location)
              : [...before, location],
          },
        };
      }),
    );
  }
  return (
    <div className="field-rollback-flash space-y-3" {...flash.flashProps}>
      <div className="label-eyebrow">Protected locations</div>
      <div className="flex flex-wrap gap-2">
        {[...HIT_LOCATIONS, ...customLocations].map((location) => (
          <button
            key={location}
            type="button"
            aria-pressed={locations.includes(location)}
            onClick={() => toggle(location)}
            className={`btn btn-sm ${locations.includes(location) ? 'btn-primary' : 'btn-ghost border-base-300'}`}
          >
            {location.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
      <form
        hidden={!more && !custom && customLocations.length === 0}
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const location = custom.trim();
          if (!location) return;
          void run(
            'add armor location',
            () =>
              mutateItem(item.id, 'Armor coverage', (current) => {
                if (!current.armor) throw new Error('Armor was removed');
                return {
                  armor: {
                    ...current.armor,
                    locations: [...new Set([...current.armor.locations, location])],
                  },
                };
              }),
            () => setCustom(''),
          );
        }}
      >
        <input
          aria-label="Custom location"
          maxLength={40}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder="Custom location"
          className="input input-sm input-bordered min-w-0"
        />
        <button type="submit" className="btn btn-sm" disabled={!custom.trim()}>
          Add location
        </button>
      </form>
    </div>
  );
}

function ItemListEditor({
  item,
  kind,
  more,
  fetchEnchantmentOptions,
}: {
  item: InventoryItemOut;
  kind: 'enchantments' | 'alternateModes';
  more: boolean;
  fetchEnchantmentOptions?: (query: string) => Promise<LibraryEnchantmentOut[]>;
}) {
  const [name, setName] = useState('');
  const [pickedDefinition, setPickedDefinition] = useState<LibraryEnchantmentOut | null>(null);
  const [customTarget, setCustomTarget] = useState<EnchantmentEffectTarget | ''>('');
  const [customValue, setCustomValue] = useState('1');
  const [customSkillName, setCustomSkillName] = useState('');
  const { run, pending, flash } = useItemAction(item);
  const enchantments = kind === 'enchantments';
  const list = enchantments ? item.enchantments : (item.weaponData?.alternateModes ?? []);
  const limit = enchantments ? 50 : 10;
  const title = enchantments ? 'Enchantment' : 'Attack mode';
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  return (
    <div
      hidden={!enchantments && !more && list.length === 0 && !name}
      className="field-rollback-flash space-y-3"
      {...flash.flashProps}
    >
      <h4 className="label-eyebrow">{enchantments ? 'Enchantments' : 'Alternate attacks'}</h4>
      {enchantments && (
        <p className="text-xs text-base-content/60">
          Campaign definitions and custom typed effects change stats while this item is equipped or
          worn. Older note-only records remain non-mechanical.
        </p>
      )}
      {list.map((listEntry, index) => {
        const prefix = enchantments
          ? `enchantments.${index}`
          : `weaponData.alternateModes.${index}`;
        const specs: ItemFieldSpec[] = enchantments
          ? [
              { path: `${prefix}.spellName`, label: 'Spell name' },
              number(`${prefix}.spellLevel`, 'Enchanter skill level', true, true),
              number(`${prefix}.level`, 'Mechanical level', true, true),
              text(`${prefix}.category`, 'Enchantment label', true),
              text(`${prefix}.notes`, 'Enchantment notes', true),
            ]
          : [
              { path: `${prefix}.name`, label: 'Mode name' },
              { path: `${prefix}.damage`, label: 'Mode damage' },
              text(`${prefix}.reach`, 'Mode reach', true),
              text(`${prefix}.parry`, 'Mode parry', true),
              text(`${prefix}.notes`, 'Mode notes', true),
            ];
        // Commits start a storage transaction on blur, before structural buttons
        // run. The list version key prevents a removed row's hooks moving to its successor.
        return (
          <fieldset
            key={`${list.length}:${index}`}
            className="border border-base-300 rounded-lg p-3 space-y-3"
          >
            <legend className="text-xs px-2">
              {title} {index + 1}
            </legend>
            {enchantments &&
              'definitionRevision' in listEntry &&
              listEntry.definitionRevision != null && (
                <p className="text-xs text-base-content/60">
                  Campaign snapshot revision {listEntry.definitionRevision}
                  {listEntry.definitionSource ? ` · ${listEntry.definitionSource}` : ''}
                  {listEntry.definitionId == null ? ' · retained' : ' · follows library'}
                </p>
              )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {specs.map((spec) => (
                <ItemField key={spec.path} item={item} spec={spec} more={more} />
              ))}
            </div>
            {confirmIndex === index ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Remove {title.toLowerCase()} {index + 1}?
                </span>
                <button type="button" className="btn btn-sm" onClick={() => setConfirmIndex(null)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-error"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      `remove ${title.toLowerCase()}`,
                      () =>
                        mutateItem(item.id, `Remove ${title}`, (current) => {
                          if (enchantments)
                            return {
                              enchantments: current.enchantments.filter((__, i) => i !== index),
                            };
                          if (!current.weaponData) throw new Error('Weapon was removed');
                          return {
                            weaponData: {
                              ...current.weaponData,
                              alternateModes: current.weaponData.alternateModes.filter(
                                (__, i) => i !== index,
                              ),
                            },
                          };
                        }),
                      () => setConfirmIndex(null),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-error"
                onClick={() => setConfirmIndex(index)}
              >
                Remove {title.toLowerCase()} {index + 1}
              </button>
            )}
          </fieldset>
        );
      })}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void run(
            `add ${title.toLowerCase()}`,
            () =>
              mutateItem(item.id, `Add ${title}`, (current) => {
                if (enchantments)
                  return {
                    enchantments: [
                      ...current.enchantments,
                      pickedDefinition
                        ? {
                            spellName: pickedDefinition.name,
                            definitionId: pickedDefinition.id,
                            definitionRevision: pickedDefinition.revision,
                            definitionSource: pickedDefinition.source,
                            mechanics: {
                              applicability: pickedDefinition.applicability,
                              effects: pickedDefinition.effects,
                              levels: pickedDefinition.levels,
                              stackingPolicy: pickedDefinition.stackingPolicy,
                            },
                          }
                        : {
                            spellName: name.trim(),
                            ...(customTarget
                              ? {
                                  mechanics: {
                                    applicability: 'any' as const,
                                    effects: [
                                      {
                                        target: customTarget,
                                        value: Number(customValue),
                                        ...(customTarget === 'skill'
                                          ? { skillName: customSkillName.trim() }
                                          : {}),
                                      },
                                    ],
                                    levels: [],
                                    stackingPolicy: { kind: 'stack' as const },
                                  },
                                }
                              : {}),
                          },
                    ],
                  };
                if (!current.weaponData) throw new Error('Weapon was removed');
                return {
                  weaponData: {
                    ...current.weaponData,
                    alternateModes: [...current.weaponData.alternateModes, { name: name.trim() }],
                  },
                };
              }),
            () => {
              setName('');
              setPickedDefinition(null);
              setCustomTarget('');
              setCustomValue('1');
              setCustomSkillName('');
            },
          );
        }}
      >
        {enchantments && fetchEnchantmentOptions ? (
          <LibraryAutocomplete<LibraryEnchantmentOut>
            value={name}
            onChange={(value) => {
              setName(value);
              if (pickedDefinition?.name !== value) setPickedDefinition(null);
            }}
            onPick={(definition) => {
              setName(definition.name);
              setPickedDefinition(definition);
              setCustomTarget('');
            }}
            fetchOptions={fetchEnchantmentOptions}
            getOptionKey={(definition) => definition.id}
            renderOption={(definition) => (
              <div className="flex items-baseline justify-between gap-2">
                <span>{definition.name}</span>
                <span className="text-xs text-base-content/60">{definition.applicability}</span>
              </div>
            )}
            placeholder="Campaign enchantment or custom name"
            aria-label="New enchantment name"
            className="min-w-[15rem] flex-1"
          />
        ) : (
          <input
            aria-label={`New ${title.toLowerCase()} name`}
            maxLength={enchantments ? 160 : 40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`${title} name`}
            className="input input-sm input-bordered min-w-0"
          />
        )}
        {enchantments && !pickedDefinition && (
          <>
            <select
              aria-label="Custom enchantment effect"
              value={customTarget}
              onChange={(event) =>
                setCustomTarget(event.target.value as EnchantmentEffectTarget | '')
              }
              className="select select-sm select-bordered"
            >
              <option value="">Note only</option>
              {[
                'weapon_attack',
                'weapon_damage',
                'weapon_accuracy',
                'weapon_parry',
                'weapon_block',
                'armor_divisor',
                'dr',
                'db',
                'weight_reduction_percent',
                'skill',
              ].map((target) => (
                <option key={target} value={target}>
                  {target.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            {customTarget && (
              <input
                aria-label="Custom enchantment value"
                type="number"
                min={-100}
                max={100}
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                className="input input-sm input-bordered w-20"
              />
            )}
            {customTarget === 'skill' && (
              <input
                aria-label="Custom enchantment skill"
                value={customSkillName}
                onChange={(event) => setCustomSkillName(event.target.value)}
                className="input input-sm input-bordered min-w-0"
                placeholder="Skill name"
              />
            )}
          </>
        )}
        <button
          type="submit"
          className="btn btn-sm"
          disabled={
            pending ||
            !name.trim() ||
            list.length >= limit ||
            (!!customTarget && !Number.isFinite(Number(customValue))) ||
            (customTarget === 'skill' && !customSkillName.trim())
          }
        >
          Add {title.toLowerCase()}
        </button>
      </form>
    </div>
  );
}

export function InventoryItemEditor({
  item,
  section,
  skillNames = [],
  fetchEnchantmentOptions,
  hasChildren,
  onSection,
  onClose,
}: {
  item: InventoryItemOut;
  section: ItemSection;
  skillNames?: readonly string[];
  fetchEnchantmentOptions?: (query: string) => Promise<LibraryEnchantmentOut[]>;
  hasChildren: boolean;
  onSection: (section: ItemSection) => void;
  onClose: () => void;
}) {
  const [more, setMore] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [addingMagic, setAddingMagic] = useState(false);
  const [spellName, setSpellName] = useState('');
  const { run, pending, flash } = useItemAction(item);
  const active = categories(item);
  const specs = fieldSpecs(item, section, skillNames);
  const category = section === 'basics' || section === 'add' ? null : section;
  let content: ReactNode;
  if (section === 'add') {
    content = (
      <div className="space-y-3">
        <p className="text-sm text-base-content/60">
          An item can have several categories. Adding one keeps its other settings.
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABELS) as ItemCategory[])
            .filter((candidate) => !active.includes(candidate))
            .map((candidate) => (
              <button
                type="button"
                key={candidate}
                disabled={pending}
                className="btn btn-sm"
                onClick={() => {
                  if (candidate === 'magicItem') {
                    setAddingMagic(true);
                    return;
                  }
                  void run(
                    `add ${CATEGORY_LABELS[candidate]}`,
                    () => addCategory(item.id, candidate),
                    () => onSection(candidate),
                  );
                }}
              >
                + {CATEGORY_LABELS[candidate]}
              </button>
            ))}
        </div>
        {addingMagic && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!spellName.trim()) return;
              void run(
                'add Magic item',
                () => addCategory(item.id, 'magicItem', spellName),
                () => onSection('magicItem'),
              );
            }}
          >
            <input
              aria-label="Magic item spell name"
              value={spellName}
              onChange={(event) => setSpellName(event.target.value)}
              maxLength={160}
              className="input input-sm input-bordered"
              placeholder="Spell name"
            />
            <button
              type="submit"
              disabled={pending || !spellName.trim()}
              className="btn btn-primary btn-sm"
            >
              Add magic item
            </button>
          </form>
        )}
      </div>
    );
  } else {
    content = (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {specs.map((spec) => (
            <ItemField key={spec.path} item={item} spec={spec} more={more} />
          ))}
        </div>
        {section === 'armor' && <ArmorLocations item={item} more={more} />}
        {section === 'weapon' && <ItemListEditor item={item} kind="alternateModes" more={more} />}
        {section === 'enchantments' && (
          <ItemListEditor
            item={item}
            kind="enchantments"
            more={more}
            {...(fetchEnchantmentOptions ? { fetchEnchantmentOptions } : {})}
          />
        )}
        {(specs.some((spec) => spec.advanced) || section === 'enchantments') && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={more}
            onClick={() => setMore((value) => !value)}
          >
            {more ? 'Fewer options' : 'More options'}
          </button>
        )}
        <p className="text-xs text-base-content/50">
          Changes save as you leave each field. Filled options stay visible.
        </p>
        {category &&
          (removing ? (
            <div className="border border-error/40 rounded-lg p-3 flex flex-wrap items-center gap-2">
              <p className="text-sm">
                Remove {CATEGORY_LABELS[category]} and its settings? Other categories stay.
              </p>
              <button type="button" className="btn btn-sm" onClick={() => setRemoving(false)}>
                Keep category
              </button>
              <button
                type="button"
                className="btn btn-sm btn-error"
                disabled={pending}
                onClick={() =>
                  void run(
                    `remove ${CATEGORY_LABELS[category]}`,
                    () => removeCategory(item.id, category),
                    () => {
                      setRemoving(false);
                      onClose();
                    },
                  )
                }
              >
                Remove
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-error"
                disabled={section === 'container' && hasChildren}
                onClick={() => setRemoving(true)}
              >
                Remove category
              </button>
              {section === 'container' && hasChildren && (
                <p className="text-xs text-base-content/60">
                  Move this container’s contents before removing its category.
                </p>
              )}
            </div>
          ))}
      </div>
    );
  }
  return (
    <section
      aria-label={`${item.name}: ${section === 'basics' ? 'Item details' : section === 'add' ? 'Add category' : CATEGORY_LABELS[section]}`}
      className="field-rollback-flash rounded-xl border border-base-300 bg-base-200/60 p-3 sm:p-5 space-y-4"
      {...flash.flashProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label-eyebrow">{item.name}</div>
          <h3 className="font-display text-lg">
            {section === 'basics'
              ? 'Item details'
              : section === 'add'
                ? 'Add category'
                : CATEGORY_LABELS[section]}
          </h3>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
      {content}
    </section>
  );
}
