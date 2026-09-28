import { useId, useState } from 'react';
import { skillReferenceDisplayName } from '../../../../shared/domain/defenseCalc.ts';
import { techniqueBonus } from '../../../../shared/domain/techniqueCalc.ts';
import { formatSigned } from '../../../../shared/format/number.ts';
import type { LibraryTechniqueOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import {
  TECHNIQUE_DIFFICULTIES,
  TECHNIQUE_DIFFICULTY_LABELS,
  type TechniqueDifficulty,
  type TechniqueOut,
} from '../../../../shared/schemas/technique.ts';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { SkillReferenceCombobox } from '../../../components/ui/SkillReferenceCombobox.tsx';
import { Table, TableBody, TableHeader } from '../../../components/ui/Table.tsx';
import { DRAFT_FIELD_CLASS } from '../../../hooks/useDraftField.ts';
import { useFlashGroup } from '../../../hooks/useFlashGroup.ts';
import { RollSheet } from './RollSheet.tsx';
import type { RollRequest } from './rollTypes.ts';
import { type UseAddEntityFormReturn, useAddEntityForm } from './useAddEntityForm.ts';
import { useConfirmedEntityDelete } from './useConfirmedEntityDelete.tsx';
import {
  useEntityDefaultModifierField,
  useEntityEnumField,
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
  useEntityTextField,
} from './useEntityRowPatch.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

interface AddTechniqueFormProps {
  characterId: string;
  campaignId: string | null;
  characterSkills: CharacterDetail['skills'];
  canWrite: boolean;
  submission: UseAddEntityFormReturn;
}

interface TechniqueSnapshot {
  name: string;
  nameRaw: string;
  defaultSkillName: string;
  defaultSkillNameRaw: string;
  difficulty: TechniqueDifficulty;
  points: number;
  pointsRaw: string;
  defaultModifier: number;
  defaultModifierRaw: string;
  maxLevel: number | null;
  libraryTechniqueId: string | null;
}

function AddTechniqueForm({
  characterId,
  campaignId,
  characterSkills,
  canWrite,
  submission,
}: AddTechniqueFormProps) {
  const [name, setName] = useState('');
  const [defaultSkillName, setDefaultSkillName] = useState('');
  const [difficulty, setDifficulty] = useState<TechniqueDifficulty>('A');
  const [points, setPoints] = useState('1');
  // '' means "defaults at full skill" (0). Blank is the display form of 0.
  const [defaultModifier, setDefaultModifier] = useState('');
  const [pickedLibraryId, setPickedLibraryId] = useState<string | null>(null);
  const [pickedMaxLevel, setPickedMaxLevel] = useState<number | null>(null);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);

  const { fetchOptions, allSources, setAllSources } = useLibraryFetcher<LibraryTechniqueOut>(
    'techniques',
    campaignId,
  );
  const { creating, flashProps, submit: submitEntity } = submission;

  async function submit(snap: TechniqueSnapshot) {
    await submitEntity(
      {
        name: snap.name,
        defaultSkillName: snap.defaultSkillName,
        difficulty: snap.difficulty,
        points: snap.points,
        defaultModifier: snap.defaultModifier,
        ...(snap.maxLevel != null ? { maxLevel: snap.maxLevel } : {}),
        characterId,
        ...(snap.libraryTechniqueId ? { libraryTechniqueId: snap.libraryTechniqueId } : {}),
      },
      () => {
        // AGENTS.md rule 1: only clear a field whose *current* value still
        // matches what we submitted (functional setter = live state).
        setName((cur) => (cur === snap.nameRaw ? '' : cur));
        setDefaultSkillName((cur) => (cur === snap.defaultSkillNameRaw ? '' : cur));
        setPoints((cur) => (cur === snap.pointsRaw ? '1' : cur));
        setDefaultModifier((cur) => (cur === snap.defaultModifierRaw ? '' : cur));
        // The library-derived cap follows the pick guard: a pick made
        // during the in-flight create must survive.
        setPickedLibraryId((cur) => (cur === snap.libraryTechniqueId ? null : cur));
        setPickedMaxLevel((cur) => (cur === snap.maxLevel ? null : cur));
        setPointsError(null);
        setDefaultError(null);
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
        if (!name.trim() || !defaultSkillName.trim()) return;
        // Never silently substitute 1 for an invalid points draft; block
        // the submit and keep the typed value for correction instead.
        if (points.trim() === '') {
          setPointsError('Points must be an integer between 0 and 100');
          return;
        }
        const parsed = Number(points);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
          setPointsError('Points must be an integer between 0 and 100');
          return;
        }
        // Blank default modifier = defaults at full skill (0).
        let parsedDefault = 0;
        if (defaultModifier.trim() !== '') {
          parsedDefault = Number(defaultModifier);
          if (!Number.isInteger(parsedDefault) || parsedDefault < -99 || parsedDefault > 0) {
            setDefaultError('Default must be 0 or a negative integer (e.g. -6)');
            return;
          }
        }
        setPointsError(null);
        setDefaultError(null);
        void submit({
          name: name.trim(),
          nameRaw: name,
          defaultSkillName: defaultSkillName.trim(),
          defaultSkillNameRaw: defaultSkillName,
          difficulty,
          points: parsed,
          pointsRaw: points,
          defaultModifier: parsedDefault,
          defaultModifierRaw: defaultModifier,
          maxLevel: pickedMaxLevel,
          libraryTechniqueId: pickedLibraryId,
        });
      }}
    >
      <div className="form-control col-span-2 min-w-0 sm:col-span-4">
        <span className="label-text text-xs" id="add-technique-name-label">
          Technique
        </span>
        {campaignId ? (
          <LibraryAutocomplete<LibraryTechniqueOut>
            value={name}
            onChange={(v) => {
              setName(v);
              setPickedLibraryId(null);
              setPickedMaxLevel(null);
              setDefaultModifier('');
            }}
            onPick={(opt) => {
              setName(opt.name);
              setDefaultSkillName(opt.defaultSkillName);
              setDifficulty(opt.difficulty);
              setPickedLibraryId(opt.id);
              // Carry the library technique's default line + level cap
              // onto the row so the roll target starts at the correct
              // penalty and investing points can't exceed its maximum.
              setPickedMaxLevel(opt.maxLevel ?? null);
              setDefaultModifier(opt.defaultModifier === 0 ? '' : String(opt.defaultModifier));
            }}
            fetchOptions={fetchOptions}
            sourceSelection={
              campaignId && setAllSources ? { allSources, onChange: setAllSources } : undefined
            }
            getOptionKey={(o) => o.id}
            renderOption={(o) => (
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">{o.name}</span>
                <span className="num text-xs text-base-content/70">
                  {skillReferenceDisplayName(o.defaultSkillName)}/{o.difficulty}
                </span>
              </span>
            )}
            placeholder="e.g. Feint"
            inputProps={{ 'aria-labelledby': 'add-technique-name-label' }}
          />
        ) : (
          <input
            aria-labelledby="add-technique-name-label"
            className="input input-bordered input-sm w-full min-w-0"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Feint"
          />
        )}
      </div>
      <div className="form-control col-span-2 min-w-0 sm:col-span-4">
        <span className="label-text text-xs">Defaults from</span>
        <SkillReferenceCombobox
          aria-label="Defaults from"
          value={defaultSkillName}
          onChange={setDefaultSkillName}
          campaignId={campaignId}
          characterSkills={characterSkills}
          placeholder="e.g. Broadsword"
        />
      </div>
      <label className="form-control min-w-0">
        <span className="label-text text-xs">Difficulty</span>
        <select
          className="select select-bordered select-sm w-full min-w-0"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as TechniqueDifficulty)}
        >
          {TECHNIQUE_DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {TECHNIQUE_DIFFICULTY_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label
        className="form-control min-w-0"
        title="The technique's default line below its governing skill (e.g. -6). 0 = full skill."
      >
        <span className="label-text text-xs">Default modifier</span>
        <input
          className="input input-bordered input-sm num w-full min-w-0"
          value={defaultModifier}
          onChange={(e) => {
            setDefaultModifier(e.target.value);
            setDefaultError(null);
          }}
          placeholder="0"
        />
      </label>
      <label className="form-control min-w-0">
        <span className="label-text text-xs">Points</span>
        <input
          className="input input-bordered input-sm num w-full min-w-0"
          value={points}
          onChange={(e) => {
            setPoints(e.target.value);
            setPointsError(null);
          }}
        />
      </label>
      <div className="col-span-2 flex justify-end sm:col-span-4">
        <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add technique'}
        </button>
      </div>
      {pointsError && <p className="col-span-2 text-error text-xs sm:col-span-4">{pointsError}</p>}
      {defaultError && (
        <p className="col-span-2 text-error text-xs sm:col-span-4">{defaultError}</p>
      )}
    </form>
  );
}

