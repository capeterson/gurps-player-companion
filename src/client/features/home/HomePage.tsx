import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { guestCampaignId, useIsGuestSession } from '../../lib/guestSession.ts';
import { CharacterCard } from '../characters/CharacterCard.tsx';
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
  const guest = useIsGuestSession();

  const recent = (characters ?? []).slice(0, 4);
  const previewCampaignId = guest ? guestCampaignId() : null;
  // A guest owns nothing; their home is the preview campaign.
  if (previewCampaignId) return <Navigate to={`/campaigns/${previewCampaignId}`} replace />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="card overflow-hidden p-card sm:p-8">
        <div className="max-w-2xl space-y-3">
          <p className="label-eyebrow">Welcome</p>
          <h1 className="font-display text-4xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-5xl">
            {me.data?.displayName ?? 'Adventurer'}
          </h1>
          {characters?.length === 0 && (
            <Link to="/characters" className="btn btn-primary">
              Create your first character
            </Link>
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <p className="label-eyebrow">Recent characters</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((c) => (
              <CharacterCard key={c.id} character={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
