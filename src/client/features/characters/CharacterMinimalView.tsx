/**
 * Public-facing read-only view of a character. Rendered when the
 * parent campaign has `shareCharacterSheets=false` and the viewer is
 * a fellow campaign member who is not the character's owner.
 *
 * Hides traits, skills, inventory, combat, points, and stats — only
 * the "readily apparent" identity bits are shown so other players
 * still see whom they're sharing the table with.
 *
 * Mirrors gurps-player-web's `CharacterMinimalView`.
 */

import { Link } from 'react-router-dom';
import type { CharacterMinimalOut } from '../../../shared/schemas/character.ts';

export function CharacterMinimalView({ data }: { data: CharacterMinimalOut }) {
  const fields: Array<{ label: string; value: string | number | null }> = [
    { label: 'Player', value: data.playerName },
    { label: 'Height', value: data.height },
    { label: 'Weight', value: data.weight },
    { label: 'Age', value: data.age },
    { label: 'Tech level', value: data.techLevel === null ? null : `TL ${data.techLevel}` },
  ];

  return (
    <section className="grid gap-7">
      <header>
        <p className="label-eyebrow mb-2.5">
          <Link to="/characters" className="link link-hover">
            ← All characters
          </Link>{' '}
          · Limited view
        </p>
        <h1 className="font-name text-5xl leading-none">{data.name}</h1>
        <p className="mt-3 text-sm text-base-content/60 max-w-prose">
          The campaign owner has hidden detailed sheet information from other players. Ask the owner
          to enable sheet sharing in the campaign settings if you need full access.
        </p>
      </header>

      <section className="card border border-base-300/60 bg-base-100 rounded-2xl">
        <div className="card-body p-5 grid gap-5">
          <div>
            <header className="label-eyebrow mb-3">At a glance</header>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {fields.map((f) => (
                <div key={f.label}>
                  <dt className="label-eyebrow">{f.label}</dt>
                  <dd className="text-base-content">
                    {f.value === null || f.value === '' ? (
                      <span className="text-base-content/40">—</span>
                    ) : (
                      f.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          {data.appearance && (
            <div>
              <header className="label-eyebrow mb-2">Description</header>
              <p className="whitespace-pre-wrap text-base-content/90">{data.appearance}</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