interface TechniqueRowProps {
  characterId: string;
  campaignId: string | null;
  characterSkills: CharacterDetail['skills'];
  technique: TechniqueOut;
  canWrite: boolean;
  onRoll: (req: RollRequest) => void;
}

function TechniqueRow({
  characterId,
  campaignId,
  characterSkills,
  technique,
  canWrite,
  onRoll,
}: TechniqueRowProps) {
  const rowPatch = useEntityRowPatch(
    'character_technique',
    technique.id,
    characterId,
    technique.name,
  );

  const nameField = useEntityNameField(rowPatch, technique.name);
  const defaultSkillField = useEntityTextField(
    rowPatch,
    `${technique.name} default skill`,
    'defaultSkillName',
    technique.defaultSkillName,
    (v) => (v.length > 0 ? null : 'default skill cannot be empty'),
  );
  const difficultyField = useEntityEnumField<TechniqueDifficulty>(
    rowPatch,
    `${technique.name} difficulty`,
    'difficulty',
    technique.difficulty,
    TECHNIQUE_DIFFICULTIES,
  );
  const pointsField = useEntityPointsField(rowPatch, technique.name, technique.points, (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error('non-negative integer only');
    }
    return n;
  });
  const defaultModifierField = useEntityDefaultModifierField(
    rowPatch,
    technique.name,
    technique.defaultModifier ?? 0,
  );

  const deletion = useConfirmedEntityDelete({
    entityClass: 'character_technique',
    noun: 'technique',
    label: technique.name,
    entity: technique,
    characterId,
  });

  const bonus = techniqueBonus(technique.points, technique.difficulty, technique.maxLevel);
  const defaultSkillDisplayName = skillReferenceDisplayName(technique.defaultSkillName);
  const levelTitle =
    technique.level === null
      ? `Skill "${defaultSkillDisplayName}" not on sheet`
      : `${defaultSkillDisplayName} ${technique.defaultSkillLevel}${
          technique.defaultModifier !== 0
            ? ` ${formatSigned(technique.defaultModifier, { zero: 'plain' })}`
            : ''
        } +${bonus}${technique.maxLevel !== null ? ` (capped at +${technique.maxLevel})` : ''}`;

  const [expanded, setExpanded] = useState(false);
  const editorId = useId();
  const summaryFlash = useFlashGroup([
    nameField.inputProps,
    defaultSkillField.inputProps,
    difficultyField.selectProps,
    defaultModifierField.inputProps,
    pointsField.inputProps,
  ]);
  return (
    <TableBody
      filterValues={{
        name: technique.name,
        basis: defaultSkillDisplayName,
        difficulty: TECHNIQUE_DIFFICULTY_LABELS[technique.difficulty],
        modifier: technique.defaultModifier,
        points: technique.points,
        level: technique.level,
      }}
      aria-label={technique.name}
    >
      <tr className="field-rollback-flash" {...summaryFlash}>
        <td className="min-w-0 whitespace-normal break-words py-3 font-medium">
          {technique.name}
          <span className="mt-1 block text-xs font-normal text-base-content/70 lg:hidden">
            Defaults from {defaultSkillDisplayName}{' '}
            {formatSigned(technique.defaultModifier, { zero: 'plain' })} ·{' '}
            {TECHNIQUE_DIFFICULTY_LABELS[technique.difficulty]}
          </span>
        </td>
        <td className="hidden whitespace-normal break-words text-xs lg:table-cell">
          {defaultSkillDisplayName}
        </td>
        <td className="hidden text-xs lg:table-cell">
          {TECHNIQUE_DIFFICULTY_LABELS[technique.difficulty]}
        </td>
        <td className="num hidden text-right lg:table-cell">
          {formatSigned(technique.defaultModifier, { zero: 'plain' })}
        </td>
        <td className="num px-1 text-right">{technique.points}</td>
        <td className="px-1 text-right">
          <RollLevelChip
            level={technique.level}
            name={technique.name}
            title={levelTitle}
            onRoll={(level) => onRoll({ label: technique.name, baseTarget: level })}
          />
        </td>
        <td className="px-1 text-right">
          {canWrite && (
            <button
              type="button"
              className="btn btn-ghost btn-xs min-h-11 px-1 sm:px-2"
              aria-label={`${expanded ? 'Close' : 'Edit'} ${technique.name}`}
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
          <td colSpan={7} className="bg-base-200 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Edit {technique.name}</p>
              {(nameField.isSaving ||
                defaultSkillField.isSaving ||
                difficultyField.isSaving ||
                defaultModifierField.isSaving ||
                pointsField.isSaving) && <output className="text-xs text-warning">Saving…</output>}
            </div>
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
              <div className="col-span-2 min-w-0">
                <span className="label-eyebrow mb-1 block">Name</span>
                <input
                  aria-label={`${technique.name} name`}
                  className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm w-full min-w-0 font-medium`}
                  {...nameField.inputProps}
                />
              </div>
              <div className="col-span-2 min-w-0">
                <span className="label-eyebrow mb-1 block">Defaults from</span>
                <SkillReferenceCombobox
                  aria-label={`${technique.name} default skill`}
                  value={defaultSkillField.value}
                  onChange={defaultSkillField.setValue}
                  onPick={(option) => {
                    defaultSkillField.setValue(option.label);
                    defaultSkillField.commit();
                  }}
                  campaignId={campaignId}
                  characterSkills={characterSkills}
                  inputClassName={`${DRAFT_FIELD_CLASS} input-bordered`}
                  inputProps={defaultSkillField.inputProps}
                />
              </div>
              <div className="min-w-0">
                <span className="label-eyebrow mb-1 block">Difficulty</span>
                <select
                  aria-label={`${technique.name} difficulty`}
                  className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm w-full min-w-0`}
                  {...difficultyField.selectProps}
                >
                  {TECHNIQUE_DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {TECHNIQUE_DIFFICULTY_LABELS[d]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <span className="label-eyebrow mb-1 block">Default modifier</span>
                <input
                  aria-label={`${technique.name} default modifier`}
                  className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num w-full min-w-0 text-center`}
                  {...defaultModifierField.inputProps}
                  title="Default line below the governing skill (0 or negative)"
                />
              </div>
              <div className="min-w-0">
                <span className="label-eyebrow mb-1 block">Points</span>
                <input
                  aria-label={`${technique.name} points`}
                  className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num w-full min-w-0 text-right`}
                  {...pointsField.inputProps}
                />
              </div>
              <div className="col-span-2 sm:col-span-4">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  onClick={deletion.request}
                  aria-label={`Delete technique ${technique.name}`}
                >
                  Delete technique
                </button>
              </div>
            </div>
            <p className="mt-3 break-words text-xs text-base-content/70">{levelTitle}</p>
            {deletion.dialog}
          </td>
        </tr>
      )}
    </TableBody>
  );
}

