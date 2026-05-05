import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { enqueueCreate, newClientId } from '../../sync/outbox.ts';
import { useCharactersList } from './useCharacterDetail.ts';

export function CharactersPage() {
  const navigate = useNavigate();
  const characters = useCharactersList();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const trimmed = name.trim();
    const localId = newClientId();
    setCreating(true);
    setCreateError(null);
    try {
      // Local-first: write to Dexie + enqueue outbox; the orchestrator
      // pushes to /sync/operations in the background.  We can navigate
      // immediately because the sheet reads from Dexie via useLiveQuery,
      // not from the server.
      await enqueueCreate({
        entityClass: 'character',
        entityId: localId,
        humanName: 'character',
        attemptedValue: {
          name: trimmed,
          st: 10,
          dx: 10,
          iq: 10,
          ht: 10,
          hpMod: 0,
          willMod: 0,
          perMod: 0,
          fpMod: 0,
          speedQuarterMod: 0,
          moveMod: 0,
          tempSt: 0,
          tempDx: 0,
          tempIq: 0,
          tempHt: 0,
          tempHpMod: 0,
          tempWillMod: 0,
          tempPerMod: 0,
          tempFpMod: 0,
          tempSpeedQuarterMod: 0,
          tempMoveMod: 0,
          dismissedWarnings: [],
        },
      });
      // Per AGENTS.md rule 1: only navigate / clear if the input still
      // matches what we submitted.  If the user has started typing the
      // next character's name, leave it alone.
      if (name === trimmed) {
        setName('');
        navigate(`/characters/${localId}`);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="label-eyebrow">Characters</p>
        <h1 className="font-display text-3xl">Your characters</h1>
      </header>

      <form
        className="card grid gap-3 p-4 sm:grid-cols-[minmax(16rem,24rem)_auto] sm:items-end"
        onSubmit={submit}
      >
        <label className="form-control">
          <span className="label-text">New character name</span>
          <input
            className="input input-bordered"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sir Lancelot"
          />
        </label>
        <button type="submit" className="btn btn-primary sm:w-fit" disabled={creating}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {createError && <p className="text-error text-sm">Couldn’t create — {createError}</p>}

      <ul className="grid md:grid-cols-2 gap-3">
        {(characters ?? []).map((c) => (
          <li key={c.id}>
            <Link
              to={`/characters/${c.id}`}
              className="card block p-4 transition hover:border-border-strong"
            >
              <div className="flex items-baseline justify-between">
                <p className="font-display text-xl">{c.name}</p>
                <span className="label-eyebrow">TL {c.techLevel ?? '—'}</span>
              </div>
              <p className="text-sm text-base-content/70">
                <span className="num">ST {c.st}</span> · <span className="num">DX {c.dx}</span> ·{' '}
                <span className="num">IQ {c.iq}</span> · <span className="num">HT {c.ht}</span>
              </p>
            </Link>
          </li>
        ))}
        {characters && characters.length === 0 && (
          <li className="text-base-content/60 text-sm">No characters yet.</li>
        )}
      </ul>
    </div>
  );
}
