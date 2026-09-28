import { useId, useState } from 'react';
import type { LibraryLanguageOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import {
  FLUENCY_LABELS,
  FLUENCY_LEVELS,
  type FluencyLevel,
  type LanguageOut,
  computeLanguagePoints,
} from '../../../../shared/schemas/language.ts';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { Table, TableBody, TableHeader } from '../../../components/ui/Table.tsx';
import { DRAFT_FIELD_CLASS } from '../../../hooks/useDraftField.ts';
import { useFlashGroup } from '../../../hooks/useFlashGroup.ts';
import { type UseAddEntityFormReturn, useAddEntityForm } from './useAddEntityForm.ts';
import { useConfirmedEntityDelete } from './useConfirmedEntityDelete.tsx';
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
  submission: UseAddEntityFormReturn;
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

function AddLanguageForm({ characterId, campaignId, canWrite, submission }: AddLanguageFormProps) {
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

  const { fetchOptions, allSources, setAllSources } = useLibraryFetcher<LibraryLanguageOut>(
    'languages',
    campaignId,
  );
  const { creating, flashProps, submit: submitEntity } = submission;

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
      className="field-rollback-flash grid grid-cols-2 items-end gap-3 rounded-box border border-base-300 bg-base-200 p-3 sm:grid-cols-4"
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
      <div className="form-control col-span-2 min-w-0 sm:col-span-4">
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
            sourceSelection={
              campaignId && setAllSources ? { allSources, onChange: setAllSources } : undefined
            }
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
            className="input input-bordered input-sm w-full min-w-0"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Latin"
          />
        )}
      </div>
      <label className="form-control min-w-0">
        <span className="label-text text-xs">Spoken</span>
        <select
          className="select select-bordered select-sm w-full min-w-0"
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
      <label className="form-control min-w-0">
        <span className="label-text text-xs">Written</span>
        <select
          className="select select-bordered select-sm w-full min-w-0"
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
      <label className="form-control min-w-0">
        <span className="label-text text-xs">Points</span>
        <input
          className="input input-bordered input-sm num w-full min-w-0"
          value={points}
          onChange={(e) => {
            setPointsOverride(e.target.value);
            setPointsError(null);
          }}
        />
      </label>
      <div className="col-span-2 flex justify-end sm:col-span-4">
        <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add language'}
        </button>
      </div>
      {pointsError && <p className="col-span-2 text-error text-xs sm:col-span-4">{pointsError}</p>}
    </form>
  );
}

interface LanguageRowProps {
  characterId: string;
  language: LanguageOut;
  canWrite: boolean;
}

