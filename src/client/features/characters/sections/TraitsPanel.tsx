import { useState } from 'react';
import { computeTraitCost } from '../../../../shared/domain/traitCost.ts';
import type { LibraryTraitOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { TraitOut, TraitVariant } from '../../../../shared/schemas/trait.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import {
  LibraryModifierPicker,
  applyModifierToggle,
} from '../../../components/ui/LibraryModifierPicker.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { intParser } from '../../../lib/parsers.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';
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

  const { fetchOptions } = useLibraryFetcher<LibraryTraitOut>('traits', campaignId);
  const { creating, submit: submitEntity } = useAddEntityForm({
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
    );
  }

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-col gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
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
          (selectedModifiers.length > 0 ||
            isLeveled ||
            selectedVariant !== null);
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
              onChange={(v) => {
                setName(v);
                // Picking a library entry sets `pickedLibraryId`; if the
                // user then edits the name, drop the link AND the
                // captured catalogue entry so we don't claim the create
                // came from the library when it didn't.
                setPickedLibraryId(null);
                setPickedTrait(null);
                setSelectedModifiers([]);
              }}
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
              onChange={(e) => setName(e.target.value)}
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
            {TRAIT_KINDS.map((k) => (
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
            <span className="mt-1 text-[11px] text-dim leading-snug">
              {selectedVariant.description}
            </span>
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
  canWrite: boolean;
}

function TraitRow({ characterId, trait, canWrite }: TraitRowProps) {
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
    <li className="grid grid-cols-[1fr_auto_auto] gap-2 items-start py-2 border-b border-base-300 last:border-0">
      <div>
        {canWrite ? (
          <input
            aria-label={`${trait.name} name`}
            className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm w-full font-medium`}
            value={nameField.value}
            onChange={nameField.inputProps.onChange}
            onBlur={nameField.inputProps.onBlur}
            data-flashing={nameField.inputProps['data-flashing']}
            data-flash-parity={nameField.inputProps['data-flash-parity']}
          />
        ) : (
          <span className="font-medium">
            {trait.name}
            {trait.level != null && trait.level > 0 && (
              <span className="ml-1 text-base-content/70 num">{trait.level}</span>
            )}
            {trait.variantName && (
              <span className="ml-1 text-[11px] text-base-content/60 italic">
                ({trait.variantName})
              </span>
            )}
          </span>
        )}
        <p className="text-xs text-base-content/60 capitalize">
          {trait.kind.replace('_', ' ')}
          {trait.level != null && trait.level > 0 && canWrite && (
            <span className="ml-2 not-italic normal-case">
              <span className="text-warning">level {trait.level}</span>
            </span>
          )}
          {trait.variantName && canWrite && (
            <span className="ml-2 not-italic normal-case italic text-base-content/70">
              {trait.variantName}
            </span>
          )}
        </p>
        {canWrite ? (
          <textarea
            aria-label={`${trait.name} notes`}
            className={`${DRAFT_FIELD_CLASS} textarea textarea-ghost textarea-sm w-full mt-1 text-xs`}
            placeholder="Notes…"
            value={notesField.value}
            onChange={(e) => notesField.setValue(e.target.value)}
            onBlur={notesField.inputProps.onBlur}
            data-flashing={notesField.inputProps['data-flashing']}
            data-flash-parity={notesField.inputProps['data-flash-parity']}
            rows={1}
          />
        ) : (
          trait.notes && <p className="text-xs text-base-content/60 mt-1">{trait.notes}</p>
        )}
      </div>
      <div className="text-right">
        {canWrite ? (
          <input
            aria-label={`${trait.name} points`}
            className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm w-20 num text-right`}
            value={pointsField.value}
            onChange={pointsField.inputProps.onChange}
            onBlur={pointsField.inputProps.onBlur}
            data-flashing={pointsField.inputProps['data-flashing']}
            data-flash-parity={pointsField.inputProps['data-flash-parity']}
          />
        ) : (
          <span className="num">{trait.points}</span>
        )}
        <p className="label-eyebrow">pts</p>
      </div>
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete trait ${trait.name}`}
        >
          ✕
        </button>
      )}
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
    </li>
  );
}

export function TraitsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const grouped = new Map<TraitKind, TraitOut[]>();
  for (const t of character.traits) {
    const arr = grouped.get(t.kind) ?? [];
    arr.push(t);
    grouped.set(t.kind, arr);
  }

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Traits</p>
          <h2 className="font-display text-2xl">Advantages, disadvantages & quirks</h2>
        </div>
        <p className="text-xs text-base-content/60">
          {character.traits.length} {character.traits.length === 1 ? 'entry' : 'entries'}
        </p>
      </header>

      <AddTraitForm
        characterId={character.id}
        campaignId={character.campaignId ?? null}
        canWrite={canWrite}
      />

      {character.traits.length === 0 ? (
        <p className="text-sm text-base-content/60">No traits yet.</p>
      ) : (
        TRAIT_KINDS.filter((k) => (grouped.get(k)?.length ?? 0) > 0).map((kind) => (
          <div key={kind}>
            <h3 className="label-eyebrow mt-2">{kind.replace('_', ' ')}</h3>
            <ul>
              {(grouped.get(kind) ?? []).map((t) => (
                <TraitRow key={t.id} characterId={character.id} trait={t} canWrite={canWrite} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
