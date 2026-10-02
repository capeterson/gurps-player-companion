import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LibraryEnchantmentOut } from '../../../shared/schemas/campaignLibrary.ts';
import { ItemEnchantmentEditor } from './ItemEnchantmentEditor.tsx';

const DEFINITION_ID = '0193b3c0-f1f0-7000-8000-000000000001';
const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-000000000002';

const definition = {
  id: DEFINITION_ID,
  campaignId: CAMPAIGN_ID,
  name: 'Fortify',
  description: 'Raises armor resistance.',
  source: 'B',
  tags: ['armor'],
  applicability: 'armor',
  effects: [{ target: 'dr', value: 1 }],
  levels: [{ level: 1, effects: [{ target: 'dr', value: 1 }] }],
  stackingPolicy: { kind: 'stack' },
  revision: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as LibraryEnchantmentOut;

const snapshot = {
  applicability: 'armor',
  effects: [{ target: 'dr', value: 1 }],
  levels: [{ level: 1, effects: [{ target: 'dr', value: 1 }] }],
  stackingPolicy: { kind: 'stack' },
};

function Harness({
  initial,
  definitions = [definition],
}: {
  initial: unknown;
  definitions?: readonly LibraryEnchantmentOut[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ItemEnchantmentEditor value={value} definitions={definitions} onChange={setValue} />
      <output aria-label="Enchantments JSON">{JSON.stringify(value)}</output>
    </>
  );
}

describe('ItemEnchantmentEditor', () => {
  it('retains linked provenance and dormant mechanics on metadata edits, then preserves mechanics when detached', () => {
    render(
      <Harness
        initial={[
          {
            spellName: 'Fortify',
            spellLevel: 16,
            category: 'Armor',
            notes: 'Original note',
            level: 2,
            definitionId: DEFINITION_ID,
            definitionRevision: 4,
            definitionSource: 'B',
            mechanics: snapshot,
          },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Revised note' } });
    let rows = JSON.parse(screen.getByLabelText('Enchantments JSON').textContent ?? '[]');
    expect(rows[0]).toMatchObject({
      notes: 'Revised note',
      spellLevel: 16,
      category: 'Armor',
      level: 2,
      definitionId: DEFINITION_ID,
      definitionRevision: 4,
      definitionSource: 'B',
      mechanics: snapshot,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Make enchantment 1 independent' }));
    rows = JSON.parse(screen.getByLabelText('Enchantments JSON').textContent ?? '[]');
    expect(rows[0]).toMatchObject({
      definitionId: null,
      definitionRevision: null,
      definitionSource: null,
      mechanics: snapshot,
      notes: 'Revised note',
    });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Fine armor' } });
    rows = JSON.parse(screen.getByLabelText('Enchantments JSON').textContent ?? '[]');
    expect(rows[0]).toMatchObject({ category: 'Fine armor', mechanics: snapshot });
  });

  it('attaches a pending library definition without persisting its speculative revision', () => {
    const pending = { ...definition, id: '0193b3c0-f1f0-7000-8000-000000000003', revision: -1 };
    render(<Harness initial={[]} definitions={[pending]} />);
    fireEvent.change(screen.getByLabelText('Library enchantment'), {
      target: { value: pending.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach enchantment' }));
    const rows = JSON.parse(screen.getByLabelText('Enchantments JSON').textContent ?? '[]');
    expect(rows).toEqual([
      {
        spellName: 'Fortify',
        definitionId: pending.id,
        definitionRevision: null,
        definitionSource: 'B',
        mechanics: snapshot,
      },
    ]);
  });
});