function LanguageRow({ characterId, language, canWrite }: LanguageRowProps) {
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

  const deletion = useConfirmedEntityDelete({
    entityClass: 'character_language',
    noun: 'language',
    label: language.name,
    entity: language,
    characterId,
  });

  const [expanded, setExpanded] = useState(false);
  const editorId = useId();
  const summaryFlash = useFlashGroup([
    nameField.inputProps,
    spokenField.selectProps,
    writtenField.selectProps,
    pointsField.inputProps,
  ]);
  return (
    <TableBody
      filterValues={{
        name: language.name,
        spoken: FLUENCY_LABELS[language.spokenFluency],
        written: FLUENCY_LABELS[language.writtenFluency],
        points: language.points,
      }}
      aria-label={language.name}
    >
      <tr className="field-rollback-flash" {...summaryFlash}>
        <td className="min-w-0 whitespace-normal break-words py-3 font-medium">
          {language.name}
          <span className="mt-1 block text-xs font-normal text-base-content/70 sm:hidden">
            Spoken: {FLUENCY_LABELS[language.spokenFluency]} · Written:{' '}
            {FLUENCY_LABELS[language.writtenFluency]}
          </span>
        </td>
        <td className="hidden text-xs sm:table-cell">{FLUENCY_LABELS[language.spokenFluency]}</td>
        <td className="hidden text-xs sm:table-cell">{FLUENCY_LABELS[language.writtenFluency]}</td>
        <td className="num px-1 text-right">{language.points}</td>
        <td className="px-1 text-right">
          {canWrite && (
            <button
              type="button"
              className="btn btn-ghost btn-xs min-h-11 px-1 sm:px-2"
              aria-label={`${expanded ? 'Close' : 'Edit'} ${language.name}`}
              aria-expanded={expanded}
              aria-controls={editorId}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Done' : 'Edit'}
            </button>
          )}
        </td>
      </tr>
      {canWrite && (
        <tr hidden={!expanded} id={editorId}>
          <td colSpan={5} className="bg-base-200 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 font-medium [overflow-wrap:anywhere]">Edit {language.name}</p>
              {(nameField.isSaving ||
                spokenField.isSaving ||
                writtenField.isSaving ||
                pointsField.isSaving) && <output className="text-xs text-warning">Saving…</output>}
            </div>
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
              <div className="col-span-2 min-w-0">
                <span className="label-eyebrow mb-1 block">Name</span>
                <input
                  aria-label={`${language.name} name`}
                  className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm w-full min-w-0 font-medium`}
                  {...nameField.inputProps}
                />
              </div>
              <div className="min-w-0">
                <span className="label-eyebrow mb-1 block">Spoken</span>
                <select
                  aria-label={`${language.name} spoken fluency`}
                  className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm w-full min-w-0`}
                  {...spokenField.selectProps}
                >
                  {FLUENCY_LEVELS.map((f) => (
                    <option key={f} value={f}>
                      {FLUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <span className="label-eyebrow mb-1 block">Written</span>
                <select
                  aria-label={`${language.name} written fluency`}
                  className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm w-full min-w-0`}
                  {...writtenField.selectProps}
                >
                  {FLUENCY_LEVELS.map((f) => (
                    <option key={f} value={f}>
                      {FLUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <span className="label-eyebrow mb-1 block">Points</span>
                <input
                  aria-label={`${language.name} points`}
                  className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num w-full min-w-0 text-right`}
                  {...pointsField.inputProps}
                />
              </div>
              <div className="col-span-2 sm:col-span-4">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  onClick={deletion.request}
                  aria-label={`Delete language ${language.name}`}
                >
                  Delete language
                </button>
              </div>
            </div>
            {deletion.dialog}
          </td>
        </tr>
      )}
    </TableBody>
  );
}

export function LanguagesPanel({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  return <LanguagesTable key={character.id} character={character} canWrite={canWrite} />;
}

function LanguagesTable({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  const [showAdd, setShowAdd] = useState(false);
  const addId = useId();
  const submission = useAddEntityForm({
    entityClass: 'character_language',
    characterId: character.id,
    label: 'language',
  });

  const total = character.languages.reduce((sum, entry) => sum + entry.points, 0);
  return (
    <section className="min-w-0">
      <header
        className="field-rollback-flash flex flex-wrap items-center justify-between gap-2 pb-3 pt-2"
        {...submission.flashProps}
      >
        <p className="text-xs text-base-content/60">
          {character.languages.length} {character.languages.length === 1 ? 'language' : 'languages'}{' '}
          · <span className="num">{total}</span> pts
        </p>
        {canWrite && (
          <button
            type="button"
            className={`btn btn-sm ${showAdd ? 'btn-ghost' : 'btn-primary'}`}
            aria-expanded={showAdd}
            aria-controls={addId}
            onClick={() => setShowAdd((current) => !current)}
          >
            {showAdd ? 'Close add form' : '+ Add language'}
          </button>
        )}
      </header>
      <div id={addId} hidden={!showAdd || !canWrite} className="pb-3">
        <AddLanguageForm
          submission={submission}
          characterId={character.id}
          campaignId={character.campaignId ?? null}
          canWrite={canWrite}
        />
      </div>
      {character.languages.length === 0 ? (
        <p className="pb-4 text-sm text-base-content/60">No languages yet.</p>
      ) : (
        <div className="border-t border-base-300">
          <Table
            preferenceKey={`${character.id}:languages`}
            className="table table-sm w-full table-fixed"
            aria-label="Languages"
          >
            <thead>
              <tr>
                <TableHeader column="name" label="Language" />
                <TableHeader column="spoken" label="Spoken" className="hidden w-24 sm:table-cell" />
                <TableHeader
                  column="written"
                  label="Written"
                  className="hidden w-24 sm:table-cell"
                />
                <TableHeader
                  column="points"
                  label="Points"
                  className="w-14 px-1 text-right sm:w-16"
                />

                <th scope="col" className="w-12 px-1 sm:w-16">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {character.languages.map((entry) => (
              <LanguageRow
                key={entry.id}
                characterId={character.id}
                language={entry}
                canWrite={canWrite}
              />
            ))}
          </Table>
        </div>
      )}
    </section>
  );
}
