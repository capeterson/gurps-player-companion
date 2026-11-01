import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useState } from 'react';
import { HIT_LOCATIONS, locationLabel } from '../../../../../shared/constants/hitLocations.ts';
import {
  inventoryAvailability,
  inventoryOnPlayer,
} from '../../../../../shared/domain/inventoryAvailability.ts';
import { weaponModes } from '../../../../../shared/domain/weaponModes.ts';
import type { LibraryEnchantmentOut } from '../../../../../shared/schemas/campaignLibrary.ts';
import type { EnchantmentRef, InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { LibraryAutocomplete } from '../../../../components/ui/LibraryAutocomplete.tsx';
import { getLocalDb } from '../../../../db/dexie.ts';
import { newClientId } from '../../../../sync/outbox.ts';
import { EnchantmentEntryDetails, type MechanicsDraftState } from './EnchantmentEntryDetails.tsx';
import { mechanicsDraft } from './EnchantmentMechanicsForm.tsx';
import { ItemField, type ItemFieldSpec } from './ItemField.tsx';
import { ItemLibraryLink } from './ItemLibraryLink.tsx';
import { useInventoryRows } from './ItemLocationField.tsx';
import { ENCHANTMENT_APPLICABILITY_LABELS } from './enchantmentText.ts';
import type { MovableRow } from './inventoryMoves.ts';
import {
  CATEGORY_LABELS,
  type ItemCategory,
  type ItemSection,
  addCategory,
  categories,
  mutateItem,
  removeCategory,
} from './itemMutations.ts';
import { useItemAction } from './useItemAction.ts';

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

/** Equipped means worn or wielded, so it needs the item on the player. */
function equippedSpec(item: InventoryItemOut, rows: readonly MovableRow[] | undefined) {
  const spec = check('equipped', 'Equipped');
  // An item equipped elsewhere (legacy data) can always be unequipped.
  if (!rows || item.equipped || inventoryAvailability(rows).get(item.id)?.carried) return spec;
  return {
    ...spec,
    disabled: true,
    hint:
      inventoryOnPlayer(rows).get(item.id) === false
        ? 'Move the item on the player to equip it.'
        : 'Set a quantity above 0 to equip it.',
  };
}

function fieldSpecs(
  item: InventoryItemOut,
  section: ItemSection,
  rows: readonly MovableRow[] | undefined,
): ItemFieldSpec[] {
  switch (section) {
    case 'basics':
      return [
        { path: 'name', label: 'Name' },
        number('quantity', 'Quantity'),
        number('weightLbs', 'Weight (lb)'),
        number('cost', 'Cost'),
        { path: 'location', label: 'Location', kind: 'location' },
        equippedSpec(item, rows),
        text('notes', 'Notes', true),
      ];
    case 'armor':
      return [
        number('armor.dr', 'DR'),
        // Layering (B286) needs both flags on an inner layer, so neither hides.
        check('armor.flexible', 'Flexible armor'),
        check('armor.concealable', 'Concealable inner layer'),
        number('weightReductionPercent', 'Lighten weight reduction (%)', true),
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
        { path: 'weaponData.modes.0.name', label: 'Attack name', advanced: true },
        text('weaponData.modes.0.sourceRow', 'Source reference', true),
        text('weaponData.skill', 'Governing skill'),
        text('weaponData.reach', 'Reach'),
        text('weaponData.parry', 'Parry'),
        number('weaponData.stRequired', 'ST required', true, true),
        number('weaponData.weaponSt', 'Purchased weapon ST', true, true),
        {
          path: 'weaponData.strengthKind',
          label: 'Damage strength rule',
          choices: ['ordinary', 'bow', 'crossbow', 'natural'],
          optional: true,
          advanced: true,
        },
        number('weaponData.db', 'Shield defense bonus', true, true),
        ...(item.weaponData?.db != null
          ? [number('weightReductionPercent', 'Lighten weight reduction (%)', true)]
          : []),
        {
          path: 'weaponData.wieldedSide',
          label: 'Shield side',
          choices: ['left', 'right'],
          emptyChoiceLabel: 'All directions',
          optional: true,
          advanced: true,
        },
        number('weaponData.ranged.acc', 'Accuracy', true, true),
        { path: 'weaponData.ranged.range', label: 'Range', kind: 'range' },
        text('weaponData.ranged.rof', 'Rate of fire', true),
        text('weaponData.ranged.shots', 'Shots', true),
        number('weaponData.ranged.bulk', 'Bulk', true, true),
        number('weaponData.ranged.recoil', 'Recoil', true, true),
        text('weaponData.notes', 'Weapon notes', true),
      ];
    case 'container':
      return [number('hideawayCapacityLbs', 'Hideaway capacity (lb)')];
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
          choices: ['powered', 'continuous'],
          choiceLabels: {
            powered: 'Uses energy',
            continuous: 'Always on',
          },
        },
        // Keep a populated cost visible even after the activation mode changes.
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
            {locationLabel(location)}
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
  campaignId,
  skillNames = [],
  fetchEnchantmentOptions,
}: {
  item: InventoryItemOut;
  kind: 'enchantments' | 'alternateModes';
  more: boolean;
  campaignId?: string | null | undefined;
  skillNames?: readonly string[];
  fetchEnchantmentOptions?: (query: string) => Promise<LibraryEnchantmentOut[]>;
}) {
  const [name, setName] = useState('');
  const [pickedDefinition, setPickedDefinition] = useState<LibraryEnchantmentOut | null>(null);
  const [mechanics, setMechanics] = useState<MechanicsDraftState | null>(null);
  const { run, pending, flash } = useItemAction(item);
  const enchantments = kind === 'enchantments';
  const list = enchantments ? item.enchantments : (item.weaponData?.alternateModes ?? []);
  const limit = enchantments ? 50 : 19;
  const title = enchantments ? 'Enchantment' : 'Alternate attack';
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  // Linked definitions come from the local library, never the network.
  const definitionIds = enchantments
    ? [...new Set(item.enchantments.flatMap((entry) => entry.definitionId ?? []))]
    : [];
  const definitions = useLiveQuery(
    async () =>
      definitionIds.length === 0
        ? []
        : (await getLocalDb().campaignLibraryEnchantments.bulkGet(definitionIds)).filter(
            (row) => row !== undefined,
          ),
    [definitionIds.join(',')],
  );
  return (
    <div
      hidden={!enchantments && !more && list.length === 0 && !name}
      className="field-rollback-flash space-y-3"
      {...flash.flashProps}
    >
      <h4 className="label-eyebrow">{enchantments ? 'Enchantments' : 'Alternate attacks'}</h4>
      {list.map((listEntry, index) => {
        const prefix = enchantments
          ? `enchantments.${index}`
          : `weaponData.alternateModes.${index}`;
        const enchantment = enchantments ? (listEntry as EnchantmentRef) : null;
        const levels = enchantment?.mechanics?.levels ?? [];
        const specs: ItemFieldSpec[] = enchantment
          ? [
              // A linked name follows its campaign definition.
              ...(enchantment.definitionId
                ? []
                : [{ path: `${prefix}.spellName`, label: 'Spell name' }]),
              number(`${prefix}.spellLevel`, 'Item Power', true, true),
              levels.length > 0
                ? {
                    ...number(`${prefix}.level`, 'Enchantment level', false, true),
                    choices: levels.map((level) => String(level.level)),
                    choiceLabels: Object.fromEntries(
                      levels.map((level) => [
                        String(level.level),
                        `Level ${level.level}${level.label ? ` (${level.label})` : ''}`,
                      ]),
                    ),
                    emptyChoiceLabel: 'No level',
                  }
                : number(`${prefix}.level`, 'Enchantment level', true, true),
              text(`${prefix}.category`, 'Enchantment label', true),
              text(`${prefix}.notes`, 'Enchantment notes', true),
            ]
          : [
              { path: `${prefix}.name`, label: 'Attack name' },
              text(`${prefix}.skill`, 'Governing skill', true),
              number(`${prefix}.stRequired`, 'ST required', true, true),
              number(`${prefix}.weaponSt`, 'Purchased weapon ST', true, true),
              {
                path: `${prefix}.strengthKind`,
                label: 'Damage strength rule',
                choices: ['ordinary', 'bow', 'crossbow', 'natural'],
                optional: true,
                advanced: true,
              },
              number(`${prefix}.ranged.acc`, 'Accuracy', true, true),
              { path: `${prefix}.ranged.range`, label: 'Range', kind: 'range' },
              text(`${prefix}.ranged.rof`, 'Rate of fire', true),
              text(`${prefix}.ranged.shots`, 'Shots', true),
              number(`${prefix}.ranged.bulk`, 'Bulk', true, true),
              number(`${prefix}.ranged.recoil`, 'Recoil', true, true),
              text(`${prefix}.sourceRow`, 'Source reference', true),
              { path: `${prefix}.damage`, label: 'Damage' },
              text(`${prefix}.reach`, 'Reach', true),
              text(`${prefix}.parry`, 'Parry', true),
              text(`${prefix}.notes`, 'Notes', true),
            ];
        // Commits start a storage transaction on blur, before structural buttons
        // run. The list version key prevents a removed row's hooks moving to its successor.
        return (
          <fieldset
            key={`${list.length}:${index}`}
            className="min-w-0 border border-base-300 rounded-lg p-3 space-y-3"
          >
            <legend className="text-xs px-2">
              {title} {index + 1}
            </legend>
            {enchantment && (
              <div className="min-w-0">
                {enchantment.definitionId && (
                  <p className="font-medium break-words">{enchantment.spellName}</p>
                )}
                <p className="text-xs text-base-content/60">
                  Source:{' '}
                  {enchantment.definitionSource ||
                    (enchantment.definitionId ? 'Campaign library' : 'Character sheet')}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {specs.map((spec) => (
                <ItemField
                  key={spec.path}
                  item={item}
                  spec={spec}
                  more={more}
                  campaignId={campaignId}
                  skillNames={skillNames}
                />
              ))}
            </div>
            {enchantment && (
              <EnchantmentEntryDetails
                item={item}
                index={index}
                entry={enchantment}
                definition={definitions?.find((row) => row.id === enchantment.definitionId)}
                draftState={mechanics}
                onDraftState={setMechanics}
                campaignId={campaignId}
                skillNames={skillNames}
              />
            )}
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
                              modes: weaponModes(current.weaponData).filter(
                                (__, i) => i !== index + 1,
                              ),
                              alternateModes: current.weaponData.alternateModes.filter(
                                (__, i) => i !== index,
                              ),
                            },
                          };
                        }),
                      () => {
                        setConfirmIndex(null);
                        // Keep an open effects draft on its own entry.
                        setMechanics((open) =>
                          !open || open.index < index
                            ? open
                            : open.index === index
                              ? null
                              : { ...open, index: open.index - 1 },
                        );
                      },
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
                        : { spellName: name.trim() },
                    ],
                  };
                if (!current.weaponData) throw new Error('Weapon was removed');
                return {
                  weaponData: {
                    ...current.weaponData,
                    modes: [
                      ...weaponModes(current.weaponData),
                      { key: newClientId(), name: name.trim() },
                    ],
                  },
                };
              }),
            () => {
              // A custom enchantment opens straight into its effects form.
              if (enchantments && !pickedDefinition)
                setMechanics({
                  index: list.length,
                  spellName: name.trim(),
                  draft: mechanicsDraft(null),
                });
              setName('');
              setPickedDefinition(null);
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
            }}
            fetchOptions={fetchEnchantmentOptions}
            getOptionKey={(definition) => definition.id}
            renderOption={(definition) => (
              <div className="flex items-baseline justify-between gap-2">
                <span>{definition.name}</span>
                <span className="text-xs text-base-content/60">
                  {ENCHANTMENT_APPLICABILITY_LABELS[definition.applicability]}
                </span>
              </div>
            )}
            placeholder="Campaign enchantment or custom name"
            aria-label="New enchantment name"
            className="min-w-0 flex-[1_1_15rem]"
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
        <button
          type="submit"
          className="btn btn-sm"
          disabled={pending || !name.trim() || list.length >= limit}
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
  campaignId,
  fetchEnchantmentOptions,
  hasChildren,
  onSection,
  onClose,
}: {
  item: InventoryItemOut;
  section: ItemSection;
  skillNames?: readonly string[];
  campaignId?: string | null | undefined;
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
  const rows = useInventoryRows(item.characterId);
  const specs = fieldSpecs(item, section, rows);
  const category = section === 'basics' || section === 'add' ? null : section;
  let content: ReactNode;
  if (section === 'add') {
    content = (
      <div className="space-y-3">
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
            <ItemField
              key={spec.path}
              item={item}
              spec={spec}
              more={more}
              campaignId={campaignId}
              skillNames={skillNames}
            />
          ))}
        </div>
        {section === 'armor' && <ArmorLocations item={item} more={more} />}
        {section === 'weapon' && (
          <ItemListEditor
            item={item}
            kind="alternateModes"
            more={more}
            campaignId={campaignId}
            skillNames={skillNames}
          />
        )}
        {section === 'enchantments' && (
          <ItemListEditor
            item={item}
            kind="enchantments"
            more={more}
            campaignId={campaignId}
            skillNames={skillNames}
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
      // The spanning editor must not set the table's intrinsic column widths.
      className="field-rollback-flash min-w-0 [contain:inline-size] rounded-xl border border-base-300 bg-base-200/60 p-3 sm:p-5 space-y-4"
      {...flash.flashProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg">
            {section === 'basics'
              ? 'Item details'
              : section === 'add'
                ? 'Add category'
                : CATEGORY_LABELS[section]}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {section === 'basics' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Add category to ${item.name}`}
              onClick={() => onSection('add')}
            >
              + Category
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {section === 'basics' && <ItemLibraryLink item={item} />}
      {content}
    </section>
  );
}
