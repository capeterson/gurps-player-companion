import { useState } from 'react';
import { computeTraitCost } from '../../../../shared/domain/traitCost.ts';
import type { LibraryTraitOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { TraitOut } from '../../../../shared/schemas/trait.ts';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import {
  LibraryModifierPicker,
  applyModifierToggle,
} from '../../../components/ui/LibraryModifierPicker.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { intParser } from '../../../lib/parsers.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';
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
  libraryTraitId: string | null;
  /** When non-empty, list of selected library modifier names to write into trait.modifiers. */
  selectedModifierNames: readonly string[];
  /** Snapshot of the picked trait's catalogue entry (for resolving modifier metadata at create time). */
  pickedTrait: LibraryTraitOut | null;
}

function AddTraitForm({ characterId, campaignId, canWrite }: AddTraitFormProps) {
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TraitKind>('advantage');
  const [points, setPoints] = useState('0');
  const [creating, setCreating] = useState(false);
  // When the user picks a library entry both the id (for the FK) and
  // the full entry (for the modifier picker) are captured here.  The
  // entry is dropped whenever the user types past the prefilled name.
  const [pickedLibraryId, setPickedLibraryId] = useState<string | null>(null);
  const [pickedTrait, setPickedTrait] = useState<LibraryTraitOut | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<readonly string[]>([]);

  const { fetchOptions } = useLibraryFetcher<LibraryTraitOut>('traits', campaignId);

  // Live cost preview when the picker is open: re-derives points from
  // the selected modifier names, so the form's `points` field stays in
  // sync with what the user is toggling.
  const livePoints =
    pickedTrait !== null
      ? computeTraitCost(
          pickedTrait.basePoints,
          pickedTrait.availableModifiers
            .filter((m) => selectedModifiers.includes(m.name))
            .map((m) => ({ costType: m.costType, costValue: m.costValue })),
        )
      : null;

  async function submit(snap: TraitSnapshot) {
    setCreating(true);
    try {
      const modifiers =
        snap.pickedTrait !== null
          ? snap.pickedTrait.availableModifiers.filter((m) =>
              snap.selectedModifierNames.includes(m.name),
            )
          : [];
      await enqueueCreate({
        entityClass: 'character_trait',
        entityId: newClientId(),
        humanName: 'trait',
        characterId,
        attemptedValue: {
          name: snap.name,
          kind: snap.kind,
          points: snap.points,
          characterId,
          ...(snap.libraryTraitId ? { libraryTraitId: snap.libraryTraitId } : {}),
          ...(modifiers.length > 0 ? { modifiers } : {}),
        },
      });
      // Per AGENTS.md (rule 1: never silently discard user edits): only
      // clear fields whose current value still matches the snapshot we
      // submitted.  If the user has started typing the next trait while
      // this enqueue was in flight, leave that draft alone.
      if (name === snap.nameRaw) setName('');
      if (points === snap.pointsRaw) setPoints('0');
      setPickedLibraryId(null);
      setPickedTrait(null);
      setSelectedModifiers([]);
    } catch (err) {
      toasts.push(`Couldn't add trait — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCreating(false);
    }
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
        const submittedPoints =
          livePoints !== null && selectedModifiers.length > 0
            ? livePoints
            : Number.isFinite(pParsed)
              ? pParsed
              : 0;
        void submit({
          name: name.trim(),
          nameRaw: name,
          kind,
          points: submittedPoints,
          pointsRaw: points,
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
        <label className="form-control w-20">
          <span className="label-text text-xs">Pts</span>
          <input
            className="input input-bordered input-sm num"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add'}
        </button>
      </div>
      {pickedTrait !== null && pickedTrait.availableModifiers.length > 0 && (
        <LibraryModifierPicker
          basePoints={pickedTrait.basePoints}
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

  const patchTrait = (field: string, value: unknown) =>
    enqueueFieldPatch({
      entityClass: 'character_trait',
      entityId: trait.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: `${trait.name} ${field}`,
      flashKey: makeFlashKey('character_trait', trait.id, field),
      characterId,
    });

  const nameField = useDraftField<string>({
    name: `${trait.name} name`,
    serverValue: trait.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchTrait('name', v),
    flashKey: makeFlashKey('character_trait', trait.id, 'name'),
  });
  const pointsField = useDraftField<number>({
    name: `${trait.name} points`,
    serverValue: trait.points,
    // Unbounded (no min/max) — matches the previous inline validator,
    // which only checked "is this an integer."
    parse: intParser(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
    onSave: (v) => patchTrait('points', v),
    flashKey: makeFlashKey('character_trait', trait.id, 'points'),
  });
  const notesField = useDraftField<string | null>({
    name: `${trait.name} notes`,
    serverValue: trait.notes ?? '',
    parse: (s) => (s.trim().length === 0 ? null : s),
    onSave: (v) => patchTrait('notes', v),
    flashKey: makeFlashKey('character_trait', trait.id, 'notes'),
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
          <span className="font-medium">{trait.name}</span>
        )}
        <p className="text-xs text-base-content/60 capitalize">{trait.kind.replace('_', ' ')}</p>
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
          onClick={() => {
            if (confirm(`Delete trait "${trait.name}"?`)) void removeTrait();
          }}
          aria-label={`Delete trait ${trait.name}`}
        >
          ✕
        </button>
      )}
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
