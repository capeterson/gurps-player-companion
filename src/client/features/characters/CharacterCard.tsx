import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MediaImage } from '../../components/MediaImage.tsx';

interface CharacterCardIdentity {
  id: string;
  name: string;
  portraitAssetId?: string | null | undefined;
  campaignId?: string | null | undefined;
  campaignName?: string | null | undefined;
  st: number;
  dx: number;
  iq: number;
  ht: number;
}

/** Shared roster card; callers supply only the data their viewer may see. */
export function CharacterCard({
  character,
  hideAttributes = false,
  openInNewTab = false,
  children,
}: {
  character: CharacterCardIdentity;
  hideAttributes?: boolean;
  openInNewTab?: boolean;
  children?: ReactNode;
}) {
  return (
    <article className="card block min-w-0 p-4 transition hover:border-border-strong">
      <h2 className="font-display no-cap text-xl font-semibold [overflow-wrap:anywhere]">
        <Link
          to={`/characters/${character.id}`}
          className="link link-hover"
          target={openInNewTab ? '_blank' : undefined}
          rel={openInNewTab ? 'noreferrer' : undefined}
        >
          <MediaImage
            targetType="character"
            targetId={character.id}
            assetId={character.portraitAssetId}
            name={character.name}
            thumbnail
          />
          {character.name}
        </Link>
      </h2>
      {character.campaignId && character.campaignName && (
        <p className="mt-0.5 text-sm text-base-content/70 [overflow-wrap:anywhere]">
          Campaign:{' '}
          <Link to={`/campaigns/${character.campaignId}`} className="link link-hover font-medium">
            {character.campaignName}
          </Link>
        </p>
      )}
      {!hideAttributes && (
        <p className="text-sm text-base-content/70">
          <span className="num">ST {character.st}</span> ·{' '}
          <span className="num">DX {character.dx}</span> ·{' '}
          <span className="num">IQ {character.iq}</span> ·{' '}
          <span className="num">HT {character.ht}</span>
        </p>
      )}
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </article>
  );
}
