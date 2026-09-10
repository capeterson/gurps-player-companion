import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { flashBus } from '../../../sync/flashBus.ts';
import { InventoryPanel } from './InventoryPanel.tsx';
import { LanguagesPanel } from './LanguagesPanel.tsx';
import { TechniquesPanel } from './TechniquesPanel.tsx';

for (const [entityClass, Panel] of [
  ['character_language', LanguagesPanel],
  ['character_technique', TechniquesPanel],
  ['character_inventory', InventoryPanel],
] as const) {
  it(`${entityClass} visibly flashes its add form on a source rejection`, () => {
    const character = {
      id: 'character',
      campaignId: null,
      languages: [],
      techniques: [],
      inventory: [],
      skills: [],
      libraryEffectsKnown: false,
    } as unknown as CharacterDetail;
    const client = new QueryClient();
    const { container, unmount } = render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Panel character={character} canWrite />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const form = container.querySelector('form');
    expect(form).toHaveClass('field-rollback-flash');
    act(() =>
      flashBus.emit({
        key: `${entityClass}:character:create`,
        reason: 'Library reference unavailable',
      }),
    );
    expect(form).toHaveAttribute('data-flashing', 'true');
    unmount();
    client.clear();
  });
}
