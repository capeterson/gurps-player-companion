import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryTraitEffect } from '../../../shared/schemas/effects.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { EffectsEditor } from './EffectsEditor.tsx';

const CAMPAIGN = '0193b3c0-f1f0-7000-8000-00000000ef01';

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function renderEditor(initial: LibraryTraitEffect[] = [], enabled = true) {
  await getLocalDb().campaigns.put({
    id: CAMPAIGN,
    ownerId: 'owner',
    name: 'Effects test campaign',
    description: null,
    pointTarget: null,
    disadvantageCap: null,
    quirkCap: null,
    experimentalActiveEffects: enabled,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  } as never);
  const onChange = vi.fn();
  const onValidityChange = vi.fn();
  renderWithQuery(
    <EffectsEditor
      effects={initial}
      campaignId={CAMPAIGN}
      onChange={onChange}
      onValidityChange={onValidityChange}
    />,
  );
  return { onChange, onValidityChange };
}

describe('EffectsEditor', () => {
  it('authors a skill effect with specialty, scaling, condition, and preview', async () => {
    const { onChange } = await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add effect' }));
    await screen.findByText('Condition', { selector: 'summary' });
    fireEvent.change(screen.getByPlaceholderText('Public Speaking or *'), {
      target: { value: 'Guns' },
    });
    fireEvent.change(screen.getByPlaceholderText('Pistol or *'), {
      target: { value: 'Pistol' },
    });
    fireEvent.change(screen.getByDisplayValue('Flat'), { target: { value: 'per_level' } });
    fireEvent.click(screen.getByText('Condition'));
    fireEvent.change(screen.getByPlaceholderText('vs_fear'), { target: { value: 'aimed' } });
    fireEvent.change(screen.getByPlaceholderText('Against fear'), {
      target: { value: 'While aiming' },
    });

    expect(screen.getByText('+1/level to Guns/Pistol while While aiming')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([
      {
        target: 'skill',
        value: 1,
        scaling: 'per_level',
        skillName: 'Guns',
        skillSpecialty: 'Pistol',
        conditionGroup: 'aimed',
        conditionLabel: 'While aiming',
      },
    ]);
  });

  it('keeps saved conditional declarations but hides condition editing while the campaign flag is off', async () => {
    await renderEditor(
      [
        {
          target: 'dx',
          value: 2,
          scaling: 'flat',
          conditionGroup: 'focused',
          conditionLabel: 'Focused',
        },
      ],
      false,
    );
    expect(screen.queryByText('Condition', { selector: 'summary' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('focused')).not.toBeInTheDocument();
    await getLocalDb().campaigns.update(CAMPAIGN, { experimentalActiveEffects: true });
    expect(await screen.findByText('Condition', { selector: 'summary' })).toBeVisible();
  });

  it('retains blank numeric and label-first drafts while reporting field errors', async () => {
    const { onChange, onValidityChange } = await renderEditor([
      { target: 'dx', value: 1, scaling: 'flat' },
    ]);
    await screen.findByText('Condition', { selector: 'summary' });
    const bonus = screen.getByLabelText('Effect 1 bonus');
    fireEvent.change(bonus, { target: { value: '' } });
    expect(bonus).toHaveValue('');
    expect(screen.getByLabelText('Effect 1 errors')).toHaveTextContent('Expected number');
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Condition'));
    const label = screen.getByPlaceholderText('Against fear');
    fireEvent.change(label, { target: { value: 'Only while focused' } });
    expect(label).toHaveValue('Only while focused');
    expect(screen.getByLabelText('Effect 1 errors')).toHaveTextContent(
      'conditionLabel requires conditionGroup',
    );
  });

  it('duplicates, reorders, and deletes without changing effect content', async () => {
    const { onChange } = await renderEditor([
      { target: 'dx', value: 1, scaling: 'flat' },
      { target: 'iq', value: 2, scaling: 'flat' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Move effect 2 up' }));
    expect(onChange).toHaveBeenLastCalledWith([
      { target: 'iq', value: 2, scaling: 'flat' },
      { target: 'dx', value: 1, scaling: 'flat' },
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate' })[0] as HTMLElement);
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(2);
  });

  it('shows only portable selectors and hides mode for item-level defenses', async () => {
    const { onChange } = await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add effect' }));
    fireEvent.change(screen.getByLabelText('Effect 1 target'), {
      target: { value: 'weapon_attack' },
    });
    fireEvent.change(screen.getByPlaceholderText('Broadsword'), {
      target: { value: 'Broadsword' },
    });
    fireEvent.change(screen.getByLabelText('Stable attack mode key (optional)'), {
      target: { value: 'thrust' },
    });
    fireEvent.change(screen.getByLabelText('Effect 1 target'), {
      target: { value: 'weapon_parry' },
    });
    expect(screen.getByText('Governing skill')).toBeInTheDocument();
    expect(screen.queryByText('Exact inventory item')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stable attack mode key (optional)')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([
      {
        target: 'weapon_parry',
        value: 1,
        scaling: 'flat',
        weaponSelector: { kind: 'weapon_skill', skillName: 'Broadsword' },
      },
    ]);
  });

  it('authors an exact inventory binding only in the character-owned editor', () => {
    const onChange = vi.fn();
    const inventoryItemId = '01997c5c-8d80-7000-8000-000000000001';
    renderWithQuery(
      <EffectsEditor
        effects={[]}
        portable={false}
        inventoryItems={[
          {
            id: inventoryItemId,
            name: 'Balanced saber',
            equipped: true,
            weaponData: { skill: 'Broadsword', alternateModes: [] },
          } as never,
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add effect' }));
    fireEvent.change(screen.getByLabelText('Effect 1 target'), {
      target: { value: 'weapon_attack' },
    });
    fireEvent.change(screen.getByDisplayValue('Governing skill'), {
      target: { value: 'inventory_item' },
    });
    fireEvent.change(screen.getByDisplayValue('Select an inventory weapon…'), {
      target: { value: inventoryItemId },
    });

    expect(screen.getByText('Balanced saber')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([
      {
        target: 'weapon_attack',
        value: 1,
        scaling: 'flat',
        weaponSelector: { kind: 'inventory_item', inventoryItemId },
      },
    ]);
  });
});
