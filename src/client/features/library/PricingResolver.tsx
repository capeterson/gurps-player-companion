import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { fixedCalculation } from '../../../shared/domain/calculation.ts';
import { preferredLibraryEditions } from '../../../shared/domain/libraryIdentity.ts';
import { canAdoptLibraryEntry, modifierApplies } from '../../../shared/domain/libraryIdentity.ts';
import {
  type PricedDefinition,
  definitionCalculation,
  definitionReference,
  resolveLibraryPricing,
  resolveLocalModifier,
} from '../../../shared/domain/libraryPricing.ts';
import { computeLeveledTraitCost } from '../../../shared/domain/modifierMath.ts';
import type {
  CalculationDefinitionV1,
  CalculationInputs,
  PricingResolution,
} from '../../../shared/schemas/calculation.ts';
import { inventoryItemCreate } from '../../../shared/schemas/inventory.ts';
import { traitCreate, traitModifier } from '../../../shared/schemas/trait.ts';
import type { TraitModifier, TraitVariant } from '../../../shared/schemas/trait.ts';
import { useDialogState } from '../../hooks/useDialogState.ts';
import { useLocalLibrary } from './useLocalLibrary.ts';

export function CalculationInputsEditor({
  rule,
  values,
  onChange,
}: {
  rule: CalculationDefinitionV1;
  values: CalculationInputs;
  onChange: (values: CalculationInputs) => void;
}) {
  const inputId = useId();
  const updateInput = (key: string, value: number | string | boolean | undefined) => {
    const next = { ...values, ...(value === undefined ? {} : { [key]: value }) };
    if (value === undefined) delete next[key];
    onChange(next);
  };
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      {rule.inputs.map((input) => {
        const current = Object.hasOwn(values, input.key) ? values[input.key] : input.default;
        return (
          <label
            key={input.key}
            htmlFor={`${inputId}-${input.key}`}
            className="min-w-0 break-words"
          >
            {input.label}
            {input.kind === 'number' ? (
              <input
                id={`${inputId}-${input.key}`}
                className="input w-full"
                type="number"
                min={input.min}
                max={input.max}
                step={input.step}
                value={current === undefined ? '' : String(current)}
                onChange={(e) => {
                  updateInput(
                    input.key,
                    e.target.value === '' ? undefined : Number(e.target.value),
                  );
                }}
              />
            ) : input.kind === 'boolean' ? (
              <select
                id={`${inputId}-${input.key}`}
                className="select w-full"
                value={current === undefined ? '' : String(current)}
                onChange={(e) => {
                  updateInput(
                    input.key,
                    e.target.value === '' ? undefined : e.target.value === 'true',
                  );
                }}
              >
                <option value="">Choose…</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <select
                id={`${inputId}-${input.key}`}
                className="select w-full"
                value={current === undefined ? '' : JSON.stringify(current)}
                onChange={(e) => {
                  updateInput(
                    input.key,
                    e.target.value === '' ? undefined : JSON.parse(e.target.value),
                  );
                }}
              >
                <option value="">Choose…</option>
                {input.options.map((option) => (
                  <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function PricingResolver({
  campaignId,
  section,
  entry,
  initial,
  initialModifiers = [],
  variant,
  onResolve,
  onCancel,
}: {
  campaignId: string;
  section: 'traits' | 'items';
  entry: PricedDefinition;
  initial?: PricingResolution | null | undefined;
  initialModifiers?: readonly TraitModifier[];
  variant?: TraitVariant | null | undefined;
  onResolve: (
    resolution: PricingResolution,
    modifiers: TraitModifier[],
    points: number | undefined,
  ) => void | Promise<void>;
  onCancel: () => void;
}) {
  const library = useLocalLibrary(campaignId);
  const [applying, setApplying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<CalculationInputs>(initial?.inputs ?? {});
  const [selected, setSelected] = useState<Record<string, CalculationInputs>>(() =>
    Object.fromEntries(
      initialModifiers.flatMap((m) => {
        const snapshot = m.pricingResolution;
        return snapshot
          ? [
              [
                snapshot.localModifier ? `local:${snapshot.localModifier}` : snapshot.definitionId,
                snapshot.inputs,
              ],
            ]
          : [];
      }),
    ),
  );
  const ref = useDialogState(true);
  const titleId = useId();
  const rule = definitionCalculation(section, entry);
  const [otherSources, setOtherSources] = useState(false);
  const globals =
    library?.modifiers.filter(
      (m) =>
        canAdoptLibraryEntry(m) &&
        section === 'traits' &&
        modifierApplies(m, { ...entry, kind: entry.kind ?? 'advantage' }),
    ) ?? [];
  const defaultModifierIds = new Set(
    preferredLibraryEditions(globals, library?.sources ?? []).map((row) => row.id),
  );
  const available = [
    ...(otherSources
      ? globals
      : globals.filter((m) => m.id in selected || defaultModifierIds.has(m.id))
    ).map((m) => ({ ...m, localName: undefined as string | undefined })),
    ...(section === 'traits' ? (entry.availableModifiers ?? []) : []).map((m) => ({
      ...m,
      id: `local:${m.name}`,
      localName: m.name,
      sourceId: entry.sourceId,
      applicability: { advisory: null },
      calculation:
        m.calculation ??
        fixedCalculation({
          modifier: { value: m.costValue, unit: m.costType === 'flat' ? 'points' : 'percentage' },
        }),
    })),
  ];
  let error: string | null = null;
  let resolved: PricingResolution | null = null;
  const modifiers: TraitModifier[] = [];
  let points: number | undefined;
  try {
    if (!library || !rule) throw new Error('Pricing definition is unavailable');
    const currentInputs = (rule: CalculationDefinitionV1, choices: CalculationInputs) =>
      Object.fromEntries(
        Object.entries(choices).filter(([key]) => rule.inputs.some((input) => input.key === key)),
      );
    resolved = resolveLibraryPricing(
      library,
      definitionReference(section, entry),
      currentInputs(rule, inputs),
    );
    for (const id of Object.keys(selected)) {
      const modifier = available.find((m) => m.id === id);
      if (!modifier?.calculation) throw new Error('A selected modifier is no longer available');
      const snapshot = modifier.localName
        ? resolveLocalModifier(
            library,
            entry,
            modifier.localName,
            currentInputs(modifier.calculation, selected[id] ?? {}),
          )
        : resolveLibraryPricing(
            library,
            definitionReference('modifiers', modifier),
            currentInputs(modifier.calculation, selected[id] ?? {}),
          );
      modifiers.push({
        name: modifier.name,
        category: modifier.category,
        costType: modifier.costType,
        costValue: snapshot.outputs.modifier ?? 0,
        pricingResolution: snapshot,
        ...(modifier.description ? { description: modifier.description } : {}),
        ...(modifier.group ? { group: modifier.group } : {}),
      });
    }
    const appliedModifiers = [
      ...initialModifiers.filter((m) => !m.pricingResolution),
      ...modifiers,
    ];
    const groups = appliedModifiers.map((m) => m.group).filter(Boolean);
    if (new Set(groups).size !== groups.length)
      throw new Error('Choose only one modifier from each mutually exclusive group');
    if (section === 'traits')
      points = computeLeveledTraitCost({
        basePoints: resolved.outputs.points ?? 0,
        modifiers: appliedModifiers,
        ...(variant ? { variant } : {}),
      }).total;
    for (const modifier of modifiers) traitModifier.parse(modifier);
    if (points !== undefined) traitCreate.shape.points.parse(points);
    if (section === 'items') {
      inventoryItemCreate.shape.cost.parse(resolved.outputs.cost);
      inventoryItemCreate.shape.weightLbs.parse(resolved.outputs.weightLbs);
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return createPortal(
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="modal-box max-h-[calc(var(--dialog-viewport-height,100dvh)-2rem)] w-[48rem] max-w-[calc(var(--dialog-viewport-width,100dvw)-2rem)] overflow-y-auto break-words">
        <h2 id={titleId} className="font-display text-xl">
          Resolve {entry.name}
        </h2>
        <p className="my-2 text-sm">
          {library?.sources.find((source) => source.id === entry.sourceId)?.abbreviation ??
            entry.sourceLocator ??
            'Legacy source'}{' '}
          · {entry.status ?? 'complete'}
        </p>
        {initial && (
          <p className="text-sm">
            Previously saved:{' '}
            {Object.entries(initial.outputs)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ')}
          </p>
        )}
        {section === 'traits' && globals.length > 0 && (
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={otherSources}
              onChange={(e) => setOtherSources(e.target.checked)}
            />{' '}
            Other modifier sources
          </label>
        )}
        {rule && <CalculationInputsEditor rule={rule} values={inputs} onChange={setInputs} />}
        {Object.keys(selected)
          .filter((id) => !available.some((m) => m.id === id))
          .map((id) => (
            <div key={id} className="alert alert-warning">
              <span>
                Selected modifier unavailable:{' '}
                {initialModifiers.find((m) => m.pricingResolution?.definitionId === id)?.name ?? id}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setSelected(
                    Object.fromEntries(Object.entries(selected).filter(([key]) => key !== id)),
                  )
                }
              >
                Remove unavailable modifier
              </button>
            </div>
          ))}
        {available.length > 0 && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Enhancements and limitations</legend>
            {available.map((modifier) => (
              <div key={modifier.id} className="space-y-2 py-2">
                <label>
                  <input
                    type="checkbox"
                    checked={modifier.id in selected}
                    onChange={(e) => {
                      const next = { ...selected };
                      if (e.target.checked) next[modifier.id] = {};
                      else delete next[modifier.id];
                      setSelected(next);
                    }}
                  />{' '}
                  {modifier.name}{' '}
                  {modifier.sourceId
                    ? `· ${library?.sources.find((source) => source.id === modifier.sourceId)?.abbreviation ?? 'Unavailable sourcebook'}`
                    : ''}
                </label>
                {modifier.applicability.advisory && (
                  <p className="text-sm">{modifier.applicability.advisory}</p>
                )}
                {modifier.id in selected && modifier.calculation && (
                  <CalculationInputsEditor
                    rule={modifier.calculation}
                    values={selected[modifier.id] ?? {}}
                    onChange={(values) => setSelected({ ...selected, [modifier.id]: values })}
                  />
                )}
              </div>
            ))}
          </fieldset>
        )}
        {error ? (
          <p role="alert" className="my-3 text-error">
            {error}
          </p>
        ) : (
          <div aria-label="Calculation breakdown" className="my-3 space-y-1">
            {Object.entries(resolved?.outputs ?? {}).map(([key, value]) => (
              <p key={key}>
                {key}: {value}
              </p>
            ))}
            {[...initialModifiers.filter((m) => !m.pricingResolution), ...modifiers].map((m) => (
              <p key={m.name}>
                {m.name}: {m.costValue}
                {m.costType === 'percent' ? '%' : ' points'}
              </p>
            ))}
            {variant && <p>Variant: {variant.name}</p>}
            {points !== undefined && <p>Total: {points} points</p>}
          </div>
        )}
        {saveError && (
          <p role="alert" className="text-error">
            {saveError}
          </p>
        )}
        <div className="modal-action flex-wrap">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={applying || !!error || !resolved}
            onClick={async () => {
              if (!resolved || applying) return;
              setApplying(true);
              setSaveError(null);
              try {
                await onResolve(resolved, modifiers, points);
              } catch (error) {
                setSaveError((error as Error).message);
              } finally {
                setApplying(false);
              }
            }}
          >
            Use these values
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onCancel}>
          close
        </button>
      </form>
    </dialog>,
    document.body,
  );
}
