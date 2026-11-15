import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { canonicalLibraryKey } from '../../../shared/domain/libraryIdentity.ts';
import { definitionReference } from '../../../shared/domain/libraryPricing.ts';
import { withLegacyModifiers } from '../../../shared/domain/skillProcedures.ts';
import type { CalculationDefinitionV1 } from '../../../shared/schemas/calculation.ts';
import { type LibraryTraitEffect, libraryTraitEffect } from '../../../shared/schemas/effects.ts';
import { type LibraryMetadata, libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import type { SituationalModifier } from '../../../shared/schemas/skill.ts';
import type { SkillProcedures } from '../../../shared/schemas/skillProcedures.ts';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { ArmorFacetEditor } from './ArmorFacetEditor.tsx';
import { CalculationEditor } from './CalculationEditor.tsx';
import { EditorValidity, EditorValidityContext } from './EditorValidity.tsx';
import { EffectsEditor } from './EffectsEditor.tsx';
import { ItemEnchantmentEditor } from './ItemEnchantmentEditor.tsx';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { LibraryAuthoringContext } from './LibraryAuthoringContext.tsx';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';
import { SourcebooksContext } from './SourcebooksContext.tsx';
import {
  RowIdentityDomain,
  type StructuredFieldProps,
  StructuredFields,
} from './StructuredFields.tsx';
import { WeaponModesEditor } from './WeaponModesEditor.tsx';
import { editorLabel, objectShape, unwrapSchema } from './editorSchema.ts';
import { type LibraryEditorSection, libraryEditorSchemas } from './libraryEditorSchemas.ts';
import { raceKeyDependencies, raceProfileDependencies } from './rowIdentity.ts';

const METADATA = new Set(Object.keys(libraryMetadata.shape));
const draftRows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    : [];

function RaceReferenceKey({
  field,
  lenses,
  peerLenses,
  races,
}: {
  field: StructuredFieldProps;
  lenses: Record<string, unknown>[];
  peerLenses: Record<string, unknown>[];
  races: Record<string, unknown>[];
}) {
  const original = useRef(String(field.value ?? '')).current;
  const component = /(?:^|\.)(traits|skills)\.\d+\.key$/.exec(field.path ?? '')?.[1];
  const dependencies =
    component === 'traits' || component === 'skills'
      ? raceKeyDependencies(lenses, component, original, String(field.value ?? ''), peerLenses)
      : null;
  const profiles =
    component === 'traits' || component === 'skills'
      ? raceProfileDependencies(races, component, String(field.value ?? ''))
      : [];
  return (
    <details className="min-w-0 text-sm">
      <summary
        className="cursor-pointer"
        aria-label={`Repair ${field.accessibleLabel ?? 'reference key'}`}
      >
        Repair reference key
      </summary>
      <label className="form-control min-w-0">
        Reference key
        <input
          className="input input-sm min-w-0 w-full"
          value={String(field.value ?? '')}
          data-field-path={field.path}
          aria-label={field.accessibleLabel ?? 'Reference key'}
          onChange={(event) => field.onChange(event.target.value)}
        />
      </label>
      <p className="text-xs">
        Changing this key may affect references.{' '}
        {dependencies &&
          dependencies.oldRemovals.length > 0 &&
          `Existing key is removed by: ${dependencies.oldRemovals.join(', ')}. `}
        {dependencies &&
          dependencies.proposedRemovals.length > 0 &&
          `Proposed key is removed by: ${dependencies.proposedRemovals.join(', ')}. `}
        {dependencies &&
          dependencies.proposedAdditions.length > 0 &&
          `Proposed key is also added by: ${dependencies.proposedAdditions.join(', ')}; combining these may require an explicit replacement. `}
        {profiles.length > 0 &&
          `Proposed key also occurs in: ${profiles.join(', ')}; combining these may require an explicit replacement. `}
        Other references may be unavailable here. Existing character selections and snapshots retain
        their historical keys.
      </p>
    </details>
  );
}
const legacyDraftRows = (value: unknown): SituationalModifier[] =>
  Array.isArray(value)
    ? value.filter((row) => row && typeof row.name === 'string' && typeof row.modifier === 'number')
    : [];
const GROUPS: [string, string[]][] = [
  [
    'Pricing and trait options',
    ['calculation', 'pointsPerLevel', 'maxLevel', 'variants', 'availableModifiers'],
  ],
  [
    'Requirements and defaults',
    [
      'techLevelPolicy',
      'techLevel',
      'specializationPolicy',
      'defaultSpecialization',
      'prerequisites',
      'prerequisiteRules',
      'defaults',
    ],
  ],
  ['Contextual rules and actions', ['procedures', 'situationalModifiers']],
  [
    'Equipment facets',
    [
      'isArmor',
      'armor',
      'weaponData',
      'isContainer',
      'hideawayCapacityLbs',
      'weightReductionPercent',
      'powerstoneData',
      'magicItemData',
      'enchantments',
    ],
  ],
  [
    'Racial profile and options',
    [
      'points',
      'attributeModifiers',
      'traits',
      'skills',
      'features',
      'variants',
      'forms',
      'compatibleRaceKeys',
      'removesTraits',
      'removesSkills',
    ],
  ],
  [
    'Effects and capabilities',
    [
      'effects',
      'capabilities',
      'duration',
      'stacking',
      'levels',
      'stackingPolicy',
      'applicability',
    ],
  ],
  ['Groups and tags', ['groups', 'tags']],
];

/** Every editable schema key occurs once; nested schemas include all supported branches. */
export function LibraryEntryFields({
  section,
  value,
  currentId,
  onChange,
  onValidityChange,
}: {
  section: LibraryEditorSection;
  value: Record<string, unknown>;
  currentId?: string | undefined;
  onChange: (next: Record<string, unknown>) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const context = useContext(LibraryAuthoringContext);
  const books = useContext(SourcebooksContext);
  const definitionLabel = (row: {
    name: string;
    sourceId?: string | null | undefined;
    source?: string | null | undefined;
    kind?: string | undefined;
  }) => {
    const book = books.find((entry) => entry.id === row.sourceId);
    return [
      row.name,
      row.kind ? editorLabel(row.kind) : null,
      book ? `${book.abbreviation}${book.edition ? ` (${book.edition})` : ''}` : row.source,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  useEffect(() => {
    onValidityChange?.(Object.keys(invalidFields).length === 0);
  }, [invalidFields, onValidityChange]);
  const validity = useCallback((id: string, valid: boolean, path: string) => {
    setInvalidFields((previous) => {
      if ((valid && !(id in previous)) || (!valid && previous[id] === path)) return previous;
      const next = { ...previous };
      if (valid) delete next[id];
      else next[id] = path;
      return next;
    });
  }, []);
  const shape = objectShape(libraryEditorSchemas[section]);
  const generatedLegacy = withLegacyModifiers(
    undefined,
    legacyDraftRows(value.situationalModifiers),
  ).modifiers;
  const isLegacyMirror = (rule: SkillProcedures['modifiers'][number]) =>
    generatedLegacy.some(
      (generated) =>
        generated.id === rule.id &&
        stringify(generated, { sortMapEntries: true }) ===
          stringify(rule, { sortMapEntries: true }),
    );
  const groups = GROUPS.filter(
    ([title]) => title !== 'Racial profile and options' || section === 'races',
  ).map(
    ([title, keys]) =>
      [
        title,
        keys.filter(
          (key) =>
            key in shape &&
            (section !== 'races' || title !== 'Pricing and trait options') &&
            (key !== 'techLevel' || section !== 'skills' || value.techLevelPolicy == null) &&
            (key !== 'duration' || section === 'activeEffects'),
        ),
      ] as const,
  );
  const assigned = new Set(groups.flatMap(([, keys]) => keys));
  // A declared policy owns TL; hiding the legacy field must not move it to basics.
  if (section === 'skills' && value.techLevelPolicy != null) assigned.add('techLevel');
  const basics = Object.keys(shape).filter((key) => !METADATA.has(key) && !assigned.has(key));
  const patch = (key: string, next: unknown) => {
    const updated = { ...value, [key]: next };
    if (next === undefined) delete updated[key];
    if (section === 'skills' && key === 'techLevelPolicy' && next && typeof next === 'object') {
      const policy = next as Record<string, unknown>;
      updated.techLevel = policy.kind === 'fixed' ? policy.techLevel : null;
    }
    if (
      section === 'skills' &&
      key === 'situationalModifiers' &&
      (Array.isArray(next) || next === undefined)
    ) {
      const procedures = value.procedures as SkillProcedures | undefined;
      if (
        !procedures ||
        (Array.isArray(procedures.modifiers) &&
          procedures.modifiers.every((rule) => rule && typeof rule.id === 'string'))
      )
        updated.procedures = {
          ...procedures,
          ...(!procedures ? { actions: [], benefits: [] } : {}),
          modifiers: [
            ...(procedures?.modifiers ?? []).filter((rule) => !isLegacyMirror(rule)),
            ...withLegacyModifiers(undefined, legacyDraftRows(next)).modifiers,
          ],
        };
    }
    onChange(updated);
  };
  function custom(field: StructuredFieldProps): ReactNode | undefined {
    if (
      section === 'races' &&
      /^(?:(?:variants|forms)\.\d+\.)?(?:traits|skills)\.\d+\.key$|^(?:variants|forms)\.\d+\.key$/.test(
        field.path ?? '',
      )
    ) {
      const rows = (context?.library.races ?? []).map((race) => ({
        ...race,
        referenceLabel: definitionLabel(race),
      }));
      const peers = rows.filter((race) => race.kind === 'lens' && race.id !== currentId);
      const lenses =
        value.kind === 'lens'
          ? [...peers, { ...value, referenceLabel: definitionLabel(value as { name: string }) }]
          : peers;
      return (
        <RaceReferenceKey
          field={field}
          lenses={lenses}
          peerLenses={peers}
          races={value.kind === 'lens' ? rows.filter((race) => race.kind === 'race') : []}
        />
      );
    }
    const { path = '', value: current, onChange: change } = field;
    if (
      path === 'procedures' &&
      current &&
      typeof current === 'object' &&
      Array.isArray((current as SkillProcedures).modifiers) &&
      (current as SkillProcedures).modifiers.every((rule) => rule && typeof rule.id === 'string')
    ) {
      const procedures = current as SkillProcedures;
      // Generated mirrors of legacy choices are edited by their original rows once.
      const legacy = procedures.modifiers.filter(isLegacyMirror);
      return (
        <StructuredFields
          {...field}
          value={{
            ...procedures,
            modifiers: procedures.modifiers.filter((rule) => !isLegacyMirror(rule)),
          }}
          renderField={(props) => (props.path === 'procedures' ? undefined : custom(props))}
          onChange={(next) => {
            if (
              next &&
              typeof next === 'object' &&
              Array.isArray((next as SkillProcedures).modifiers)
            )
              change({ ...next, modifiers: [...(next as SkillProcedures).modifiers, ...legacy] });
            else change(next);
          }}
        />
      );
    }
    if (path.endsWith('description') && !field.schema.isOptional() && !field.schema.isNullable())
      return (
        <div className="min-w-0 space-y-2 sm:col-span-2">
          <span className="text-sm">{field.label}</span>
          <RichTextEditor
            aria-label={field.label}
            value={String(current ?? '')}
            onChange={change}
            placeholder="Description…"
          />
        </div>
      );
    if (
      path === 'calculation' &&
      (current == null ||
        (typeof current === 'object' &&
          ['inputs', 'tables', 'nodes', 'outputs'].every((key) => {
            const rows = (current as Record<string, unknown>)[key];
            return (
              Array.isArray(rows) &&
              rows.every((row) => row != null && typeof row === 'object' && !Array.isArray(row))
            );
          })))
    ) {
      return (
        <EditorValidity path={path}>
          {(onValidityChange) => (
            <CalculationEditor
              value={current as CalculationDefinitionV1 | null | undefined}
              onChange={change}
              onValidityChange={onValidityChange}
              output={
                section === 'items'
                  ? 'cost'
                  : section === 'modifiers' || path !== 'calculation'
                    ? 'modifier'
                    : 'points'
              }
              unit={
                section === 'items'
                  ? 'currency'
                  : section === 'modifiers'
                    ? value.costType === 'flat'
                      ? 'points'
                      : 'percentage'
                    : 'points'
              }
              allowBasic={section !== 'modifiers'}
              renderField={(props) =>
                objectShape(props.schema).section ? custom(props) : undefined
              }
              defaultAmount={Number(value[section === 'items' ? 'cost' : 'basePoints'] ?? 0)}
              defaultWeight={Number(value.weightLbs ?? 0)}
            />
          )}
        </EditorValidity>
      );
    }
    if (path === 'enchantments')
      return (
        <ItemEnchantmentEditor
          value={current}
          onChange={change}
          definitions={context?.library.enchantments ?? []}
        />
      );
    const fieldBase = unwrapSchema(field.schema);
    if (
      fieldBase instanceof z.ZodArray &&
      'weaponSelector' in objectShape(fieldBase.element) &&
      Array.isArray(current) &&
      current.every((effect) => libraryTraitEffect.safeParse(effect).success)
    )
      return (
        <EditorValidity path={path}>
          {(onValidityChange) => (
            <EffectsEditor
              effects={current as LibraryTraitEffect[]}
              campaignId={context?.campaignId ?? null}
              libraryItems={context?.library.items ?? []}
              authoring
              onChange={change}
              onValidityChange={onValidityChange}
            />
          )}
        </EditorValidity>
      );
    if (path === 'armor')
      return (
        <EditorValidity path={path}>
          {(onValidityChange) => (
            <ArmorFacetEditor
              text={current ? stringify(current) : ''}
              onValidityChange={onValidityChange}
              onChange={(text) => {
                try {
                  const next: unknown = text.trim() ? parse(text) : null;
                  if (current == null && next != null)
                    onChange({ ...value, armor: next, isArmor: true });
                  else change(next);
                  onValidityChange(true);
                } catch {
                  onValidityChange(false);
                }
              }}
            />
          )}
        </EditorValidity>
      );
    if (path === 'weaponData')
      return (
        <EditorValidity path={path}>
          {(onValidityChange) => (
            <WeaponModesEditor
              text={current ? stringify(current) : ''}
              onChange={(text) => {
                try {
                  const parsed: unknown = text.trim() ? parse(text) : null;
                  change(parsed);
                  onValidityChange(true);
                } catch {
                  onValidityChange(false);
                }
              }}
            />
          )}
        </EditorValidity>
      );
    const childShape = objectShape(field.schema);
    if (context && 'section' in childShape && 'key' in childShape && 'sourceId' in childShape) {
      const reference = (current ?? {}) as Record<string, unknown>;
      if (
        reference.section &&
        !['traits', 'items', 'modifiers'].includes(String(reference.section))
      )
        return undefined;
      const category = String(reference.section ?? 'traits') as 'traits' | 'items' | 'modifiers';
      const rows = context.library[category];
      const match = rows.find(
        (row) =>
          canonicalLibraryKey(row.key || row.name) ===
            canonicalLibraryKey(String(reference.key ?? '')) &&
          (row.sourceId ?? null) === (reference.sourceId ?? null) &&
          (!reference.kind || ('kind' in row && row.kind === reference.kind)),
      );
      return (
        <fieldset className="fieldset min-w-0 space-y-2">
          <legend className="fieldset-legend">{field.label}</legend>
          <label>
            Definition kind
            <select
              className="select select-sm min-w-0 w-full"
              value={category}
              onChange={(event) => change({ section: event.target.value, key: '', sourceId: null })}
            >
              <option value="traits">Trait</option>
              <option value="items">Item</option>
              <option value="modifiers">Modifier</option>
            </select>
          </label>
          <label>
            Definition
            <select
              className="select select-sm min-w-0 w-full"
              value={match?.id ?? ''}
              onChange={(event) => {
                const row = rows.find((entry) => entry.id === event.target.value);
                if (row)
                  change({
                    ...reference,
                    ...definitionReference(category, row),
                  });
              }}
            >
              <option value="">
                {reference.key ? `Unavailable: ${String(reference.key)}` : 'Choose a definition…'}
              </option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {definitionLabel(row)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      );
    }
    // Lens picks store stable keys while presenting the corresponding profile names.
    if (context && /^(compatibleRaceKeys|removesTraits|removesSkills)\.\d+$/.test(path)) {
      const category = path.split('.')[0];
      const profiles = context.library.races.filter(
        (race) =>
          race.kind === 'race' &&
          (!Array.isArray(value.compatibleRaceKeys) ||
            value.compatibleRaceKeys.length === 0 ||
            value.compatibleRaceKeys.includes(race.key ?? race.name)),
      );
      const choices =
        category === 'compatibleRaceKeys'
          ? profiles.map((race) => ({ key: race.key ?? race.name, name: race.name }))
          : profiles
              .flatMap((race) =>
                [race, ...draftRows(race.variants), ...draftRows(race.forms)].flatMap((profile) =>
                  draftRows(category === 'removesTraits' ? profile.traits : profile.skills).flatMap(
                    (entry) =>
                      typeof entry.key === 'string' && typeof entry.name === 'string'
                        ? [{ key: entry.key, name: entry.name }]
                        : [],
                  ),
                ),
              )
              .map((entry) => ({ key: entry.key, name: entry.name }));
      const unique = [...new Map(choices.map((choice) => [choice.key, choice])).values()];
      const known = unique.some((choice) => choice.key === current);
      return (
        <label className="form-control min-w-0">
          {field.label}
          <select
            className="select select-sm min-w-0 w-full"
            value={known ? String(current) : '__custom__'}
            onChange={(event) =>
              change(event.target.value === '__custom__' ? '' : event.target.value)
            }
          >
            {unique.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.name}
              </option>
            ))}
            <option value="__custom__">Enter another name…</option>
          </select>
          {!known && (
            <input
              className="input input-sm min-w-0 w-full"
              aria-label={`${field.label} name`}
              value={String(current ?? '')}
              onChange={(event) => change(event.target.value)}
            />
          )}
        </label>
      );
    }
    return undefined;
  }
  const field = (key: string) => (
    <StructuredFields
      key={key}
      schema={shape[key] ?? z.string()}
      value={value[key]}
      label={section === 'sources' && key === 'name' ? 'Publication title' : editorLabel(key)}
      path={key}
      onChange={(next) => patch(key, next)}
      renderField={custom}
    />
  );
  const metadata = Object.fromEntries(
    Object.keys(libraryMetadata.shape)
      .filter((key) => key in value)
      .map((key) => [key, value[key]]),
  ) as LibraryMetadata;
  const updateMetadata = (next: LibraryMetadata) =>
    onChange({
      ...Object.fromEntries(Object.entries(value).filter(([key]) => !METADATA.has(key))),
      ...next,
    });
  const siblings = context?.library[section] ?? [];
  const raceKeys: Record<string, string[]> = { Trait: [], Skill: [], Variant: [], Form: [] };
  if (section === 'races') {
    for (const race of [...(context?.library.races ?? []), value] as Record<string, unknown>[]) {
      for (const profile of [race, ...draftRows(race.variants), ...draftRows(race.forms)]) {
        for (const [field, kind] of [
          ['traits', 'Trait'],
          ['skills', 'Skill'],
        ] as const) {
          raceKeys[kind]?.push(
            ...draftRows(profile[field]).flatMap((entry) =>
              typeof entry.key === 'string' ? [entry.key] : [],
            ),
          );
        }
      }
      for (const [field, kind] of [
        ['removesTraits', 'Trait'],
        ['removesSkills', 'Skill'],
      ] as const) {
        const keys = race[field];
        if (Array.isArray(keys))
          raceKeys[kind]?.push(...keys.filter((key): key is string => typeof key === 'string'));
      }
      for (const [field, kind] of [
        ['variants', 'Variant'],
        ['forms', 'Form'],
      ] as const) {
        raceKeys[kind]?.push(
          ...draftRows(race[field]).flatMap((entry) =>
            typeof entry.key === 'string' ? [entry.key] : [],
          ),
        );
      }
    }
  }
  return (
    <RowIdentityDomain.Provider value={section === 'races' ? { raceKeys } : null}>
      <EditorValidityContext.Provider value={validity}>
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">{basics.map(field)}</div>
          {groups.map(([title, keys]) =>
            keys.length ? (
              <LibraryAdvancedFields
                key={title}
                title={title}
                error={
                  Object.values(invalidFields).some((path) =>
                    keys.some((key) => path === key || path.startsWith(`${key}.`)),
                  )
                    ? 'Correct the fields in this section.'
                    : null
                }
              >
                <div className="min-w-0 space-y-4">{keys.map(field)}</div>
              </LibraryAdvancedFields>
            ) : null,
          )}
          {section !== 'sources' && libraryMetadata.safeParse(metadata).success && (
            <LibraryMetadataEditor value={metadata} onChange={updateMetadata} />
          )}
          {section !== 'sources' && !libraryMetadata.safeParse(metadata).success && (
            <StructuredFields
              schema={libraryMetadata.omit({ key: true })}
              value={metadata}
              label="Source and completeness"
              onChange={(next) => updateMetadata(next as LibraryMetadata)}
            />
          )}
          {section !== 'sources' && siblings.length > 0 && (
            <LibraryAdvancedFields title="Match another edition">
              <label className="form-control min-w-0 text-sm">
                Same definition in another edition
                <select
                  className="select select-sm min-w-0 w-full"
                  value=""
                  onChange={(event) => {
                    const row = siblings.find((entry) => entry.id === event.target.value);
                    if (row && 'key' in row && row.key) patch('key', row.key);
                  }}
                >
                  <option value="">Choose an existing definition to match…</option>
                  {siblings
                    .filter(
                      (row) =>
                        'key' in row &&
                        row.key &&
                        (row.sourceId ?? null) !== (value.sourceId ?? null) &&
                        (section !== 'traits' || ('kind' in row && row.kind === value.kind)),
                    )
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {definitionLabel(row)}
                      </option>
                    ))}
                </select>
              </label>
            </LibraryAdvancedFields>
          )}
        </div>
      </EditorValidityContext.Provider>
    </RowIdentityDomain.Provider>
  );
}
