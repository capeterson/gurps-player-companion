import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { useCharactersList } from '../characters/useCharacterDetail.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function HomePage() {
  // /auth/me stays on the API: account identity is server-issued and
  // can't be served from Dexie.  Everything below it reads from the
  // local store via useLiveQuery.
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });
  const characters = useCharactersList();

  const recent = (characters ?? []).slice(0, 4);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="card overflow-hidden p-card sm:p-8">
        <div className="max-w-2xl space-y-3">
          <p className="label-eyebrow">Welcome</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {me.data?.displayName ?? 'Adventurer'}
          </h1>
          <p className="text-sm text-muted">
            Sheets, the adventure log, and your campaigns — all one tab away.
          </p>
          <div className="flex flex-wrap gap-2.5 pt-2">
            <Link to="/characters" className="btn btn-primary">
              Open Sheet
            </Link>
            <Link to="/log" className="btn">
              Adventure Log
            </Link>
            <Link to="/campaigns" className="btn btn-ghost">
              Campaigns
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/characters" className="card p-card transition hover:border-border-strong">
          <p className="label-eyebrow">Your characters</p>
          <p className="font-display num text-3xl font-semibold">{characters?.length ?? '—'}</p>
          <p className="text-sm text-muted">Open sheets, create heroes, track advancement.</p>
        </Link>
        <Link to="/log" className="card p-card transition hover:border-border-strong">
          <p className="label-eyebrow">Adventure Log</p>
          <p className="font-display text-3xl font-semibold">Latest</p>
          <p className="text-sm text-muted">Session notes, private threads, and shared recaps.</p>
        </Link>
        <Link to="/campaigns" className="card p-card transition hover:border-border-strong">
          <p className="label-eyebrow">Campaigns</p>
          <p className="font-display text-3xl font-semibold">Workspaces</p>
          <p className="text-sm text-muted">Members, point targets, and shared libraries.</p>
        </Link>
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <p className="label-eyebrow">Recent characters</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((c) => (
              <div
                key={c.id}
                className="card flex flex-col gap-1 p-card transition hover:border-border-strong"
              >
                <Link to={`/characters/${c.id}`} className="min-w-0">
                  <p className="font-display text-lg font-semibold leading-tight truncate">
                    {c.name}
                  </p>
                  <p className="text-xs text-muted">
                    ST {c.st} · DX {c.dx} · IQ {c.iq} · HT {c.ht}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
