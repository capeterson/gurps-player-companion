import { useState } from 'react';
import { SPELL_DIFFICULTIES, type SpellDifficulty } from '../../../../shared/constants/skills.ts';
import { characterCanCast, hasMagery } from '../../../../shared/domain/spellCalc.ts';
import type { LibrarySpellOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SpellOut } from '../../../../shared/schemas/spell.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useFieldFlash } from '../../../hooks/useFieldFlash.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';
import { RollSheet } from '../play/RollSheet.tsx';
import type { RollRequest } from '../play/rollTypes.ts';
import { CastSpellDialog } from './CastSpellDialog.tsx';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

interface AddSpellFormProps {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
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

function AddSpellForm({ characterId, campaignId, canWrite }: AddSpellFormProps) {
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [college, setCollege] = useState('');
  const [difficulty, setDifficulty] = useState<SpellDifficulty>('H');
  const [points, setPoints] = useState('1');
  const [baseEnergyCost, setBaseEnergyCost] = useState('1');
  const [creating, setCreating] = useState(false);
  // Full library row when the name was picked from the autocomplete;
  // carries book fields (maintenance, casting time, ...) into the create.
  const [picked, setPicked] = useState<LibrarySpellOut | null>(null);

  const { fetchOptions } = useLibraryFetcher<LibrarySpellOut>('spells', campaignId);

  async function submit(snap: SpellSnapshot) {
    setCreating(true);
    try {
      await enqueueCreate({
        entityClass: 'character_spell',
        entityId: newClientId(),
        humanName: 'spell',
        characterId,
        attemptedValue: {
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
          characterId,
        },
      });
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
    } catch (err) {
      toasts.push(`Couldn't add spell — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
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
          points: Number.isFinite(pParsed) && pParsed >= 1 ? pParsed : 1,
          pointsRaw: points,
          baseEnergyCost: Number.isFinite(eParsed) && eParsed >= 0 ? eParsed : 1,
          baseEnergyCostRaw: baseEnergyCost,
          library: picked && picked.name === name.trim() ? picked : null,
        });
      }}
    >
      <div className="form-control flex-1 min-w-[10rem]">
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
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Light"
          />
        )}
      </div>
      <label className="form-control w-32">
        <span className="label-text text-xs">College</span>
        <input
          className="input input-bordered input-sm"
          value={college}
          onChange={(e) => setCollege(e.target.value)}
          placeholder="e.g. Light"
        />
      </label>
      <label className="form-control">
        <span className="label-text text-xs">Diff</span>
        <select
          className="select select-bordered select-sm"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as SpellDifficulty)}
        >
          {SPELL_DIFFICULTIES.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="form-control w-16">
        <span className="label-text text-xs">Pts</span>
        <input
          className="input input-bordered input-sm num"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </label>
      <label className="form-control w-16">
        <span className="label-text text-xs">Cost</span>
        <input
          className="input input-bordered input-sm num"
          value={baseEnergyCost}
          onChange={(e) => setBaseEnergyCost(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

interface SpellRowProps {
  characterId: string;
  spell: SpellOut;
  canWrite: boolean;
  /** False when the ambient mana level forbids this character casting. */
  castable: boolean;
  onCast(spell: SpellOut, mode: 'cast' | 'maintain'): void;
  onRoll(req: RollRequest): void;
}

function SpellRow({ characterId, spell, canWrite, castable, onCast, onRoll }: SpellRowProps) {
  const toasts = useToasts();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A spell with no points has no skill level (spells have no default
  // in GURPS), so there is nothing to roll against — hold Cast/Maintain
  // for that row even when the ambient mana allows casting.
  const rowCastable = castable && spell.level != null;
  // The difficulty select commits instantly (no draft state), so it
  // wires the rollback flash through useFieldFlash directly (AGENTS.md
  // rule 2 / S5: a rejected patch must pulse the input it reverts).
  const difficultyFlash = useFieldFlash(makeFlashKey('character_spell', spell.id, 'difficulty'));

  const patchSpell = (field: string, value: unknown) =>
    enqueueFieldPatch({
      entityClass: 'character_spell',
      entityId: spell.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: `${spell.name} ${field}`,
      flashKey: makeFlashKey('character_spell', spell.id, field),
      characterId,
    });

  const nameField = useDraftField<string>({
    name: `${spell.name} name`,
    serverValue: spell.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchSpell('name', v),
    flashKey: makeFlashKey('character_spell', spell.id, 'name'),
  });
  const pointsField = useDraftField<number>({
    name: `${spell.name} points`,
    serverValue: spell.points,
    parse: (s) => {
      const n = Number(s);
      // Spells have no default in GURPS — knowing one takes >= 1 point.
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
        throw new Error('positive integer only');
      }
      return n;
    },
    onSave: (v) => patchSpell('points', v),
    flashKey: makeFlashKey('character_spell', spell.id, 'points'),
  });
  const costField = useDraftField<number>({
    name: `${spell.name} base cost`,
    serverValue: spell.baseEnergyCost,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new Error('non-negative integer only');
      }
      return n;
    },
    onSave: (v) => patchSpell('baseEnergyCost', v),
    flashKey: makeFlashKey('character_spell', spell.id, 'baseEnergyCost'),
  });

  const removeSpell = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_spell',
        entityId: spell.id,
        humanName: `spell "${spell.name}"`,
        characterId,
        prevValue: spell,
      });
    } catch (err) {
      toasts.push(`Couldn't delete spell — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  return (
    <li className="grid grid-cols-[1fr_5rem_3.5rem_3rem_3rem_3rem_3rem_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      {canWrite ? (
        <input
          aria-label={`${spell.name} name`}
          className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm font-medium`}
          {...nameField.inputProps}
        />
      ) : (
        <span className="font-medium">{spell.name}</span>
      )}
      <span className="text-xs text-base-content/70 truncate">{spell.college ?? '—'}</span>
      {canWrite ? (
        <select
          aria-label={`${spell.name} difficulty`}
          className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm`}
          data-flashing={difficultyFlash['data-flashing']}
          data-flash-parity={difficultyFlash['data-flash-parity']}
          value={spell.difficulty}
          onChange={(e) => void patchSpell('difficulty', e.target.value as SpellDifficulty)}
        >
          {SPELL_DIFFICULTIES.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-base-content/70 num text-center">IQ/{spell.difficulty}</span>
      )}
      {canWrite ? (
        <input
          aria-label={`${spell.name} points`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...pointsField.inputProps}
        />
      ) : (
        <span className="num text-right">{spell.points}</span>
      )}
      <RollLevelChip
        level={spell.level}
        name={spell.name}
        title={spell.level == null ? 'No points invested — spells have no default' : undefined}
        onRoll={(level) => onRoll({ label: spell.name, baseTarget: level })}
      />
      {canWrite ? (
        <input
          aria-label={`${spell.name} base cost`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...costField.inputProps}
        />
      ) : (
        <span className="num text-right">{spell.baseEnergyCost}</span>
      )}
      <span
        className="num text-right font-medium text-primary"
        aria-label={`${spell.name} effective cost`}
        title={`After skill discount: ${spell.effectiveCost} energy to cast${
          spell.effectiveMaintenanceCost != null
            ? `, ${spell.effectiveMaintenanceCost} to maintain`
            : ''
        }`}
      >
        {spell.effectiveCost}
      </span>
      <span className="flex gap-1 justify-end">
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={() => onCast(spell, 'cast')}
            disabled={!rowCastable}
            aria-label={`Cast ${spell.name}`}
            title={
              rowCastable
                ? 'Cast this spell'
                : spell.level == null
                  ? 'No points invested — this spell has no skill level to cast against'
                  : 'This character cannot cast here — see the mana notice above'
            }
          >
            Cast
          </button>
        )}
        {canWrite && spell.maintenanceCost != null && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onCast(spell, 'maintain')}
            disabled={!rowCastable}
            aria-label={`Maintain ${spell.name}`}
            title={
              rowCastable
                ? `Pay the maintenance cost (${spell.effectiveMaintenanceCost ?? spell.maintenanceCost} after discount) to keep this spell running`
                : spell.level == null
                  ? 'No points invested — this spell has no skill level to cast against'
                  : 'This character cannot cast here — see the mana notice above'
            }
          >
            Maint
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete spell ${spell.name}`}
          >
            ✕
          </button>
        )}
      </span>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete spell "${spell.name}"?`}
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          setConfirmDelete(false);
          void removeSpell();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
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
          ? 'Very high mana: anyone can cast here (no Magery needed) and spells cost no energy.'
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
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const [casting, setCasting] = useState<{ spell: SpellOut; mode: 'cast' | 'maintain' } | null>(
    null,
  );
  // Hosted once here (not per row), same as SkillsPanel, so every
  // roll-target tap opens the same sheet instance.
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const characterHasMagery = hasMagery(character.traits);
  const notice = manaNotice(character.manaLevel, character.manaLevelKnown, characterHasMagery);
  // Hold casting entirely while the campaign row (and thus the real
  // mana level) hasn't reached the local store: the builder's 'normal'
  // fallback must not let a no-mana campaign spend FP on first load.
  const castable = characterCanCast(character);

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Spells</p>
          <h2 className="font-display text-2xl">Known spells</h2>
        </div>
        <p className="text-xs text-base-content/60">
          {character.spells.length} {character.spells.length === 1 ? 'spell' : 'spells'}
        </p>
      </header>

      {notice && <p className={`text-xs ${notice.tone}`}>{notice.text}</p>}

      <AddSpellForm
        characterId={character.id}
        campaignId={character.campaignId ?? null}
        canWrite={canWrite}
      />

      {character.spells.length === 0 ? (
        <p className="text-sm text-base-content/60">No spells learned yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_5rem_3.5rem_3rem_3rem_3rem_3rem_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Spell</span>
            <span>College</span>
            <span>Diff</span>
            <span className="text-right">Pts</span>
            <span className="text-right">Lvl</span>
            <span className="text-right">Base</span>
            <span className="text-right">Cost</span>
            <span />
          </div>
          <ul>
            {character.spells.map((s) => (
              <SpellRow
                key={s.id}
                characterId={character.id}
                spell={s}
                canWrite={canWrite}
                castable={castable}
                onCast={(spell, mode) => setCasting({ spell, mode })}
                onRoll={setRollRequest}
              />
            ))}
          </ul>
        </>
      )}

      {casting && (
        <CastSpellDialog
          character={character}
          spell={casting.spell}
          mode={casting.mode}
          onClose={() => setCasting(null)}
        />
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
