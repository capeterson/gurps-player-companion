import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { SPELL_DIFFICULTIES, type SpellDifficulty } from '../../../../shared/constants/skills.ts';
import { characterCanCast, hasMagery } from '../../../../shared/domain/spellCalc.ts';
import type { LibrarySpellOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { type SpellOut, spellCreate } from '../../../../shared/schemas/spell.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import { AppIcon } from '../../../components/ui/AppIcon.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { Table, TableBody } from '../../../components/ui/Table.tsx';
import { useDialogState } from '../../../hooks/useDialogState.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useFlashGroup } from '../../../hooks/useFlashGroup.ts';
import { CastSpellDialog } from './CastSpellDialog.tsx';
import { RollSheet } from './RollSheet.tsx';
import { ModifierBreakdownContent, skillEffectsForRow } from './combat/weaponEffectView.tsx';
import type { RollRequest } from './rollTypes.ts';
import {
  type SpellSort,
  readSpellTablePreferences,
  saveSpellTablePreferences,
} from './spellTablePreferences.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import { useConfirmedEntityDelete } from './useConfirmedEntityDelete.tsx';
import {
  useEntityEnumField,
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
} from './useEntityRowPatch.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';
import {
  SortableHeader,
  compareOptionalLevel,
  compareTableText,
  useSortableCharacterRows,
} from './useSortableCharacterRows.tsx';

interface AddSpellFormProps {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
  submission: ReturnType<typeof useAddEntityForm>;
}

interface SpellSnapshot {
  name: string;
  nameRaw: string;
  college: string;
  collegeRaw: string;
  difficulty: SpellDifficulty;
  points: number;
  pointsRaw: string;
  baseEnergyCost: number;
  baseEnergyCostRaw: string;
  /** Library row the name was picked from, if any. */
  library: LibrarySpellOut | null;
}

function AddSpellForm({ characterId, campaignId, canWrite, submission }: AddSpellFormProps) {
  const [name, setName] = useState('');
  const [college, setCollege] = useState('');
  const [difficulty, setDifficulty] = useState<SpellDifficulty>('H');
  const [points, setPoints] = useState('1');
  const [baseEnergyCost, setBaseEnergyCost] = useState('1');
  // Full library row when the name was picked from the autocomplete;
  // carries book fields (maintenance, casting time, ...) into the create.
  const [picked, setPicked] = useState<LibrarySpellOut | null>(null);

  const { fetchOptions, allSources, setAllSources } = useLibraryFetcher<LibrarySpellOut>(
    'spells',
    campaignId,
  );
  const { creating, submit: submitEntity, flashProps } = submission;

  async function submit(snap: SpellSnapshot) {
    if (snap.library && snap.library.campaignId !== campaignId) {
      submission.reject('Campaign changed — select the spell again from this campaign’s library.');
      return;
    }
    const parsed = spellCreate.safeParse({
      name: snap.name,
      college: snap.college === '' ? null : snap.college,
      difficulty: snap.difficulty,
      points: snap.points,
      baseEnergyCost: snap.baseEnergyCost,
      ...(snap.library
        ? {
            maintenanceCost: snap.library.maintenanceCost,
            castingTime: snap.library.castingTime,
            duration: snap.library.duration,
            prerequisites: snap.library.prerequisites,
            notes: snap.library.description,
            librarySpellId: snap.library.id,
          }
        : {}),
    });
    if (!parsed.success) {
      submission.reject(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    await submitEntity({ ...parsed.data, characterId }, () => {
      // Per AGENTS.md: only clear fields whose value still matches the
      // snapshot we sent.  We use functional setters so the comparison
      // runs against the *live* state at completion time, not the
      // closure-captured value from the render that submitted; that
      // way a field the user has typed into during the await isn't
      // wiped, which is exactly the quick-edit loss this guard exists
      // to prevent.
      setName((cur) => (cur === snap.nameRaw ? '' : cur));
      setCollege((cur) => (cur === snap.collegeRaw ? '' : cur));
      setDifficulty((cur) => (cur === snap.difficulty ? 'H' : cur));
      setPoints((cur) => (cur === snap.pointsRaw ? '1' : cur));
      setBaseEnergyCost((cur) => (cur === snap.baseEnergyCostRaw ? '1' : cur));
      setPicked((cur) => (cur?.id === snap.library?.id ? null : cur));
    });
  }

  if (!canWrite) return null;

  return (
    <form
      {...flashProps}
      className="field-rollback-flash grid grid-cols-2 gap-2 rounded border border-base-300 bg-base-100/40 p-3 sm:flex sm:flex-wrap sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const pParsed = Number(points);
        const eParsed = Number(baseEnergyCost);
        void submit({
          name: name.trim(),
          nameRaw: name,
          college: college.trim(),
          collegeRaw: college,
          difficulty,
          // Spells have no default in GURPS: at least 1 point to know one.
          points: pParsed,
          pointsRaw: points,
          baseEnergyCost: eParsed,
          baseEnergyCostRaw: baseEnergyCost,
          library: picked && picked.name === name.trim() ? picked : null,
        });
      }}
    >
      <div className="form-control col-span-2 min-w-0 sm:flex-1 sm:min-w-[10rem]">
        <span className="label-text text-xs" id="add-spell-name-label">
          Spell
        </span>
        {campaignId ? (
          <LibraryAutocomplete<LibrarySpellOut>
            value={name}
            onChange={(v) => {
              setName(v);
              setPicked(null);
            }}
            onPick={(opt) => {
              setName(opt.name);
              setCollege(opt.college ?? '');
              setDifficulty(opt.difficulty);
              setBaseEnergyCost(String(opt.baseEnergyCost));
              setPicked(opt);
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
                  {o.college ?? '—'} · IQ/{o.difficulty}
                </span>
              </span>
            )}
            placeholder="e.g. Light"
            inputProps={{ 'aria-labelledby': 'add-spell-name-label' }}
          />
        ) : (
          <input
            aria-labelledby="add-spell-name-label"
            className="input input-bordered input-sm w-full min-w-0"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Light"
          />
        )}
      </div>
      <label className="form-control col-span-2 min-w-0 sm:w-32">
        <span className="label-text text-xs">College</span>
        <input
          className="input input-bordered input-sm w-full min-w-0"
          value={college}
          onChange={(e) => setCollege(e.target.value)}
          placeholder="e.g. Light"
        />
      </label>
      <label className="form-control min-w-0">
        <span className="label-text text-xs">Diff</span>
        <select
          className="select select-bordered select-sm w-full min-w-0"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as SpellDifficulty)}
        >
          {SPELL_DIFFICULTIES.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="form-control min-w-0 sm:w-16">
        <span className="label-text text-xs">Pts</span>
        <input
          className="input input-bordered input-sm num w-full min-w-0"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </label>
      <label className="form-control min-w-0 sm:w-16">
        <span className="label-text text-xs">Cost</span>
        <input
          className="input input-bordered input-sm num w-full min-w-0"
          value={baseEnergyCost}
          onChange={(e) => setBaseEnergyCost(e.target.value)}
        />
      </label>
      <button
        type="submit"
        className="btn btn-sm btn-primary col-span-2 w-full sm:w-auto"
        disabled={creating}
      >
        {creating ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

interface SpellRowProps {
  characterId: string;
  spell: SpellOut;
  canWrite: boolean;
  castable: boolean;
  manaKnown: boolean;
  expanded: boolean;
  visible: boolean;
  highlighted: boolean;
  onToggle(): void;
  onReference(): void;
  onCast(spell: SpellOut, mode: 'cast' | 'maintain'): void;
  onRoll(req: RollRequest): void;
}

function spellFilterValues(spell: SpellOut) {
  return {
    name: spell.name,
    points: spell.points,
    level: spell.level,
    cost: spell.effectiveCost,
    upkeep: spell.effectiveMaintenanceCost,
    time: spell.castingTime,
  };
}

function SpellRow({
  characterId,
  spell,
  canWrite,
  castable,
  manaKnown,
  expanded,
  visible,
  highlighted,
  onToggle,
  onReference,
  onCast,
  onRoll,
}: SpellRowProps) {
  const rowCastable = castable && spell.level != null;
  const rowPatch = useEntityRowPatch('character_spell', spell.id, characterId, spell.name);
  const nameField = useEntityNameField(rowPatch, spell.name);
  const pointsField = useEntityPointsField(rowPatch, spell.name, spell.points, (raw) => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 1000)
      throw new Error('must be an integer from 1 to 1000');
    return value;
  });
  const difficultyField = useEntityEnumField(
    rowPatch,
    `${spell.name} difficulty`,
    'difficulty',
    spell.difficulty,
    SPELL_DIFFICULTIES,
  );
  const costField = useDraftField<number>({
    name: `${spell.name} base cost`,
    serverValue: spell.baseEnergyCost,
    parse: (raw) => {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 99)
        throw new Error('must be an integer from 0 to 99');
      return value;
    },
    onSave: (value) => rowPatch.patch('baseEnergyCost', value),
    flashKey: rowPatch.flashKey('baseEnergyCost'),
  });
  const notesField = useDraftField<string | null>({
    name: `${spell.name} notes`,
    serverValue: spell.notes,
    format: (value) => value ?? '',
    parse: (raw) => raw.trim() || null,
    validate: (value) =>
      (value?.length ?? 0) > 20000 ? 'notes must be at most 20000 characters' : null,
    onSave: (value) => rowPatch.patch('notes', value),
    flashKey: rowPatch.flashKey('notes'),
  });
  const summaryFlash = useFlashGroup([
    nameField.inputProps,
    pointsField.inputProps,
    costField.inputProps,
    difficultyField.selectProps,
    notesField.inputProps,
  ]);
  const deletion = useConfirmedEntityDelete({
    entityClass: 'character_spell',
    noun: 'spell',
    label: spell.name,
    entity: spell,
    characterId,
  });
  const editorId = useId();
  const actions = (
    <>
      <button
        type="button"
        className="btn btn-soft btn-sm min-h-11 px-2 text-primary"
        onClick={() => onCast(spell, 'cast')}
        disabled={!rowCastable}
        aria-label={`Cast ${spell.name}`}
      >
        Cast
      </button>
      {spell.maintenanceCost != null && (
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-11 px-2"
          onClick={() => onCast(spell, 'maintain')}
          disabled={!rowCastable}
          aria-label={`Maintain ${spell.name}`}
        >
          Maintain
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-square min-h-11 min-w-11"
        onClick={onToggle}
        aria-label={`${expanded ? 'Done editing' : 'Edit'} ${spell.name}`}
        aria-expanded={expanded}
        aria-controls={editorId}
      >
        <AppIcon name={expanded ? 'chevronDown' : 'edit'} size={16} />
      </button>
    </>
  );
  return (
    <TableBody
      {...(!highlighted ? { filterValues: spellFilterValues(spell) } : {})}
      aria-label={spell.name}
      hidden={!visible && !highlighted}
    >
      <tr
        id={`spell-${spell.id}`}
        aria-current={highlighted ? true : undefined}
        {...summaryFlash}
        className={`field-rollback-flash scroll-mt-24 target:!bg-primary/20 target:outline target:outline-2 target:outline-primary ${highlighted ? 'bg-primary/20 outline outline-2 outline-primary' : ''}`}
      >
        <td className="min-w-0 [overflow-wrap:anywhere]">
          <button
            type="button"
            className="min-h-11 text-left font-medium hover:text-primary hover:underline"
            onClick={onReference}
            aria-label={`Read ${spell.name}`}
          >
            {spell.name}
          </button>
          <span className="block text-xs text-base-content/70">
            {spell.college ?? 'No college'} · IQ/{spell.difficulty}
            <span className="lg:hidden">
              {' '}
              · {spell.points} {spell.points === 1 ? 'pt' : 'pts'}
            </span>
          </span>
          <span className="mt-1 block text-xs text-base-content/70 sm:hidden">
            Cost {spell.effectiveCost} · Upkeep {spell.effectiveMaintenanceCost ?? '—'} ·{' '}
            {spell.castingTime ?? 'Time not recorded'}
          </span>
          <span className="hidden text-xs text-base-content/70 sm:block xl:hidden">
            {spell.castingTime ?? 'Time not recorded'}
          </span>
          {spell.level == null && (
            <span className="block text-xs text-warning">No points invested — cannot cast</span>
          )}
        </td>
        <td className="num hidden text-right lg:table-cell">{spell.points}</td>
        <td className="num text-right">
          <RollLevelChip
            level={manaKnown ? spell.level : null}
            name={spell.name}
            title={
              !manaKnown
                ? 'Waiting for campaign mana'
                : spell.level == null
                  ? 'No points invested — spells have no default'
                  : undefined
            }
            onRoll={(level) => onRoll({ label: spell.name, baseTarget: level })}
          />
        </td>
        <td
          className="num hidden text-right sm:table-cell"
          aria-label={`${spell.name} effective cost`}
        >
          {spell.effectiveCost}
        </td>
        <td
          className="num hidden text-right sm:table-cell"
          aria-label={`${spell.name} effective upkeep`}
        >
          {spell.effectiveMaintenanceCost ?? '—'}
        </td>
        <td className="hidden text-xs [overflow-wrap:anywhere] xl:table-cell">
          {spell.castingTime ?? '—'}
        </td>
        <td className="hidden sm:table-cell">
          {canWrite && (
            <div className="flex flex-wrap items-center justify-end gap-1">{actions}</div>
          )}
        </td>
      </tr>
      {canWrite && (
        <tr className="sm:hidden">
          <td colSpan={7} className="pt-0">
            <div className="flex flex-wrap items-center gap-1">{actions}</div>
          </td>
        </tr>
      )}
      {canWrite && (
        <tr id={editorId} hidden={!expanded}>
          <td colSpan={7} className="bg-base-200 p-3 sm:p-4">
            <header className="mb-3 flex items-center justify-between gap-3">
              <h3 className="min-w-0 font-medium [overflow-wrap:anywhere]">Edit {spell.name}</h3>
              <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={onToggle}>
                Done
              </button>
            </header>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_7rem_6rem_6rem]">
              <label className="form-control col-span-2 min-w-0 lg:col-span-1">
                <span className="label-text text-xs">Spell name</span>
                <input
                  aria-label={`${spell.name} name`}
                  className={`${DRAFT_FIELD_CLASS} input input-sm w-full`}
                  {...nameField.inputProps}
                />
              </label>
              <label className="form-control min-w-0">
                <span className="label-text text-xs">Difficulty</span>
                <select
                  aria-label={`${spell.name} difficulty`}
                  className={`${DRAFT_FIELD_CLASS} select select-sm w-full`}
                  {...difficultyField.selectProps}
                >
                  {SPELL_DIFFICULTIES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="form-control min-w-0">
                <span className="label-text text-xs">Points</span>
                <input
                  aria-label={`${spell.name} points`}
                  className={`${DRAFT_FIELD_CLASS} input input-sm num w-full`}
                  {...pointsField.inputProps}
                />
              </label>
              <label className="form-control min-w-0">
                <span className="label-text text-xs">Base energy cost</span>
                <input
                  aria-label={`${spell.name} base cost`}
                  className={`${DRAFT_FIELD_CLASS} input input-sm num w-full`}
                  {...costField.inputProps}
                />
              </label>
            </div>
            <label className="form-control mt-3">
              <span className="label-text text-xs">Description &amp; notes (Markdown)</span>
              <textarea
                aria-label={`${spell.name} notes`}
                className={`${DRAFT_FIELD_CLASS} textarea textarea-sm min-h-24 w-full`}
                value={notesField.value}
                onChange={(event) => notesField.setValue(event.target.value)}
                onBlur={notesField.inputProps.onBlur}
                data-flashing={notesField.inputProps['data-flashing']}
                data-flash-parity={notesField.inputProps['data-flash-parity']}
              />
            </label>
            <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-3">
              <p className="text-xs text-base-content/60">
                Fields save individually. Done closes the editor.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm min-h-11 text-error"
                onClick={deletion.request}
                aria-label={`Delete spell ${spell.name}`}
              >
                Delete spell
              </button>
            </footer>
          </td>
        </tr>
      )}
      {canWrite && createPortal(deletion.dialog, document.body)}
    </TableBody>
  );
}

function SpellReferenceDialog({
  spell,
  effects,
  onClose,
}: { spell: SpellOut; effects: CharacterDetail['effects']; onClose(): void }) {
  const ref = useDialogState(true);
  const bonusEffects = skillEffectsForRow(effects, spell.name);
  const effectBonus = bonusEffects.reduce((sum, effect) => sum + effect.value, 0);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={`Spell reference: ${spell.name}`}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="modal-box w-[calc(var(--dialog-viewport-width,100dvw)-2rem)] max-w-xl max-h-[calc(var(--dialog-viewport-height,100dvh)-2rem)] overflow-y-auto border border-base-300 bg-base-100">
        <header className="sticky -top-6 z-10 -mx-6 -mt-6 flex justify-end bg-base-100 px-6 pt-3 pb-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square min-h-11 min-w-11"
            aria-label="Close spell reference"
            onClick={onClose}
          >
            <AppIcon name="close" size={18} />
          </button>
        </header>
        <div className="mb-5 min-w-0 [overflow-wrap:anywhere]">
          <h3 className="break-words font-display text-xl">{spell.name}</h3>
          <p className="mt-1 text-xs text-base-content/70">
            {spell.college ?? 'No college'} · IQ/{spell.difficulty} · {spell.points} points
          </p>
        </div>
        <dl className="my-5 grid grid-cols-2 gap-4 text-sm [overflow-wrap:anywhere]">
          <div>
            <dt className="text-xs text-base-content/60">Casting cost</dt>
            <dd>
              {spell.baseEnergyCost} base → {spell.effectiveCost} energy
            </dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/60">Upkeep</dt>
            <dd>
              {spell.maintenanceCost == null
                ? 'Not recorded'
                : `${spell.maintenanceCost} base → ${spell.effectiveMaintenanceCost} energy`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/60">Casting time</dt>
            <dd>{spell.castingTime ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/60">Duration</dt>
            <dd>{spell.duration ?? 'Not recorded'}</dd>
          </div>
        </dl>
        {spell.notes ? (
          <Markdown source={spell.notes} />
        ) : (
          <p className="text-sm text-base-content/60">No description recorded.</p>
        )}
        {spell.prerequisites && (
          <div className="mt-5">
            <h4 className="mb-2 text-sm font-medium">Prerequisites</h4>
            <Markdown source={spell.prerequisites} />
          </div>
        )}
        {spell.level != null && bonusEffects.length > 0 && (
          <div className="mt-5">
            <h4 className="mb-2 text-sm font-medium">Level modifiers</h4>
            <ModifierBreakdownContent
              baseLabel="Spell before skill effects"
              baseValue={spell.level - effectBonus}
              globalEffects={bonusEffects}
              finalValue={spell.level}
            />
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

function manaNotice(
  mana: CharacterDetail['manaLevel'],
  manaKnown: boolean,
  characterHasMagery: boolean,
) {
  if (!manaKnown) {
    return {
      tone: 'text-base-content/60',
      text: 'Campaign mana level not synced yet — casting is disabled until it loads.',
    };
  }
  if (mana === 'none') {
    return {
      tone: 'text-error',
      text: 'This campaign is a no-mana zone: spells cannot be cast at all here.',
    };
  }
  if (mana === 'low') {
    return {
      tone: characterHasMagery ? 'text-base-content/60' : 'text-warning',
      text: characterHasMagery
        ? 'Low mana: −5 to every spell is already included in the levels below.'
        : 'Low mana (−5 already included below) — and without Magery this character cannot cast here at all.',
    };
  }
  if (mana === 'high' || mana === 'very_high') {
    return {
      tone: 'text-base-content/60',
      text:
        mana === 'very_high'
          ? 'Very high mana: pay energy up front. Mages recover personal FP spent casting on their own turn at the start of their next turn; Maintenance FP, HP and powerstone energy are not refunded. Every failure is critical; a rolled critical failure causes a spectacular disaster.'
          : 'High mana: anyone can cast here — Magery is not required.',
    };
  }
  if (!characterHasMagery) {
    return {
      tone: 'text-warning',
      text:
        'No Magery trait detected. In normal mana only characters with Magery (even Magery 0) ' +
        'can cast spells, and spells have no default skill. Levels below assume Magery 0 — add ' +
        'the Magery advantage in Traits.',
    };
  }
  return null;
}

export function SpellsPanel({
  character,
  canWrite,
  anchorSpellId = null,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  anchorSpellId?: string | null;
}) {
  return (
    <SpellsTable
      key={character.id}
      character={character}
      canWrite={canWrite}
      anchorSpellId={anchorSpellId}
    />
  );
}

function SpellsTable({
  character,
  canWrite,
  anchorSpellId,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  anchorSpellId: string | null;
}) {
  const [casting, setCasting] = useState<{ spell: SpellOut; mode: 'cast' | 'maintain' } | null>(
    null,
  );
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [revealedAnchor, setRevealedAnchor] = useState<string | null>(null);
  const revealingAnchor = !!anchorSpellId && anchorSpellId !== revealedAnchor;
  useEffect(() => {
    if (!anchorSpellId) {
      setRevealedAnchor(null);
      return;
    }
    if (revealingAnchor) {
      setQuery('');
      setRevealedAnchor(anchorSpellId);
    }
  }, [anchorSpellId, revealingAnchor]);
  const addId = useId();
  const submission = useAddEntityForm({
    entityClass: 'character_spell',
    characterId: character.id,
    label: 'spell',
  });
  const { preferences, sortedRows, visibleIds, visibleRows, sortBy, saveFailed } =
    useSortableCharacterRows<SpellOut, SpellSort>({
      rows: character.spells,
      characterId: character.id,
      query: revealingAnchor ? '' : query,
      readPreferences: readSpellTablePreferences,
      savePreferences: saveSpellTablePreferences,
      comparators: {
        name: (a, b) => compareTableText(a.name, b.name),
        points: (a, b) => a.points - b.points,
        level: (a, b) => compareOptionalLevel(a.level, b.level),
        cost: (a, b) => a.effectiveCost - b.effectiveCost,
        upkeep: (a, b) =>
          compareOptionalLevel(a.effectiveMaintenanceCost, b.effectiveMaintenanceCost),
        time: (a, b) => compareTableText(a.castingTime ?? '', b.castingTime ?? ''),
      },
      matchesSearch: (spell, search) =>
        `${spell.name} ${spell.college ?? ''} ${spell.notes ?? ''}`
          .toLocaleLowerCase()
          .includes(search),
      announcementName: (spell) => spell.name,
    });
  const [pendingRoll, setPendingRoll] = useState<{ request: RollRequest; context: string } | null>(
    null,
  );
  const rollContext = JSON.stringify([
    character.id,
    character.campaignId,
    character.manaLevel,
    character.manaLevelKnown,
  ]);
  useEffect(() => {
    setPendingRoll((pending) => (pending?.context === rollContext ? pending : null));
  }, [rollContext]);
  const characterHasMagery = hasMagery(character.traits);
  const notice = manaNotice(character.manaLevel, character.manaLevelKnown, characterHasMagery);
  const castable = characterCanCast(character);
  const reference = character.spells.find((spell) => spell.id === referenceId);
  const totalPoints = character.spells.reduce((sum, spell) => sum + spell.points, 0);
  return (
    <section className="min-w-0 space-y-3" aria-label="Spellbook">
      <header
        className="field-rollback-flash flex flex-wrap items-center justify-between gap-3"
        {...submission.flashProps}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-display text-xl">Spells</h2>
          <p className="text-xs text-base-content/60">
            {character.spells.length} {character.spells.length === 1 ? 'spell' : 'spells'} ·{' '}
            {totalPoints} points
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            className="btn btn-sm min-h-11"
            aria-expanded={showAdd}
            aria-controls={addId}
            onClick={() => setShowAdd((value) => !value)}
          >
            {showAdd ? 'Close add form' : '+ Add spell'}
          </button>
        )}
      </header>
      <div id={addId} hidden={!showAdd || !canWrite}>
        <AddSpellForm
          characterId={character.id}
          campaignId={character.campaignId ?? null}
          canWrite={canWrite}
          submission={submission}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          aria-label="Search spells"
          placeholder="Search spells…"
          className="input input-sm min-h-11 w-full min-w-0 sm:max-w-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className={`text-xs ${notice?.tone ?? 'text-base-content/60'}`}>
          {notice?.text ?? 'Normal mana'}
        </p>
      </div>
      {saveFailed && (
        <p className="text-xs text-warning">
          Spell sorting works, but could not be remembered on this device.
        </p>
      )}
      {character.spells.length === 0 ? (
        <p className="py-3 text-sm text-base-content/60">No spells learned yet.</p>
      ) : (
        <Table
          preferenceKey={`${character.id}:spells`}
          filterRows={character.spells.map(spellFilterValues)}
          className="table table-sm w-full table-auto"
          aria-label="Spells"
        >
          <caption className="sr-only">
            Character spells. Names open reference details. Levels open rolls. Costs are energy
            after skill discounts.
          </caption>
          <thead>
            <tr>
              <SortableHeader label="Spell" sort="name" preferences={preferences} onSort={sortBy} />
              <SortableHeader
                label="Points"
                sort="points"
                preferences={preferences}
                onSort={sortBy}
                headerClassName="hidden w-16 text-right lg:table-cell"
              />
              <SortableHeader
                label="Level"
                sort="level"
                preferences={preferences}
                onSort={sortBy}
                headerClassName="w-14 text-right"
              />
              <SortableHeader
                label="Cost"
                sort="cost"
                preferences={preferences}
                onSort={sortBy}
                headerClassName="hidden w-16 text-right sm:table-cell"
              />
              <SortableHeader
                label="Upkeep"
                sort="upkeep"
                preferences={preferences}
                onSort={sortBy}
                headerClassName="hidden w-20 text-right sm:table-cell"
              />
              <SortableHeader
                label="Casting time"
                sort="time"
                preferences={preferences}
                onSort={sortBy}
                headerClassName="hidden w-28 xl:table-cell"
              />
              <th scope="col" className={`hidden sm:table-cell ${canWrite ? 'w-48' : 'w-0 p-0'}`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {sortedRows.map((spell) => (
            <SpellRow
              key={spell.id}
              characterId={character.id}
              spell={spell}
              canWrite={canWrite}
              castable={castable}
              manaKnown={character.manaLevelKnown}
              expanded={expandedId === spell.id}
              visible={visibleIds.has(spell.id)}
              highlighted={anchorSpellId === spell.id && (revealingAnchor || query.trim() === '')}
              onToggle={() => setExpandedId((value) => (value === spell.id ? null : spell.id))}
              onReference={() => setReferenceId(spell.id)}
              onCast={(spell, mode) => setCasting({ spell, mode })}
              onRoll={(request) =>
                setPendingRoll({
                  request: { ...request, spellManaLevel: character.manaLevel },
                  context: rollContext,
                })
              }
            />
          ))}
          {visibleRows.length === 0 && (
            <TableBody>
              <tr>
                <td colSpan={7} className="py-5 text-center text-base-content/60">
                  No spells match your search.
                </td>
              </tr>
            </TableBody>
          )}
        </Table>
      )}
      {character.spells.length > 0 && (
        <p className="text-xs text-base-content/60">
          Level opens a roll. Cast and Maintain pay energy separately. Upkeep 0 is free; — means no
          upkeep recorded.
        </p>
      )}
      {reference && (
        <SpellReferenceDialog
          spell={reference}
          effects={character.effects}
          onClose={() => setReferenceId(null)}
        />
      )}
      {casting && (
        <CastSpellDialog
          character={character}
          spell={casting.spell}
          mode={casting.mode}
          onClose={() => setCasting(null)}
        />
      )}
      {pendingRoll && pendingRoll.context === rollContext && character.manaLevelKnown && (
        <RollSheet
          request={pendingRoll.request}
          characterId={character.id}
          onClose={() => setPendingRoll(null)}
        />
      )}
    </section>
  );
}
