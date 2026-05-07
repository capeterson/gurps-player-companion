import { useState } from 'react';
import { hasMagery } from '../../../../shared/domain/spellCalc.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SpellOut } from '../../../../shared/schemas/spell.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';
import { CastSpellDialog } from './CastSpellDialog.tsx';

interface AddSpellFormProps {
  characterId: string;
  canWrite: boolean;
}

interface SpellSnapshot {
  name: string;
  nameRaw: string;
  college: string;
  collegeRaw: string;
  points: number;
  pointsRaw: string;
  baseEnergyCost: number;
  baseEnergyCostRaw: string;
}

function AddSpellForm({ characterId, canWrite }: AddSpellFormProps) {
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [college, setCollege] = useState('');
  const [points, setPoints] = useState('1');
  const [baseEnergyCost, setBaseEnergyCost] = useState('1');
  const [creating, setCreating] = useState(false);

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
          points: snap.points,
          baseEnergyCost: snap.baseEnergyCost,
          characterId,
        },
      });
      // Per AGENTS.md: only clear fields whose value still matches the
      // snapshot we sent.  If the user has started typing the next
      // spell while this enqueue was in flight, leave them alone.
      if (name === snap.nameRaw) setName('');
      if (college === snap.collegeRaw) setCollege('');
      if (points === snap.pointsRaw) setPoints('1');
      if (baseEnergyCost === snap.baseEnergyCostRaw) setBaseEnergyCost('1');
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
          points: Number.isFinite(pParsed) && pParsed >= 0 ? pParsed : 1,
          pointsRaw: points,
          baseEnergyCost: Number.isFinite(eParsed) && eParsed >= 0 ? eParsed : 1,
          baseEnergyCostRaw: baseEnergyCost,
        });
      }}
    >
      <label className="form-control flex-1 min-w-[10rem]">
        <span className="label-text text-xs">Spell</span>
        <input
          className="input input-bordered input-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Light"
        />
      </label>
      <label className="form-control w-32">
        <span className="label-text text-xs">College</span>
        <input
          className="input input-bordered input-sm"
          value={college}
          onChange={(e) => setCollege(e.target.value)}
          placeholder="e.g. Light"
        />
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
  onCast(spell: SpellOut): void;
}

function SpellRow({ characterId, spell, canWrite, onCast }: SpellRowProps) {
  const toasts = useToasts();

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
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new Error('non-negative integer only');
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
    <li className="grid grid-cols-[1fr_5rem_3rem_3rem_3rem_3rem_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
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
        <input
          aria-label={`${spell.name} points`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...pointsField.inputProps}
        />
      ) : (
        <span className="num text-right">{spell.points}</span>
      )}
      <span className="num text-right font-medium" aria-label={`${spell.name} level`}>
        {spell.level}
      </span>
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
        title={`After skill discount: ${spell.effectiveCost} energy`}
      >
        {spell.effectiveCost}
      </span>
      <span className="flex gap-1 justify-end">
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={() => onCast(spell)}
            aria-label={`Cast ${spell.name}`}
            title="Cast this spell"
          >
            Cast
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              if (confirm(`Delete spell "${spell.name}"?`)) void removeSpell();
            }}
            aria-label={`Delete spell ${spell.name}`}
          >
            ✕
          </button>
        )}
      </span>
    </li>
  );
}

export function SpellsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const [castSpell, setCastSpell] = useState<SpellOut | null>(null);
  const characterHasMagery = hasMagery(character.traits);

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

      {!characterHasMagery && (
        <p className="text-xs text-warning">
          No Magery trait detected. Spells default to skill -2 (no Magery bonus); add the Magery
          advantage in Traits to unlock spell casting in normal mana.
        </p>
      )}

      <AddSpellForm characterId={character.id} canWrite={canWrite} />

      {character.spells.length === 0 ? (
        <p className="text-sm text-base-content/60">No spells learned yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_5rem_3rem_3rem_3rem_3rem_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Spell</span>
            <span>College</span>
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
                onCast={setCastSpell}
              />
            ))}
          </ul>
        </>
      )}

      {castSpell && (
        <CastSpellDialog
          character={character}
          spell={castSpell}
          onClose={() => setCastSpell(null)}
        />
      )}
    </section>
  );
}
