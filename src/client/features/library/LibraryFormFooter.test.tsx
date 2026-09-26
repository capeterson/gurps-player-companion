import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryFormFooter } from './LibraryFormFooter.tsx';

function renderFooter(overrides: Partial<Parameters<typeof LibraryFormFooter>[0]> = {}) {
  const props = {
    noun: 'trait',
    editing: false,
    isPending: false,
    canSubmit: true,
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<LibraryFormFooter {...props} />);
  return props;
}

describe('LibraryFormFooter', () => {
  it('names the entry kind when adding and submits', () => {
    const props = renderFooter();
    fireEvent.click(screen.getByRole('button', { name: 'Add trait' }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it('offers to save changes when editing', () => {
    renderFooter({ editing: true });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('keeps an invalid draft from being submitted', () => {
    renderFooter({ canSubmit: false });
    expect(screen.getByRole('button', { name: 'Add trait' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('locks both actions while saving', () => {
    renderFooter({ isPending: true });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('shows the save error', () => {
    renderFooter({ error: 'Name already exists' });
    expect(screen.getByText('Name already exists')).toBeVisible();
  });
});
