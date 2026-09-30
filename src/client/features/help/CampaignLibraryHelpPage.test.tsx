import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { evaluateCalculation } from '../../../shared/domain/calculation.ts';
import { calculationDefinition } from '../../../shared/schemas/calculation.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { CampaignLibraryHelpPage } from './CampaignLibraryHelpPage.tsx';
import guide from './campaign-library.md?raw';

vi.mock('../../hooks/useAppHeaderBottom.ts', () => ({ useAppHeaderBottom: () => 48 }));

function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

describe('CampaignLibraryHelpPage', () => {
  it('routes to a section anchor and returns to the selected campaign library', async () => {
    await getLocalDb().campaigns.put({
      id: 'campaign-7',
      ownerId: 'owner',
      name: 'Test campaign',
      description: null,
      pointTarget: null,
      disadvantageCap: null,
      quirkCap: null,
      experimentalActiveEffects: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
    } as never);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <MemoryRouter initialEntries={['/help/library?campaign=campaign-7']}>
        <Location />
        <CampaignLibraryHelpPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Back to library' })).toHaveAttribute(
      'href',
      '/campaigns/campaign-7/library',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Experimental: active effects' }));
    const heading = await screen.findByRole('heading', {
      name: 'Experimental: active effects',
    });

    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/help/library?campaign=campaign-7#experimental-active-effects',
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('uses a schema-valid worked calculation with the documented results', () => {
    const code = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].find((match) =>
      match[1]?.includes('levelCost'),
    )?.[1];
    expect(code).toBeTruthy();
    const definition = calculationDefinition.parse(parseYaml(code ?? ''));

    expect(evaluateCalculation(definition, { level: 1 })).toEqual({ points: 8 });
    expect(evaluateCalculation(definition, { level: 2 })).toEqual({ points: 11 });
    expect(evaluateCalculation(definition, { level: 4 })).toEqual({ points: 17 });
  });
});
