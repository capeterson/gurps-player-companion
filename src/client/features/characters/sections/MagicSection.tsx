import { useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { ItemSpellsPanel } from './ItemSpellsPanel.tsx';
import { PowerstonesPanel } from './PowerstonesPanel.tsx';
import { SpellsPanel } from './SpellsPanel.tsx';

/** The Magic tab: one search filters both known spells and item spells. */
export function MagicSection({
  character,
  canWrite,
  anchorSpellId = null,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  anchorSpellId?: string | null;
}) {
  const [query, setQuery] = useState('');
  const searchable =
    character.spells.length > 0 || character.inventory.some((item) => item.magicItemData != null);
  return (
    <div className="min-w-0 space-y-6">
      {searchable && (
        <input
          type="search"
          aria-label="Search spells"
          placeholder="Search spells…"
          className="input input-sm min-h-11 w-full min-w-0 sm:max-w-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <SpellsPanel
        character={character}
        canWrite={canWrite}
        anchorSpellId={anchorSpellId}
        query={query}
        onQueryChange={setQuery}
      />
      <ItemSpellsPanel character={character} canWrite={canWrite} query={query} />
      <PowerstonesPanel character={character} canWrite={canWrite} />
    </div>
  );
}
