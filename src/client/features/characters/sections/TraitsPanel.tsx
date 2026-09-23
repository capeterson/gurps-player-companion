import { type DragEvent, useCallback, useEffect, useState } from 'react';
import { computeTraitCost } from '../../../../shared/domain/traitCost.ts';
import type { LibraryTraitOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { type TraitEffect, traitEffect } from '../../../../shared/schemas/effects.ts';
import { libraryMechanics } from '../../../../shared/schemas/libraryMechanics.ts';
import type { TraitOut, TraitVariant } from '../../../../shared/schemas/trait.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import { AppIcon } from '../../../components/ui/AppIcon.tsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { DragHandle } from '../../../components/ui/DragHandle.tsx';
import { FoldSection } from '../../../components/ui/FoldSection.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import {
  LibraryModifierPicker,
  applyModifierToggle,
} from '../../../components/ui/LibraryModifierPicker.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { intParser } from '../../../lib/parsers.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';
import { EffectsEditor, effectPreview } from '../../library/EffectsEditor.tsx';
import { LibraryMechanicsNote } from './LibraryMechanicsNote.tsx';
import {
  type TraitSort,
  type TraitTablePreferences,
  readTraitTablePreferences,
  saveTraitTablePreferences,
} from './traitTablePreferences.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import {
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
} from './useEntityRowPatch.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

const TRAIT_KINDS = [
  'advantage',
  'disadvantage',
  'perk',
  'quirk',
  'language',
  'cultural_familiarity',
] as const;

type TraitKind = (typeof TRAIT_KINDS)[number];

function traitKindLabel(kind: TraitKind): string {
  return kind.replaceAll('_', ' ');
}

/**
 * Kinds the add form may create. `language` was moved out of
 * character_traits in migration 0028 (first-class character_languages
 * owns fluency/cost now), so creating a legacy language trait today
 * produces a row that never renders anywhere. The enum stays writable
 * for old clients; this only stops the current UI offering it.
 */
const CREATABLE_TRAIT_KINDS: readonly TraitKind[] = TRAIT_KINDS.filter((k) => k !== 'language');

interface AddTraitFormProps {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
}

interface TraitSnapshot {
  name: string;
  nameRaw: string;
  kind: TraitKind;
  points: number;
  pointsRaw: string;
  /** Trait level (when the library entry has pointsPerLevel). */
  level: number | null;
  /** Selected library variant name, or null for the base form. */
  variantName: string | null;
  libraryTraitId: string | null;
  /** When non-empty, list of selected library modifier names to write into trait.modifiers. */
  selectedModifierNames: readonly string[];
  /** Snapshot of the picked trait's catalogue entry (for resolving modifier metadata at create time). */
  pickedTrait: LibraryTraitOut | null;
}

/**
 * Combine basePoints + level*pointsPerLevel + variant adjustment + modifier
 * percent/flat into a final cost.  Mirrors computeLeveledTraitCost in
 * shared/domain/modifierMath.ts but uses the UI's `computeTraitCost`
 * (Math.ceil rounding) for consistency with the existing modifier picker.
 */
function previewLeveledCost(
  basePoints: number,
  pointsPerLevel: number | null | undefined,
  level: number | null,
  variant: TraitVariant | null,
  selectedModifiers: ReadonlyArray<{ costType: 'percent' | 'flat'; costValue: number }>,
): number {
  const leveled = basePoints + (pointsPerLevel ?? 0) * (level ?? 0);
  let withVariant = leveled;
  if (variant?.pointCostMultiplier !== undefined) {
    withVariant =
      leveled >= 0
        ? Math.ceil(leveled * variant.pointCostMultiplier)
        : Math.floor(leveled * variant.pointCostMultiplier);
  }
  if (variant?.pointCostDelta !== undefined) withVariant += variant.pointCostDelta;
  return computeTraitCost(withVariant, selectedModifiers);
}

