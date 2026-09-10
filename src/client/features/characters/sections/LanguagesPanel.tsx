import { useState } from 'react';
import type { LibraryLanguageOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import {
  FLUENCY_LABELS,
  FLUENCY_LEVELS,
  type FluencyLevel,
  type LanguageOut,
  computeLanguagePoints,
} from '../../../../shared/schemas/language.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { DRAFT_FIELD_CLASS } from '../../../hooks/useDraftField.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import {
  useEntityEnumField,
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
} from './useEntityRowPatch.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

interface AddLanguageFormProps {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
}

interface LanguageSnapshot {
  name: string;
  nameRaw: string;
  spokenFluency: FluencyLevel;
  writtenFluency: FluencyLevel;
  points: number;
  pointsRaw: string;
  libraryLanguageId: string | null;
}

function AddLanguageForm({ characterId, campaignId, canWrite }: AddLanguageFormProps) {
  const [name, setName] = useState('');
  const [spoken, setSpoken] = useState<FluencyLevel>('native');
  const [written, setWritten] = useState<FluencyLevel>('native');
  // `null` means "follow the fluency dropdowns"; a string means the user
  // typed an override and we stop re-seeding it from the fluency pair.
  const [pointsOverride, setPointsOverride] = useState<string | null>(null);
  const [pickedLibraryId, setPickedLibraryId] = useState<string | null>(null);
  const [pointsError, setPointsError] = useState<string | null>(null);

  const suggestedPoints = computeLanguagePoints(spoken, written);
  // An empty override means "follow the fluency dropdowns" again.
  const points =
    pointsOverride === null || pointsOverride === '' ? String(suggestedPoints) : pointsOverride;

  const { fetchOptions } = useLibraryFetcher<LibraryLanguageOut>('languages', campaignId);
  const {
    creating,
    flashProps,
    submit: submitEntity,
  } = useAddEntityForm({
    entityClass: 'character_language',
    characterId,
    label: 'language',
  });

  async function submit(snap: LanguageSnapshot) {
    await submitEntity(
      {
        name: snap.name,
        spokenFluency: snap.spokenFluency,
        writtenFluency: snap.writtenFluency,
        points: snap.points,
        characterId,
        ...(snap.libraryLanguageId ? { libraryLanguageId: snap.libraryLanguageId } : {}),
      },
      () => {
        // AGENTS.md rule 1: only clear a field whose *current* value still
        // matches what we submitted, compared against live state via the
        // functional setter — an edit made during the await survives.
        setName((cur) => (cur === snap.nameRaw ? '' : cur));
        setPointsOverride((cur) => (cur === snap.pointsRaw ? null : cur));
        // Same guard on the library link: a pick made while the create
        // was in flight must survive (the name it set did).
        setPickedLibraryId((cur) => (cur === snap.libraryLanguageId ? null : cur));
        setPointsError(null);
      },
    );
  }

  if (!canWrite) return null;

  return (
    <form
      {...flashProps}
      className="field-rollback-flash flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // Never silently substitute the auto-suggested points for a
        // value the user actually typed: an invalid draft blocks the
        // submit (and stays in the box for correction) instead of
        // durably saving something they never entered.
        const override = pointsOverride;
        const hasOverride = override !== null && override.trim() !== '';
        const parsed = Number(override);
        if (hasOverride && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100)) {
          setPointsError('Points must be an integer between 0 and 100');
          return;
        }
        setPointsError(null);
        void submit({
          name: name.trim(),
          nameRaw: name,
          spokenFluency: spoken,
          writtenFluency: written,
          points: hasOverride ? parsed : suggestedPoints,
          pointsRaw: pointsOverride ?? String(suggestedPoints),
          libraryLanguageId: pickedLibraryId,
        });
      }}
    >
      <div className="form-control flex-1 min-w-[10rem]">
        <span className="label-text text-xs" id="add-language-name-label">
          Language
        </span>
        {campaignId ? (
          <LibraryAutocomplete<LibraryLanguageOut>
            value={name}
            onChange={(v) => {
              setName(v);
              setPickedLibraryId(null);
            }}
            onPick={(opt) => {
              setName(opt.name);
              setPickedLibraryId(opt.id);
              // A sign language has no written form at all — 'n/a' rather
              // than 'none', which would read as "can't read it".
              if (opt.isSignLanguage) setWritten('n/a');
            }}
            fetchOptions={fetchOptions}
            getOptionKey={(o) => o.id}
            renderOption={(o) => (
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">{o.name}</span>
                {o.isSignLanguage && <span className="text-xs text-base-content/70">sign</span>}
              </span>
            )}
            placeholder="e.g. Latin"
            inputProps={{ 'aria-labelledby': 'add-language-name-label' }}
          />
        ) : (
          <input
            aria-labelledby="add-language-name-label"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Latin"
          />
        )}
      </div>
      <label className="form-control">
        <span className="label-text text-xs">Spoken</span>
        <select
          className="select select-bordered select-sm"
          value={spoken}
          onChange={(e) => setSpoken(e.target.value as FluencyLevel)}
        >
          {FLUENCY_LEVELS.map((f) => (
            <option key={f} value={f}>
              {FLUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-control">
        <span className="label-text text-xs">Written</span>
        <select
          className="select select-bordered select-sm"
          value={written}
          onChange={(e) => setWritten(e.target.value as FluencyLevel)}
        >
          {FLUENCY_LEVELS.map((f) => (
            <option key={f} value={f}>
              {FLUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-control w-20">
        <span className="label-text text-xs">Pts</span>
        <input
          className="input input-bordered input-sm num"
          value={points}
          onChange={(e) => {
            setPointsOverride(e.target.value);
            setPointsError(null);
          }}
        />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
      </button>
      {pointsError && <p className="basis-full text-error text-xs">{pointsError}</p>}
    </form>
  );
}

interface LanguageRowProps {
  characterId: string;
  language: LanguageOut;
  canWrite: boolean;
}

function LanguageRow({ characterId, language, canWrite }: LanguageRowProps) {
  const toasts = useToasts();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rowPatch = useEntityRowPatch('character_language', language.id, characterId, language.name);

  const nameField = useEntityNameField(rowPatch, language.name);
  const spokenField = useEntityEnumField<FluencyLevel>(
    rowPatch,
    `${language.name} spoken fluency`,
    'spokenFluency',
    language.spokenFluency,
    FLUENCY_LEVELS,
  );
  const writtenField = useEntityEnumField<FluencyLevel>(
    rowPatch,
    `${language.name} written fluency`,
    'writtenFluency',
    language.writtenFluency,
    FLUENCY_LEVELS,
  );
  const pointsField = useEntityPointsField(rowPatch, language.name, language.points, (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error('non-negative integer only');
    }
    return n;
  });

  const removeLanguage = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_language',
        entityId: language.id,
        humanName: `language "${language.name}"`,
        characterId,
        prevValue: language,
      });
    } catch (err) {
      toasts.push(`Couldn't delete language — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  return (
    <li className="grid grid-cols-[1fr_6rem_6rem_4rem_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      {canWrite ? (
        <input
          aria-label={`${language.name} name`}
          className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm font-medium`}
          {...nameField.inputProps}
        />
      ) : (
        <span className="font-medium">{language.name}</span>
      )}
      {canWrite ? (
        <select
          aria-label={`${language.name} spoken fluency`}
          className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm`}
          {...spokenField.selectProps}
        >
          {FLUENCY_LEVELS.map((f) => (
            <option key={f} value={f}>
              {FLUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-center">{FLUENCY_LABELS[language.spokenFluency]}</span>
      )}
      {canWrite ? (
        <select
          aria-label={`${language.name} written fluency`}
          className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm`}
          {...writtenField.selectProps}
        >
          {FLUENCY_LEVELS.map((f) => (
            <option key={f} value={f}>
              {FLUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-center">{FLUENCY_LABELS[language.writtenFluency]}</span>
      )}
      {canWrite ? (
        <input
          aria-label={`${language.name} points`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...pointsField.inputProps}
        />
      ) : (
        <span className="num text-right">{language.points}</span>
      )}
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete language ${language.name}`}
        >
          ✕
        </button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete language "${language.name}"?`}
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          setConfirmDelete(false);
          void removeLanguage();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

export function LanguagesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const total = character.languages.reduce((sum, l) => sum + l.points, 0);
  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Languages</p>
          <h2 className="font-display text-2xl">Languages</h2>
        </div>
        <p className="text-xs text-base-content/60">
          {character.languages.length} {character.languages.length === 1 ? 'language' : 'languages'}
          {' · '}
          <span className="num">{total}</span> pts
        </p>
      </header>

      <AddLanguageForm
        characterId={character.id}
        campaignId={character.campaignId ?? null}
        canWrite={canWrite}
      />

      {character.languages.length === 0 ? (
        <p className="text-sm text-base-content/60">No languages yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_6rem_6rem_4rem_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Language</span>
            <span className="text-center">Spoken</span>
            <span className="text-center">Written</span>
            <span className="text-right">Pts</span>
            <span />
          </div>
          <ul>
            {character.languages.map((l) => (
              <LanguageRow key={l.id} characterId={character.id} language={l} canWrite={canWrite} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
