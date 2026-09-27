import { useState } from 'react';
import { parse, stringify } from 'yaml';
import {
  MODIFIER_CATEGORIES,
  MODIFIER_COST_TYPES,
  TRAIT_KINDS,
} from '../../../shared/constants/traits.ts';
import { validateCalculation } from '../../../shared/domain/calculation.ts';
import { formatSigned } from '../../../shared/format/number.ts';
import type {
  LibraryItemOut,
  LibraryTraitCreate,
  LibraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { libraryTraitModifier } from '../../../shared/schemas/trait.ts';
import type { TraitModifier } from '../../../shared/schemas/trait.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { CalculationEditor } from './CalculationEditor.tsx';
import { EffectsEditor } from './EffectsEditor.tsx';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { LibraryFormFooter } from './LibraryFormFooter.tsx';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';
import { libraryFormError } from './libraryFormErrors.ts';
import { pricingDisplayValue } from './pricingDisplay.ts';

// ── Trait form ──────────────────────────────────────────────────────────────

interface TraitFormProps {
  campaignId: string | null;
  initial?: LibraryTraitOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryTraitCreate) => void;
  onCancel: () => void;
  libraryItems: readonly LibraryItemOut[];
}

export function TraitForm({
  campaignId,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
  libraryItems,
}: TraitFormProps) {
  const [metadata, setMetadata] = useState(() => libraryMetadata.parse(initial ?? {}));
  const [calculation, setCalculation] = useState(initial?.calculation ?? null);
  const [calculationValid, setCalculationValid] = useState(true);
  const [modifiersValid, setModifiersValid] = useState(true);
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<(typeof TRAIT_KINDS)[number]>(initial?.kind ?? 'advantage');
  // Keep as a string draft so typing a leading '-' isn't immediately clobbered.
  const [basePointsDraft, setBasePointsDraft] = useState(String(initial?.basePoints ?? 0));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [modifiers, setModifiers] = useState<TraitModifier[]>(initial?.availableModifiers ?? []);
  const [effects, setEffects] = useState(initial?.effects ?? []);
  const [effectsValid, setEffectsValid] = useState(true);

  function handleSubmit() {
    if (!name.trim()) return;
    const basePoints = Number.parseInt(basePointsDraft, 10);
    onSubmit({
      ...metadata,
      calculation,
      name: name.trim(),
      kind,
      basePoints: Number.isNaN(basePoints) ? 0 : basePoints,
      pointsPerLevel: initial?.pointsPerLevel ?? null,
      maxLevel: initial?.maxLevel ?? null,
      description: description.trim() || null,
      source: source.trim() || null,
      availableModifiers: modifiers,
      variants: initial?.variants ?? [],
      effects,
      tags: initial?.tags ?? [],
    });
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
        <label className="form-control">
          <span className="label-text">Kind</span>
          <select
            className="select select-bordered select-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {TRAIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {!calculation && (
          <label className="form-control w-24">
            <span className="label-text">Base pts</span>
            <input
              type="text"
              inputMode="numeric"
              className="input input-bordered input-sm"
              value={basePointsDraft}
              onChange={(e) => setBasePointsDraft(e.target.value)}
            />
          </label>
        )}
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="B102"
          />
        </label>
      </div>
      <div className="form-control" inert={isPending}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
      <LibraryMetadataEditor value={metadata} onChange={setMetadata} />
      <CalculationEditor
        defaultAmount={Number(basePointsDraft) || 0}
        value={calculation}
        onChange={setCalculation}
        onValidityChange={setCalculationValid}
      />
      <LibraryAdvancedFields
        title="Enhancements and limitations"
        defaultOpen={modifiers.length > 0}
        error={modifiersValid ? null : 'Invalid modifier'}
      >
        <ModifierSubEditor
          modifiers={modifiers}
          onChange={setModifiers}
          onValidityChange={setModifiersValid}
        />
      </LibraryAdvancedFields>
      <LibraryAdvancedFields
        title="Mechanical effects"
        defaultOpen={effects.length > 0}
        error={effectsValid ? null : 'Invalid effect'}
      >
        <EffectsEditor
          campaignId={campaignId}
          effects={effects}
          libraryItems={libraryItems}
          onChange={setEffects}
          onValidityChange={setEffectsValid}
        />
      </LibraryAdvancedFields>
      <LibraryFormFooter
        noun="trait"
        editing={Boolean(initial)}
        isPending={isPending}
        canSubmit={Boolean(name.trim()) && effectsValid && calculationValid && modifiersValid}
        error={error}
        onCancel={onCancel}
        onSubmit={handleSubmit}
      />
    </fieldset>
  );
}

// ── Modifier sub-editor ─────────────────────────────────────────────────────

