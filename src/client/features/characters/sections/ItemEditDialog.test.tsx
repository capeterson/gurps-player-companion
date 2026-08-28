/**
 * ItemEditDialog — the facet-chip category control replaces the old
 * per-fieldset checkboxes: chips toggle facets, an inactive facet reads
 * "+ Weapon", activating one reveals its fieldset, and removing a facet
 * that carried data on the loaded item asks for confirmation first
 * (the data is only cleared on Save).
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { ItemEditDialog } from './ItemEditDialog.tsx';

/** ItemEditDialog calls useToasts(), so every render needs the provider. */
function renderWithToasts(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function makeItem(overrides: Partial<InventoryItemOut> = {}): InventoryItemOut {
  return {
    id: 'i1',
    characterId: 'c1',
    name: 'Broadsword',
    quantity: 1,
    weightLbs: 3,
    cost: 500,
    notes: null,
    parentId: null,
    externalLocation: null,
    worn: false,
    equipped: true,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    libraryItemId: null,
    effectiveWeightLbs: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as InventoryItemOut;
}

describe('ItemEditDialog facet chips', () => {
  it('asks for confirmation before removing a facet that carries data', () => {
    renderWithToasts(
      <ItemEditDialog
        open
        item={makeItem({
          weaponData: {
            damage: 'sw+1 cut',
            reach: '1',
            parry: '0',
            stRequired: null,
            skill: 'Broadsword',
            db: null,
            ranged: null,
            notes: null,
          },
        })}
        skillNames={['Broadsword']}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    // Loaded as a weapon => the fieldset is visible and the chip is active.
    expect(screen.getByPlaceholderText('e.g. Broadsword')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Weapon/ }));

    // Removal is gated by a confirm; the fieldset is still present until confirmed.
    expect(screen.getByText(/Remove the Weapon category\?/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Broadsword')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByPlaceholderText('e.g. Broadsword')).not.toBeInTheDocument();
  });

  it('renders inactive facets as "+ Label" and reveals the fieldset on toggle', () => {
    renderWithToasts(
      <ItemEditDialog
        open
        item={makeItem()}
        skillNames={['Broadsword', 'Shortsword']}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    // No weapon data => the Weapon chip offers to add the facet.
    const addWeapon = screen.getByRole('button', { name: '+ Weapon' });
    expect(addWeapon).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByPlaceholderText('e.g. Broadsword')).not.toBeInTheDocument();

    fireEvent.click(addWeapon);

    // Fieldset now visible with the governing-skill datalist input, and the
    // chip flips to active (aria-pressed; the ✕ is aria-hidden).
    expect(screen.getByPlaceholderText('e.g. Broadsword')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Weapon/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the standard DaisyUI modal + backdrop structure with mobile-safe sizing', () => {
    const { container } = renderWithToasts(
      <ItemEditDialog open item={makeItem()} onSubmit={() => {}} onCancel={() => {}} />,
    );

    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    // Project-standard structure: `.modal` shell, not the ad-hoc `.modal-back`.
    expect(dialog).toHaveClass('modal');
    expect(dialog).not.toHaveClass('modal-back');

    const box = container.querySelector('.modal-box');
    expect(box).not.toBeNull();
    // Content stays scrollable and sized against the *dynamic* viewport so
    // mobile browser chrome never hides the sticky actions.
    expect(box?.className).toMatch(/overflow-y-auto/);
    expect(box?.className).toMatch(/max-h-\[calc\(100dvh-/);
    // No static viewport units left anywhere in the dialog subtree.
    expect(dialog?.outerHTML).not.toContain('100vh');

    // A real, dismissable backdrop.
    expect(container.querySelector('form.modal-backdrop')).not.toBeNull();
  });

  it('keeps the Save/Cancel actions reachable and wired', () => {
    const onCancel = vi.fn();
    const { container } = renderWithToasts(
      <ItemEditDialog open item={makeItem()} onSubmit={() => {}} onCancel={onCancel} />,
    );

    const actions = container.querySelector('.modal-action');
    expect(actions).not.toBeNull();
    const scoped = within(actions as HTMLElement);
    fireEvent.click(scoped.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(scoped.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('writes the governing skill into the submitted patch', () => {
    const onSubmit = vi.fn();
    renderWithToasts(
      <ItemEditDialog
        open
        item={makeItem({ name: 'Excalibur' })}
        skillNames={['Broadsword']}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Weapon' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Broadsword'), {
      target: { value: 'Broadsword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const patch = onSubmit.mock.calls[0]?.[0];
    expect(patch.weaponData).toMatchObject({ skill: 'Broadsword' });
  });
});