function AddTraitForm({ characterId, campaignId, canWrite }: AddTraitFormProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TraitKind>('advantage');
  const [points, setPoints] = useState('0');
  // When the user picks a library entry both the id (for the FK) and
  // the full entry (for the modifier picker) are captured here.  The
  // entry is dropped whenever the user types past the prefilled name.
  const [pickedLibraryId, setPickedLibraryId] = useState<string | null>(null);
  const [pickedTrait, setPickedTrait] = useState<LibraryTraitOut | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<readonly string[]>([]);
  /** Level input draft (string for tolerance to mid-edit blank value). */
  const [levelDraft, setLevelDraft] = useState<string>('');
  /** Selected variant name; null = base form. */
  const [variantName, setVariantName] = useState<string | null>(null);
  const editName = (value: string) => {
    setName(value);
    setPickedLibraryId(null);
    setPickedTrait(null);
    setSelectedModifiers([]);
    setLevelDraft('');
    setVariantName(null);
  };

  const { fetchOptions } = useLibraryFetcher<LibraryTraitOut>('traits', campaignId);
  const {
    creating,
    submit: submitEntity,
    reject,
    flashProps,
  } = useAddEntityForm({
    entityClass: 'character_trait',
    characterId,
    label: 'trait',
  });

  const isLeveled = pickedTrait?.pointsPerLevel != null;
  const hasVariants = (pickedTrait?.variants?.length ?? 0) > 0;
  const parsedLevel = (() => {
    const n = Number.parseInt(levelDraft, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const selectedVariant: TraitVariant | null =
    pickedTrait?.variants?.find((v) => v.name === variantName) ?? null;

  // Live cost preview when the picker is open: re-derives points from
  // level + variant + selected modifier names, so the form's `points`
  // field stays in sync with what the user is toggling.
  const livePoints =
    pickedTrait !== null
      ? previewLeveledCost(
          pickedTrait.basePoints,
          pickedTrait.pointsPerLevel ?? null,
          isLeveled ? parsedLevel : null,
          selectedVariant,
          pickedTrait.availableModifiers
            .filter((m) => selectedModifiers.includes(m.name))
            .map((m) => ({ costType: m.costType, costValue: m.costValue })),
        )
      : null;

  async function submit(snap: TraitSnapshot) {
    if (snap.pickedTrait && snap.pickedTrait.campaignId !== campaignId) {
      reject('Campaign changed — select a trait from the current campaign library');
      return;
    }
    const modifiers =
      snap.pickedTrait !== null
        ? snap.pickedTrait.availableModifiers.filter((m) =>
            snap.selectedModifierNames.includes(m.name),
          )
        : [];
    await submitEntity(
      {
        name: snap.name,
        kind: snap.kind,
        points: snap.points,
        characterId,
        ...(snap.level !== null ? { level: snap.level } : {}),
        ...(snap.variantName !== null ? { variantName: snap.variantName } : {}),
        ...(snap.libraryTraitId ? { libraryTraitId: snap.libraryTraitId } : {}),
        ...(modifiers.length > 0 ? { modifiers } : {}),
      },
      () => {
        // Per AGENTS.md (rule 1: never silently discard user edits): only
        // clear fields whose current value still matches the snapshot we
        // submitted.  We use functional setters so the comparison runs
        // against the *live* state at completion time, not the
        // closure-captured value from the render that submitted; that
        // way a field the user has typed into during the await isn't
        // wiped, which is exactly the quick-edit loss this guard exists
        // to prevent.
        setName((cur) => (cur === snap.nameRaw ? '' : cur));
        setPoints((cur) => (cur === snap.pointsRaw ? '0' : cur));
        setPickedLibraryId(null);
        setPickedTrait(null);
        setSelectedModifiers([]);
        setLevelDraft('');
        setVariantName(null);
      },
      snap.pickedTrait && snap.libraryTraitId
        ? libraryMechanics.parse({
            sourceId: snap.libraryTraitId,
            campaignId: snap.pickedTrait.campaignId,
            sourceRevision: null,
            effects: snap.pickedTrait.effects ?? null,
          })
        : null,
    );
  }

  if (!canWrite) return null;

  return (
    <form
      {...flashProps}
      className="field-rollback-flash flex flex-col gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // When the modifier picker is active, prefer the live cost
        // preview over whatever's in the points input — the user's
        // intent is "what the picker says" once they've toggled
        // anything.  If they haven't (livePoints === pickedTrait.basePoints
        // and selectedModifiers is empty), the field still works.
        const pParsed = Number(points);
        // Prefer the leveled/variant/modifier-aware live preview whenever
        // the library context provides one — the user's intent is "what
        // the picker / level / variant says".  Falls back to the typed
        // Pts field for plain non-library traits.
        const usePreview =
          livePoints !== null &&
          (selectedModifiers.length > 0 || isLeveled || selectedVariant !== null);
        const submittedPoints = usePreview
          ? (livePoints as number)
          : Number.isFinite(pParsed)
            ? pParsed
            : 0;
        void submit({
          name: name.trim(),
          nameRaw: name,
          kind,
          points: submittedPoints,
          pointsRaw: points,
          level: isLeveled ? parsedLevel : null,
          variantName,
          libraryTraitId: pickedLibraryId,
          selectedModifierNames: selectedModifiers,
          pickedTrait,
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="form-control flex-1 min-w-[10rem]">
          <span className="label-text text-xs" id="add-trait-name-label">
            Trait name
          </span>
          {campaignId ? (
            <LibraryAutocomplete<LibraryTraitOut>
              value={name}
              onChange={editName}
              onPick={(opt) => {
                setName(opt.name);
                setKind(opt.kind);
                setPoints(String(opt.basePoints));
                setPickedLibraryId(opt.id);
                setPickedTrait(opt);
                setSelectedModifiers([]);
                // Default level to 1 for leveled traits (most useful starting
                // value); leave blank otherwise so the input stays out of the way.
                setLevelDraft(opt.pointsPerLevel != null ? '1' : '');
                setVariantName(null);
              }}
              fetchOptions={fetchOptions}
              getOptionKey={(o) => o.id}
              renderOption={(o) => (
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    {o.name}
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-base-content/50">
                      {o.kind.replace('_', ' ')}
                    </span>
                  </span>
                  <span className="num text-xs text-base-content/70">{o.basePoints} pts</span>
                </span>
              )}
              placeholder="e.g. Combat Reflexes"
              inputProps={{ 'aria-labelledby': 'add-trait-name-label' }}
            />
          ) : (
            <input
              aria-labelledby="add-trait-name-label"
              className="input input-bordered input-sm"
              value={name}
              onChange={(e) => editName(e.target.value)}
              placeholder="e.g. Combat Reflexes"
            />
          )}
        </div>
        <label className="form-control">
          <span className="label-text text-xs">Kind</span>
          <select
            className="select select-bordered select-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as TraitKind)}
          >
            {CREATABLE_TRAIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {isLeveled && (
          <label className="form-control w-20">
            <span
              className="label-text text-xs"
              title={
                pickedTrait?.maxLevel != null
                  ? `Leveled trait — max ${pickedTrait.maxLevel} (${pickedTrait.pointsPerLevel} pts/level)`
                  : `Leveled trait (${pickedTrait?.pointsPerLevel} pts/level)`
              }
            >
              Level
            </span>
            <input
              type="number"
              min="0"
              max={pickedTrait?.maxLevel ?? 99}
              className="input input-bordered input-sm num"
              value={levelDraft}
              onChange={(e) => setLevelDraft(e.target.value)}
              aria-label="Trait level"
            />
          </label>
        )}
        <label className="form-control w-20">
          <span className="label-text text-xs">Pts</span>
          <input
            className="input input-bordered input-sm num"
            value={livePoints !== null ? String(livePoints) : points}
            readOnly={livePoints !== null}
            onChange={(e) => setPoints(e.target.value)}
            title={
              livePoints !== null
                ? 'Computed from base + level + variant + modifiers. Edit those inputs to change.'
                : 'Free-form point cost.'
            }
          />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add'}
        </button>
      </div>
      {hasVariants && pickedTrait !== null && (
        <label className="form-control">
          <span className="label-text text-xs">Variant</span>
          <select
            className="select select-bordered select-sm"
            value={variantName ?? ''}
            onChange={(e) => setVariantName(e.target.value || null)}
          >
            <option value="">(base form)</option>
            {pickedTrait.variants.map((v) => {
              const adj: string[] = [];
              if (v.pointCostMultiplier !== undefined) {
                adj.push(`×${v.pointCostMultiplier}`);
              }
              if (v.pointCostDelta !== undefined) {
                adj.push(`${v.pointCostDelta >= 0 ? '+' : ''}${v.pointCostDelta} pts`);
              }
              const adjStr = adj.length > 0 ? ` (${adj.join(', ')})` : '';
              return (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {adjStr}
                </option>
              );
            })}
          </select>
          {selectedVariant?.description && (
            <Markdown
              source={selectedVariant.description}
              className="mt-1 text-[11px] text-dim leading-snug"
            />
          )}
        </label>
      )}
      {pickedTrait !== null && pickedTrait.availableModifiers.length > 0 && (
        <LibraryModifierPicker
          basePoints={
            // Show base+level+variant cost so modifier percentages preview
            // against the right starting figure.
            previewLeveledCost(
              pickedTrait.basePoints,
              pickedTrait.pointsPerLevel ?? null,
              isLeveled ? parsedLevel : null,
              selectedVariant,
              [],
            )
          }
          available={pickedTrait.availableModifiers}
          selectedNames={selectedModifiers}
          onToggle={(modName) =>
            setSelectedModifiers((prev) =>
              applyModifierToggle(pickedTrait.availableModifiers, prev, modName),
            )
          }
        />
      )}
    </form>
  );
}

interface TraitRowProps {
  characterId: string;
  trait: TraitOut;
  inventory: CharacterDetail['inventory'];
  canWrite: boolean;
  expanded: boolean;
  position: number;
  dragging: boolean;
  visible: boolean;
  onToggle: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (direction: -1 | 1) => void;
}

const characterEffectsSchema = traitEffect.array().max(50);

function CharacterEffectsEditor({
  trait,
  inventory,
  rowPatch,
}: {
  trait: TraitOut;
  inventory: CharacterDetail['inventory'];
  rowPatch: ReturnType<typeof useEntityRowPatch>;
}) {
  const [valid, setValid] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [removeRequested, setRemoveRequested] = useState(false);
  const hideEffects = useCallback(() => {
    setHasOpened(false);
    setEditorOpen(false);
    setValid(true);
    setEditorVersion((version) => version + 1);
  }, []);
  const effectsField = useDraftField<TraitEffect[]>({
    name: `${trait.name} effects`,
    serverValue: trait.customEffects ?? [],
    format: JSON.stringify,
    parse: (raw) => characterEffectsSchema.parse(JSON.parse(raw) as unknown),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    onSave: async (effects) => {
      await rowPatch.patch('customEffects', effects);
      if (effects.length === 0) hideEffects();
    },
    flashKey: rowPatch.flashKey('customEffects'),
  });
  const effects = characterEffectsSchema.parse(JSON.parse(effectsField.value) as unknown);
  useEffect(() => {
    if (!removeRequested || effectsField.isSaving) return;
    if (effects.length === 0 && !effectsField.error) hideEffects();
    setRemoveRequested(false);
  }, [removeRequested, effectsField.isSaving, effectsField.error, effects.length, hideEffects]);

  if (effects.length === 0 && !hasOpened) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setHasOpened(true);
          setEditorOpen(true);
        }}
      >
        + Add effects
      </button>
    );
  }

  return (
    <details
      className={`${DRAFT_FIELD_CLASS} rounded-lg border border-base-300 bg-base-100/50 p-2`}
      data-flashing={effectsField.inputProps['data-flashing']}
      data-flash-parity={effectsField.inputProps['data-flash-parity']}
      open={editorOpen}
      onToggle={(event) => {
        setEditorOpen(event.currentTarget.open);
        if (event.currentTarget.open) setHasOpened(true);
      }}
    >
      <summary className="cursor-pointer text-xs font-medium">
        Effects{effects.length > 0 ? ` (${effects.length})` : ''}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-base-content/60">
          Add character-specific mechanics here. “This inventory item” is the safest way to bind a
          bonus to one weapon; it becomes inactive while that item is unequipped.
        </p>
        <EffectsEditor
          key={editorVersion}
          effects={effects}
          inventoryItems={inventory}
          portable={false}
          onChange={(next) => effectsField.setValue(JSON.stringify(next))}
          onValidityChange={setValid}
        />
        {effectsField.error && <p className="text-xs text-error">{effectsField.error}</p>}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm text-error"
            onClick={() => {
              setRemoveRequested(true);
              effectsField.setValue('[]');
              effectsField.commit();
            }}
          >
            Remove effects
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!valid}
            onClick={effectsField.commit}
          >
            {effectsField.isSaving ? 'Save latest changes' : 'Save effects'}
          </button>
        </div>
      </div>
    </details>
  );
}

function traitEffectSummary(
  effect: TraitEffect,
  inventory: CharacterDetail['inventory'] = [],
): string {
  let summary = effectPreview(effect);
  if (effect.target === 'dr' && effect.hitLocation) {
    summary += ` at ${effect.hitLocation}`;
  }
  const weaponSelector = effect.weaponSelector;
  if (weaponSelector?.kind === 'inventory_item') {
    const item = inventory.find((candidate) => candidate.id === weaponSelector.inventoryItemId);
    const itemLabel = item ? `“${item.name}”` : `inventory item ${weaponSelector.inventoryItemId}`;
    summary = summary.replace('selected inventory item', itemLabel);
  }
  return summary;
}

function TraitConfiguredDetails({ trait }: { trait: TraitOut }) {
  const libraryEffects = trait.libraryMechanics?.effects;
  return (
    <div className="space-y-3 text-xs">
      <LibraryMechanicsNote mechanics={trait.libraryMechanics} />
      {trait.modifiers.length > 0 && (
        <div>
          <h4 className="label-eyebrow mb-1">Modifiers</h4>
          <ul className="space-y-1">
            {trait.modifiers.map((modifier) => (
              <li key={`${modifier.category}:${modifier.name}`}>
                <span className="font-medium">{modifier.name}</span>{' '}
                <span className="text-base-content/60">
                  ({modifier.costValue >= 0 ? '+' : ''}
                  {modifier.costValue}
                  {modifier.costType === 'percent' ? '%' : ' pts'})
                </span>
                {modifier.description && (
                  <span className="block text-base-content/60">{modifier.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(libraryEffects) && libraryEffects.length > 0 && (
        <div>
          <h4 className="label-eyebrow mb-1">Library effects</h4>
          <ul className="space-y-1 text-base-content/70">
            {libraryEffects.map((effect, index) => (
              <li key={`${traitEffectSummary(effect)}:${index}`}>{traitEffectSummary(effect)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TraitCustomEffects({
  trait,
  inventory,
}: {
  trait: TraitOut;
  inventory: CharacterDetail['inventory'];
}) {
  const effects = trait.customEffects ?? [];
  if (effects.length === 0) return null;
  return (
    <div>
      <h4 className="label-eyebrow mb-1">Effects</h4>
      <ul className="space-y-1 text-xs text-base-content/70">
        {effects.map((effect, index) => (
          <li key={`${traitEffectSummary(effect, inventory)}:${index}`}>
            {traitEffectSummary(effect, inventory)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TraitRow({
  characterId,
  trait,
  inventory,
  canWrite,
  expanded,
  position,
  dragging,
  visible,
  onToggle,
  onDragStart,
  onDragEnd,
  onDrop,
  onMove,
}: TraitRowProps) {
  const toasts = useToasts();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rowPatch = useEntityRowPatch('character_trait', trait.id, characterId, trait.name);

  const nameField = useEntityNameField(rowPatch, trait.name);
  // Unbounded (no min/max) — matches the previous inline validator,
  // which only checked "is this an integer."
  const pointsField = useEntityPointsField(
    rowPatch,
    trait.name,
    trait.points,
    intParser(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
  );
  const notesField = useDraftField<string | null>({
    name: `${trait.name} notes`,
    serverValue: trait.notes ?? '',
    parse: (s) => (s.trim().length === 0 ? null : s),
    onSave: (v) => rowPatch.patch('notes', v),
    flashKey: rowPatch.flashKey('notes'),
  });
  const saving = nameField.isSaving || pointsField.isSaving || notesField.isSaving;
  const hasSourceRules = Boolean(trait.libraryMechanics || trait.modifiers.length > 0);
  const hasCustomEffects = (trait.customEffects?.length ?? 0) > 0;
  const canExpand = canWrite || Boolean(trait.notes) || hasSourceRules || hasCustomEffects;

  const removeTrait = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_trait',
        entityId: trait.id,
        humanName: `trait "${trait.name}"`,
        characterId,
        prevValue: trait,
      });
    } catch (err) {
      toasts.push(`Couldn't delete trait — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  return (
    <tbody
      aria-label={trait.name}
      className={dragging ? 'opacity-50' : undefined}
      hidden={!visible}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <tr
        id={`trait-${trait.id}`}
        className={`${expanded ? 'bg-primary/5 ' : ''}scroll-mt-24 target:!bg-primary/20 target:outline target:outline-2 target:outline-primary`}
      >
        <td className="w-9 px-1 sm:px-2">
          <DragHandle
            aria-label={`Reorder ${trait.name}, row ${position + 1}`}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              onMove(event.key === 'ArrowUp' ? -1 : 1);
            }}
          />
        </td>
        <td className="min-w-0 py-2 pl-1 sm:pl-2">
          <span className="block min-w-0 break-words font-medium">{trait.name}</span>
          <span className="mt-0.5 block text-[10px] capitalize text-base-content/60 sm:hidden">
            {traitKindLabel(trait.kind)}
          </span>
          {trait.variantName && (
            <span className="block break-words text-[10px] italic text-base-content/60">
              {trait.variantName}
            </span>
          )}
        </td>
        <td className="w-0 overflow-hidden p-0 text-center text-xs capitalize text-base-content/70 sm:w-32 sm:px-3">
          <span className="hidden sm:inline">{traitKindLabel(trait.kind)}</span>
        </td>
        <td className="num w-11 text-right text-xs text-base-content/70 sm:w-14">{trait.points}</td>
        <td className="num w-12 text-right text-xs text-base-content/70 sm:w-16">
          {trait.level ?? '—'}
        </td>
        <td className="w-14 px-1 text-right sm:w-20 sm:px-2">
          {canExpand && (
            <button
              type="button"
              className="btn btn-ghost btn-xs min-h-11 w-full min-w-0 gap-1 px-0 sm:min-h-0 sm:px-1"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Close' : canWrite ? 'Edit' : 'View'} ${trait.name}`}
            >
              <span className="hidden sm:inline">
                {expanded ? 'Done' : canWrite ? 'Edit' : 'Details'}
              </span>
              <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
            </button>
          )}
        </td>
      </tr>
      {(canWrite || expanded) && (
        <tr hidden={!expanded}>
          <td colSpan={6} className="border-b border-base-300 bg-base-200 p-0">
            {canWrite ? (
              <div className="space-y-3 px-3 py-4 md:px-14 md:py-5">
                <header className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">Edit {trait.name}</h3>
                  {saving && (
                    <span className="text-xs text-warning" aria-live="polite">
                      Saving…
                    </span>
                  )}
                </header>
                <div
                  className={`grid grid-cols-1 gap-2 md:gap-3 ${
                    trait.level == null
                      ? 'md:grid-cols-[minmax(0,1fr)_10rem_6rem]'
                      : 'md:grid-cols-[minmax(0,1fr)_10rem_6rem_6rem]'
                  }`}
                >
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Name</legend>
                    <input
                      aria-label={`${trait.name} name`}
                      className={`${DRAFT_FIELD_CLASS} input input-sm w-full`}
                      {...nameField.inputProps}
                    />
                  </fieldset>
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Type</legend>
                    <span className="flex min-h-8 items-center text-sm capitalize text-base-content/70">
                      {traitKindLabel(trait.kind)}
                    </span>
                  </fieldset>
                  {trait.level != null && (
                    <fieldset className="fieldset min-w-0 p-0">
                      <legend className="fieldset-legend text-xs">Level</legend>
                      <span className="num flex min-h-8 items-center justify-end text-sm text-base-content/70">
                        {trait.level}
                      </span>
                    </fieldset>
                  )}
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Points</legend>
                    <input
                      aria-label={`${trait.name} points`}
                      className={`${DRAFT_FIELD_CLASS} input input-sm num w-full text-right`}
                      inputMode="numeric"
                      {...pointsField.inputProps}
                    />
                  </fieldset>
                </div>
                {trait.variantName && (
                  <p className="text-xs text-base-content/70">
                    <span className="font-medium">Variant:</span> {trait.variantName}
                  </p>
                )}
                <fieldset className="fieldset min-w-0 p-0">
                  <legend className="fieldset-legend text-xs">Description &amp; notes</legend>
                  <textarea
                    aria-label={`${trait.name} description and notes`}
                    className={`${DRAFT_FIELD_CLASS} textarea textarea-sm min-h-20 w-full`}
                    value={notesField.value}
                    onChange={(event) => notesField.setValue(event.target.value)}
                    onBlur={notesField.inputProps.onBlur}
                    data-flashing={notesField.inputProps['data-flashing']}
                    data-flash-parity={notesField.inputProps['data-flash-parity']}
                  />
                </fieldset>
                {notesField.value && (
                  <FoldSection
                    preferenceKey={`${trait.id}:description-preview`}
                    title="Preview description"
                    defaultOpen={false}
                    className="text-xs"
                  >
                    <Markdown source={notesField.value} />
                  </FoldSection>
                )}
                {hasSourceRules && (
                  <details className="border-t border-base-300 pt-1">
                    <summary className="cursor-pointer py-2 text-xs text-base-content/70">
                      Source &amp; rules
                    </summary>
                    <div className="pb-2">
                      <TraitConfiguredDetails trait={trait} />
                    </div>
                  </details>
                )}
                <div className={hasSourceRules ? undefined : 'border-t border-base-300 pt-3'}>
                  <CharacterEffectsEditor trait={trait} inventory={inventory} rowPatch={rowPatch} />
                </div>
                <footer className="flex items-center justify-between gap-3 border-t border-base-300 pt-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-error"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete trait
                  </button>
                  <button type="button" className="btn btn-sm" onClick={onToggle}>
                    Done
                  </button>
                </footer>
                <ConfirmDialog
                  open={confirmDelete}
                  title={`Delete trait "${trait.name}"?`}
                  confirmLabel="Delete"
                  tone="error"
                  onConfirm={() => {
                    setConfirmDelete(false);
                    void removeTrait();
                  }}
                  onCancel={() => setConfirmDelete(false)}
                />
              </div>
            ) : (
              <div className="space-y-3 px-3 py-4 text-sm md:px-14 md:py-5">
                {trait.notes && <Markdown source={trait.notes} />}
                {hasSourceRules && <TraitConfiguredDetails trait={trait} />}
                {hasCustomEffects && <TraitCustomEffects trait={trait} inventory={inventory} />}
              </div>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function TraitsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  return <TraitsTable key={character.id} character={character} canWrite={canWrite} />;
}

function TraitsTable({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState(() => readTraitTablePreferences(character.id));
  const [saveFailed, setSaveFailed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const customOrder = [
    ...preferences.order.filter((id) => character.traits.some((trait) => trait.id === id)),
    ...character.traits
      .filter((trait) => !preferences.order.includes(trait.id))
      .map((trait) => trait.id),
  ];

  function save(next: TraitTablePreferences) {
    setPreferences(next);
    setSaveFailed(!saveTraitTablePreferences(character.id, next));
  }

  function compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
  }

  const sortedTraits = [...character.traits].sort((left, right) => {
    if (preferences.sort === 'custom') {
      return customOrder.indexOf(left.id) - customOrder.indexOf(right.id);
    }
    let comparison = 0;
    if (preferences.sort === 'name') comparison = compareText(left.name, right.name);
    else if (preferences.sort === 'kind') comparison = compareText(left.kind, right.kind);
    else if (preferences.sort === 'points') comparison = left.points - right.points;
    else {
      if (left.level == null || right.level == null) {
        if (left.level == null && right.level == null) comparison = 0;
        else comparison = left.level == null ? 1 : -1;
      } else comparison = left.level - right.level;
    }
    return (
      (preferences.descending ? -comparison : comparison) ||
      customOrder.indexOf(left.id) - customOrder.indexOf(right.id)
    );
  });

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTraits = sortedTraits.filter((trait) => {
    if (!normalizedQuery) return true;
    return [
      trait.name,
      traitKindLabel(trait.kind),
      trait.variantName ?? '',
      trait.notes ?? '',
      ...trait.modifiers.flatMap((modifier) => [modifier.name, modifier.description ?? '']),
      ...(trait.customEffects ?? []).map((effect) =>
        traitEffectSummary(effect, character.inventory),
      ),
      ...(trait.libraryMechanics?.effects ?? []).map((effect) => traitEffectSummary(effect)),
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const visibleTraitIds = new Set(visibleTraits.map((trait) => trait.id));

  function sortBy(sort: Exclude<TraitSort, 'custom'>) {
    save({
      ...preferences,
      sort,
      descending: preferences.sort === sort ? !preferences.descending : false,
    });
  }

  function moveTrait(id: string, targetId: string) {
    const displayedOrder = sortedTraits.map((trait) => trait.id);
    const from = displayedOrder.indexOf(id);
    const to = displayedOrder.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...displayedOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save({ order: next, sort: 'custom', descending: false });
    const visiblePosition = visibleTraits.findIndex((trait) => trait.id === targetId) + 1;
    setAnnouncement(
      `${character.traits.find((trait) => trait.id === id)?.name ?? 'Trait'} moved to position ${visiblePosition}.`,
    );
  }

  function moveBy(id: string, direction: -1 | 1) {
    const visibleOrder = visibleTraits.map((trait) => trait.id);
    const current = visibleOrder.indexOf(id);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= visibleOrder.length) return;
    moveTrait(id, visibleOrder[target] ?? id);
  }

  function sortHeader(
    label: string,
    sort: Exclude<TraitSort, 'custom'>,
    headerClassName = '',
    shortLabel?: string,
    hideButtonOnMobile = false,
  ) {
    const active = preferences.sort === sort;
    return (
      <th
        scope="col"
        className={headerClassName}
        aria-sort={active ? (preferences.descending ? 'descending' : 'ascending') : 'none'}
      >
        <button
          type="button"
          className={`btn btn-ghost btn-xs h-auto min-h-0 whitespace-nowrap px-1 py-1 font-semibold ${hideButtonOnMobile ? 'hidden sm:inline-flex' : ''} ${headerClassName.includes('text-right') ? 'w-full justify-end' : 'justify-start'}`}
          onClick={() => sortBy(sort)}
          aria-label={`Sort by ${label}`}
        >
          <span className={shortLabel ? 'hidden sm:inline' : undefined}>{label}</span>
          {shortLabel && <span className="sm:hidden">{shortLabel}</span>}
          <span aria-hidden="true">{active ? (preferences.descending ? '↓' : '↑') : '↕'}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="card p-0">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0 flex-1">
          <p className="label-eyebrow">Traits</p>
          <h2 className="font-display text-2xl">Advantages, disadvantages & quirks</h2>
          <p className="mt-1 text-xs text-base-content/60">
            {character.traits.length} {character.traits.length === 1 ? 'trait' : 'traits'}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            className={`btn btn-sm shrink-0 ${showAdd ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => setShowAdd((current) => !current)}
            aria-expanded={showAdd}
          >
            {showAdd ? 'Close add form' : '+ Add trait'}
          </button>
        )}
      </header>

      {showAdd && (
        <div className="px-4 pb-3 sm:px-5">
          <AddTraitForm
            characterId={character.id}
            campaignId={character.campaignId ?? null}
            canWrite={canWrite}
          />
        </div>
      )}

      {character.traits.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-base-content/60 sm:px-5">No traits yet.</p>
      ) : (
        <>
          <div className="px-4 pb-3 sm:px-5">
            <label className="input input-sm flex w-full items-center gap-2 bg-base-200">
              <svg
                className="h-4 w-4 shrink-0 fill-none stroke-current text-base-content/50"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6.5" />
                <path d="m15 15 5 5" />
              </svg>
              <input
                type="search"
                className="min-w-0 grow"
                aria-label="Search traits"
                placeholder="Search traits…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="border-t border-base-300">
            <table className="table table-sm w-full table-fixed" aria-label="Traits">
              <caption className="sr-only">
                Character traits. Sort with column headings or use row handles for custom order.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-9 px-1 sm:px-2">
                    <span className="sr-only">Custom order</span>
                  </th>
                  {sortHeader('Trait', 'name')}
                  {sortHeader('Type', 'kind', 'w-0 p-0 text-center sm:w-32', undefined, true)}
                  {sortHeader('Points', 'points', 'w-11 text-right sm:w-14', 'Pts')}
                  {sortHeader('Level', 'level', 'w-12 text-right sm:w-16', 'Lvl')}
                  <th scope="col" className="w-14 px-1 sm:w-20 sm:px-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              {sortedTraits.map((trait) => (
                <TraitRow
                  key={trait.id}
                  characterId={character.id}
                  trait={trait}
                  inventory={character.inventory}
                  canWrite={canWrite}
                  expanded={expandedId === trait.id}
                  position={visibleTraits.findIndex((candidate) => candidate.id === trait.id)}
                  dragging={draggingId === trait.id}
                  visible={visibleTraitIds.has(trait.id)}
                  onToggle={() =>
                    setExpandedId((current) => (current === trait.id ? null : trait.id))
                  }
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', trait.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggingId(trait.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDrop={() => {
                    if (draggingId) moveTrait(draggingId, trait.id);
                    setDraggingId(null);
                  }}
                  onMove={(direction) => moveBy(trait.id, direction)}
                />
              ))}
            </table>
          </div>
          {visibleTraits.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-base-content/60">
              No traits match “{query}”.
            </p>
          )}
          <div className="border-t border-base-300 px-4 py-2 text-[10px] text-base-content/50 sm:px-5">
            Click a column heading to sort. Drag a row handle or focus it and use ↑/↓ for custom
            order.
          </div>
          {saveFailed && (
            <output className="block px-4 pb-3 text-xs text-warning sm:px-5">
              This browser could not save the trait order. It will reset when you leave this page.
            </output>
          )}
          <output className="sr-only" aria-live="polite">
            {announcement}
          </output>
        </>
      )}
    </section>
  );
}
