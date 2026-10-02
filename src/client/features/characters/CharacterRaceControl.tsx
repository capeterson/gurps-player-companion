import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import {
  canAdoptLibraryEntry,
  canPlayerSelectLibraryEntry,
} from '../../../shared/domain/libraryIdentity.ts';
import {
  raceName,
  resolveRaceSelection,
  switchOwnedRaceForm,
} from '../../../shared/domain/race.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import {
  type CharacterRace,
  HUMAN_RACE,
  type RaceSelection,
  characterRace,
} from '../../../shared/schemas/race.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useDialogState } from '../../hooks/useDialogState.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../hooks/useDraftField.ts';
import { readActiveUser } from '../../sync/activeUser.ts';
import { RaceSummary } from '../library/RaceSummary.tsx';
import { useLocalLibrary } from '../library/useLocalLibrary.ts';
import { useCharacterFieldSave } from './sections/useCharacterPatch.ts';

export function CharacterRaceControl({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  const current = character.race ?? HUMAN_RACE;
  const library = useLocalLibrary(character.campaignId ?? null);
  const entries = library?.races ?? [];
  const isLibraryOwner = useLiveQuery(
    async () =>
      character.campaignId
        ? (await getLocalDb().campaigns.get(character.campaignId))?.ownerId === readActiveUser()
        : false,
    [character.campaignId],
  );
  const canSelect = isLibraryOwner ? canAdoptLibraryEntry : canPlayerSelectLibraryEntry;
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<RaceSelection | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const ref = useDialogState(open);
  const buildSave = useCharacterFieldSave(character.id);
  const field = useDraftField<CharacterRace>({
    name: 'race',
    serverValue: current,
    format: JSON.stringify,
    parse: (raw) => characterRace.parse(JSON.parse(raw)),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    ...buildSave('race', { humanName: 'race' }),
    readRollbackValue: async () =>
      (await getLocalDb().characters.get(character.id))?.race ?? HUMAN_RACE,
  });
  const owned = characterRace.parse(JSON.parse(field.value));
  const selected = selection ?? owned.selection;
  const base = entries.find((e) => e.id === selected.raceId);
  let preview: CharacterRace | null = null;
  let previewError: string | null = null;
  const samePurchase =
    selected.raceId === owned.selection.raceId &&
    selected.variantKey === owned.selection.variantKey &&
    JSON.stringify(selected.lensIds) === JSON.stringify(owned.selection.lensIds);
  const availableForms = samePurchase ? (owned.snapshot?.forms ?? []) : (base?.forms ?? []);
  try {
    preview = samePurchase
      ? switchOwnedRaceForm(owned, selected.formKey)
      : resolveRaceSelection(selected, entries);
  } catch (error) {
    previewError = error instanceof Error ? error.message : 'Could not resolve this race';
  }
  const overlappingTraits = [
    ...new Set(
      (preview?.snapshot?.traits ?? [])
        .filter((racial) =>
          (character.traits ?? []).some(
            (personal) => personal.name.trim().toLowerCase() === racial.name.trim().toLowerCase(),
          ),
        )
        .map((trait) => trait.name),
    ),
  ];
  const conflict = baseline !== null && baseline !== JSON.stringify(current);
  const choose = (patch: Partial<RaceSelection>) => setSelection({ ...selected, ...patch });
  return (
    <div className="form-control min-w-0">
      <span className="label-text-alt label-eyebrow">Race</span>
      <button
        type="button"
        className={`btn btn-sm h-auto min-h-8 justify-start whitespace-normal text-left ${DRAFT_FIELD_CLASS}`}
        data-flashing={field.inputProps['data-flashing']}
        data-flash-parity={field.inputProps['data-flash-parity']}
        aria-label={`${canWrite ? 'Change' : 'View'} race: ${raceName(owned)}`}
        onClick={() => {
          setBaseline(JSON.stringify(current));
          setOpen(true);
        }}
      >
        {raceName(owned)}
      </button>
      <dialog
        ref={ref}
        className="modal"
        aria-label={canWrite ? 'Choose race' : 'Race details'}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="modal-box w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-4">
          <h3 className="text-lg font-semibold">{canWrite ? 'Choose race' : 'Race details'}</h3>
          {canWrite && (
            <>
              <label className="form-control min-w-0">
                Race
                <select
                  className="select w-full"
                  value={selected.raceId ?? ''}
                  onChange={(e) =>
                    setSelection({
                      raceId: e.target.value || null,
                      variantKey: null,
                      lensIds: [],
                      formKey: null,
                    })
                  }
                >
                  <option value="">Human</option>
                  {selected.raceId && (!base || !canSelect(base)) && (
                    <option value={selected.raceId}>{raceName(owned)} (owned copy)</option>
                  )}
                  {entries
                    .filter((e) => e.kind === 'race' && canSelect(e))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {e.points} points
                      </option>
                    ))}
                </select>
              </label>
              {!character.campaignId && (
                <p className="text-sm text-base-content/70">
                  Choose a campaign to select from its race library.
                </p>
              )}
              {(base?.variants.length ?? 0) > 0 && (
                <label className="form-control">
                  Variant
                  <select
                    className="select w-full"
                    value={selected.variantKey ?? ''}
                    onChange={(e) => choose({ variantKey: e.target.value || null })}
                  >
                    <option value="">Base race</option>
                    {base?.variants.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.name} · {v.points} points
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {availableForms.length > 0 && (
                <label className="form-control">
                  Current form
                  <select
                    className="select w-full"
                    value={selected.formKey ?? ''}
                    onChange={(e) => choose({ formKey: e.target.value || null })}
                  >
                    <option value="">Natural form</option>
                    {availableForms.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {entries.some((e) => e.kind === 'lens' && canSelect(e)) && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Lenses</legend>
                  {entries
                    .filter((e) => e.kind === 'lens' && canSelect(e))
                    .map((lens) => (
                      <label
                        key={lens.id}
                        className="flex items-start gap-2 [overflow-wrap:anywhere]"
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm shrink-0"
                          checked={selected.lensIds.includes(lens.id)}
                          onChange={(e) =>
                            choose({
                              lensIds: e.target.checked
                                ? [...selected.lensIds, lens.id]
                                : selected.lensIds.filter((id) => id !== lens.id),
                            })
                          }
                        />
                        <span>
                          {lens.name} · {lens.points} points
                        </span>
                      </label>
                    ))}
                </fieldset>
              )}
            </>
          )}
          {previewError && (
            <p role="alert" className="text-error">
              {previewError}
            </p>
          )}
          {preview && (
            <RaceSummary
              race={preview}
              levels={
                JSON.stringify(preview) === JSON.stringify(owned)
                  ? character.racialSkills
                  : undefined
              }
            />
          )}
          {canWrite && preview && JSON.stringify(preview) !== JSON.stringify(owned) && (
            <p>
              Race points: {owned.snapshot?.points ?? 0} → {preview.snapshot?.points ?? 0}. Personal
              attribute, trait, and skill purchases are retained.
            </p>
          )}
          {canWrite && overlappingTraits.length > 0 && (
            <p className="text-sm text-warning">
              Also bought personally: {overlappingTraits.join(', ')}. Both purchases remain and
              their effects can add together. Review your personal traits before applying.
            </p>
          )}
          {conflict && (
            <div role="alert" className="space-y-2 text-warning">
              <p>
                The character’s race changed while this editor was open. Review the current race
                before applying your selection.
              </p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setSelection(current.selection);
                  setBaseline(JSON.stringify(current));
                }}
              >
                Use current race
              </button>
            </div>
          )}
          {field.error && (
            <p role="alert" className="text-error">
              {field.error}
            </p>
          )}
          <div className="modal-action flex-wrap">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {canWrite ? 'Cancel' : 'Close'}
            </button>
            {canWrite && (
              <button
                type="button"
                className="btn"
                disabled={!preview || conflict}
                onClick={() => {
                  if (preview) {
                    field.setValue(JSON.stringify(preview));
                    field.commit();
                    setSelection(null);
                    setOpen(false);
                  }
                }}
              >
                Apply race
              </button>
            )}
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit">Close race editor</button>
        </form>
      </dialog>
    </div>
  );
}
