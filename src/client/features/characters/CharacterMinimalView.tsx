import { MediaImage } from '../../components/MediaImage.tsx';
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
import { CharacterIdentityDetails } from './CharacterIdentityDetails.tsx';

export function CharacterMinimalView({ data }: { data: CharacterMinimalOut }) {
  return (
    <section className="grid gap-7">
      <header>
        <p className="label-eyebrow mb-2.5">
          <Link to="/characters" className="link link-hover">
            ← All characters
          </Link>{' '}
          · Limited view
        </p>
        <MediaImage
          targetType="character"
          targetId={data.id}
          assetId={data.portraitAssetId}
          name={data.name}
        />
        <h1 className="font-name [overflow-wrap:anywhere] text-3xl leading-tight sm:text-5xl">
          {data.name}
        </h1>
        <p className="mt-3 text-sm text-base-content/60 max-w-prose">
          The campaign owner has hidden detailed sheet information from other players. Ask the owner
          to enable sheet sharing in the campaign settings if you need full access.
        </p>
      </header>

      <CharacterIdentityDetails data={data} />
    </section>
  );
}