function ModifierSubEditor({
  modifiers,
  onChange,
  onValidityChange,
}: {
  modifiers: TraitModifier[];
  onChange: (m: TraitModifier[]) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [newMod, setNewMod] = useState<Omit<TraitModifier, 'costValue'>>({
    name: '',
    category: 'enhancement',
    costType: 'percent',
  });
  // String draft so typing a leading '-' isn't clobbered on each keystroke.
  const [costValueDraft, setCostValueDraft] = useState('0');

  function commitModifier() {
    if (!newMod.name.trim()) return;
    const costValue = Number(costValueDraft);
    if (!costValueDraft.trim() || !Number.isFinite(costValue)) {
      setSourceError('Enter a finite modifier cost');
      return;
    }
    const parsed = libraryTraitModifier.safeParse({
      ...newMod,
      name: newMod.name.trim(),
      costValue,
    });
    if (!parsed.success) {
      setSourceError(parsed.error.issues[0]?.message ?? 'Invalid modifier');
      return;
    }
    setSourceError(null);
    onChange([...modifiers, parsed.data]);
    setNewMod({ name: '', category: 'enhancement', costType: 'percent' });
    setCostValueDraft('0');
    setAdding(false);
  }

  if (sourceMode)
    return (
      <div className="space-y-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={!!sourceError}
          onClick={() => setSourceMode(false)}
        >
          Visual modifiers
        </button>
        <label className="block">
          Modifier definitions (YAML)
          <textarea
            className="textarea w-full font-mono"
            rows={12}
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value);
              try {
                const next = libraryTraitModifier.array().parse(parse(event.target.value) ?? []);
                for (const modifier of next)
                  if (modifier.calculation) validateCalculation(modifier.calculation);
                onChange(next);
                onValidityChange(true);
                setSourceError(null);
              } catch (error) {
                onValidityChange(false);
                setSourceError(libraryFormError(error));
              }
            }}
          />
        </label>
        {sourceError && (
          <p role="alert" className="text-error break-words">
            {sourceError}
          </p>
        )}
      </div>
    );
  return (
    <div className="space-y-2">
      <span className="label-text">Modifiers</span>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => {
          setSourceText(stringify(modifiers));
          setSourceError(null);
          setSourceMode(true);
        }}
      >
        Edit modifier YAML
      </button>
      {sourceError && (
        <p role="alert" className="text-error">
          {sourceError}
        </p>
      )}
      {modifiers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {modifiers.map((m, i) => (
            <span key={`${m.name}-${m.costValue}`} className="chip flex items-center gap-1 text-xs">
              {m.name}{' '}
              {pricingDisplayValue(m.calculation, 'modifier', m.costValue) == null
                ? 'Calculated'
                : `${formatSigned(pricingDisplayValue(m.calculation, 'modifier', m.costValue) ?? 0, { zero: 'plain' })}${m.costType === 'percent' ? '%' : ' pts'}`}
              <button
                type="button"
                className="ml-1 text-error"
                onClick={() => onChange(modifiers.filter((_, j) => j !== i))}
                aria-label={`Remove ${m.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {adding ? (
        <div className="flex flex-wrap items-end gap-2 rounded-field border border-base-300 p-2">
          <label className="form-control min-w-[8rem] flex-1">
            <span className="label-text text-xs">Name</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={newMod.name}
              onChange={(e) => setNewMod((m) => ({ ...m, name: e.target.value }))}
              maxLength={160}
              placeholder="Aspected"
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Category</span>
            <select
              className="select select-bordered select-xs"
              value={newMod.category}
              onChange={(e) =>
                setNewMod((m) => ({ ...m, category: e.target.value as typeof m.category }))
              }
            >
              {MODIFIER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Cost type</span>
            <select
              className="select select-bordered select-xs"
              value={newMod.costType}
              onChange={(e) =>
                setNewMod((m) => ({ ...m, costType: e.target.value as typeof m.costType }))
              }
            >
              {MODIFIER_COST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control w-20">
            <span className="label-text text-xs">Value</span>
            <input
              type="text"
              inputMode="numeric"
              className="input input-bordered input-xs"
              value={costValueDraft}
              onChange={(e) => setCostValueDraft(e.target.value)}
            />
          </label>
          <label className="form-control min-w-[8rem] flex-1">
            <span className="label-text text-xs">Description (optional)</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={newMod.description ?? ''}
              onChange={(e) =>
                setNewMod((m) => ({ ...m, description: e.target.value || undefined }))
              }
              maxLength={2000}
            />
          </label>
          <label className="form-control w-28">
            <span className="label-text text-xs">Group (optional)</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={newMod.group ?? ''}
              onChange={(e) => setNewMod((m) => ({ ...m, group: e.target.value || undefined }))}
              maxLength={80}
              placeholder="aspect"
            />
          </label>
          <div className="flex gap-1 self-end">
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={commitModifier}
              disabled={!newMod.name.trim()}
            >
              Add
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(true)}>
          + Add modifier
        </button>
      )}
    </div>
  );
}

// ── Skill form ──────────────────────────────────────────────────────────────
