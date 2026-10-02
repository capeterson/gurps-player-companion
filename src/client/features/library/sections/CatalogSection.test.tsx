import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalLibraryModifier, LocalLibrarySource } from '../../../db/dexie.ts';
import { emptyLibrary } from '../useLocalLibrary.ts';
import { CatalogSection } from './CatalogSection.tsx';
import type { LibrarySectionShellProps } from './CrudLibrarySection.tsx';

const mutations = vi.hoisted(() => ({
  create: { isPending: false, error: null, mutate: vi.fn() },
  update: { isPending: false, error: null, mutate: vi.fn() },
  addOpen: true,
  setAddOpen: vi.fn(),
  editId: null as string | null,
  setEditId: vi.fn(),
  deleteId: null as string | null,
  setDeleteId: vi.fn(),
  remove: { isPending: false, error: null, mutate: vi.fn() },
}));

vi.mock('../useLocalLibrary.ts', () => ({
  emptyLibrary: () => ({
    sources: [],
    modifiers: [],
    traits: [],
    skills: [],
    spells: [],
    items: [],
    languages: [],
    techniques: [],
    styles: [],
    enchantments: [],
    activeEffects: [],
  }),
  useLibraryEntryMutations: () => mutations,
}));
vi.mock('./CrudLibrarySection.tsx', () => ({
  CrudLibrarySection: ({
    renderForm,
  }: {
    renderForm: (row: LocalLibrarySource | LocalLibraryModifier | null) => ReactNode;
  }) => renderForm(null),
}));

const shell: LibrarySectionShellProps = {
  campaignId: 'campaign-1',
  library: emptyLibrary(),
  words: [],
  active: true,
  isOwner: true,
  expandedId: null,
  onToggleExpanded: vi.fn(),
  jumpSlot: null,
  revealId: null,
  onRevealed: vi.fn(),
};

describe('Catalog source validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows field-specific errors and focuses the first missing field', () => {
    render(<CatalogSection {...shell} section="sources" />);
    const title = screen.getByRole('textbox', { name: 'Publication title' });

    fireEvent.click(screen.getByRole('button', { name: 'Save source' }));

    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveFocus();
    expect(screen.getByText('Enter publication title.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Abbreviation' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Check the source fields');
    expect(mutations.create.mutate).not.toHaveBeenCalled();
  });

  it('creates a sourcebook without a portable key', () => {
    render(<CatalogSection {...shell} section="sources" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Publication title' }), {
      target: { value: 'GURPS Basic Set' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Abbreviation' }), {
      target: { value: 'BX' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save source' }));

    expect(mutations.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'GURPS Basic Set', abbreviation: 'BX' }),
    );
    expect(mutations.create.mutate.mock.calls.at(-1)?.[0]).not.toHaveProperty('key');
  });
});