export function TechniquesPanel({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  return <TechniquesTable key={character.id} character={character} canWrite={canWrite} />;
}

function TechniquesTable({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  const [showAdd, setShowAdd] = useState(false);
  const addId = useId();
  const submission = useAddEntityForm({
    entityClass: 'character_technique',
    characterId: character.id,
    label: 'technique',
  });
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const total = character.techniques.reduce((sum, entry) => sum + entry.points, 0);
  return (
    <section className="min-w-0">
      <header
        className="field-rollback-flash flex flex-wrap items-center justify-between gap-2 pb-3 pt-2"
        {...submission.flashProps}
      >
        <p className="text-xs text-base-content/60">
          {character.techniques.length}{' '}
          {character.techniques.length === 1 ? 'technique' : 'techniques'} ·{' '}
          <span className="num">{total}</span> pts
        </p>
        {canWrite && (
          <button
            type="button"
            className={`btn btn-sm ${showAdd ? 'btn-ghost' : 'btn-primary'}`}
            aria-expanded={showAdd}
            aria-controls={addId}
            onClick={() => setShowAdd((current) => !current)}
          >
            {showAdd ? 'Close add form' : '+ Add technique'}
          </button>
        )}
      </header>
      <div id={addId} hidden={!showAdd || !canWrite} className="pb-3">
        <AddTechniqueForm
          submission={submission}
          characterId={character.id}
          campaignId={character.campaignId ?? null}
          canWrite={canWrite}
          characterSkills={character.skills}
        />
      </div>
      {character.techniques.length === 0 ? (
        <p className="pb-4 text-sm text-base-content/60">No techniques yet.</p>
      ) : (
        <div className="border-t border-base-300">
          <Table
            preferenceKey={`${character.id}:techniques`}
            className="table table-sm w-full table-fixed"
            aria-label="Techniques"
          >
            <thead>
              <tr>
                <TableHeader column="name" label="Technique" />
                <TableHeader
                  column="basis"
                  label="Defaults from"
                  className="hidden w-40 lg:table-cell"
                />
                <TableHeader
                  column="difficulty"
                  label="Difficulty"
                  className="hidden w-24 lg:table-cell"
                />
                <TableHeader
                  column="modifier"
                  label="Default"
                  className="hidden w-20 text-right lg:table-cell"
                />
                <TableHeader
                  column="points"
                  label="Points"
                  className="w-14 px-1 text-right sm:w-16"
                />
                <TableHeader
                  column="level"
                  label="Level"
                  className="w-12 px-1 text-right sm:w-16"
                />
                <th scope="col" className="w-12 px-1 sm:w-16">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {character.techniques.map((entry) => (
              <TechniqueRow
                key={entry.id}
                characterId={character.id}
                technique={entry}
                canWrite={canWrite}
                campaignId={character.campaignId ?? null}
                characterSkills={character.skills}
                onRoll={setRollRequest}
              />
            ))}
          </Table>
        </div>
      )}
      {rollRequest && (
        <RollSheet
          request={rollRequest}
          characterId={character.id}
          onClose={() => setRollRequest(null)}
        />
      )}
    </section>
  );
}
