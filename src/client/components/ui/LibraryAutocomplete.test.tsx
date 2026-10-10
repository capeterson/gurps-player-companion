/**
 * Pinning the contract: picking an option calls `onPick` ONLY.
 *
 * This was the regression Codex flagged on PR #22: the original
 * implementation also called `onChange(getOptionLabel(opt))`, which ran
 * in the same React event as the parent's typical "user typed → clear
 * pickedLibraryId" handler. The clear won, every create lost its
 * library FK, and the trait modifier picker disappeared the moment
 * the user picked a library trait.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryAutocomplete } from './LibraryAutocomplete.tsx';

interface FakeOpt {
  id: string;
  name: string;
}

function Harness({
  onPickSpy,
  onChangeSpy,
}: {
  onPickSpy: (opt: FakeOpt) => void;
  onChangeSpy: (v: string) => void;
}) {
  const [value, setValue] = useState('');
  const fetchOptions = async () => [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];
  return (
    <LibraryAutocomplete<FakeOpt>
      value={value}
      onChange={(v) => {
        onChangeSpy(v);
        setValue(v);
      }}
      onPick={onPickSpy}
      fetchOptions={fetchOptions}
      getOptionKey={(o) => o.id}
      renderOption={(o) => o.name}
      debounceMs={0}
      minChars={1}
      placeholder="search"
    />
  );
}

describe('LibraryAutocomplete', () => {
  it('shows the option label without appending a raw source key and preserves its source when picked', async () => {
    const option = { id: 'a', name: 'Alpha', sourceKey: 'technical-source-key' };
    const onPick = vi.fn();
    render(
      <LibraryAutocomplete
        value="Alpha"
        onChange={vi.fn()}
        onPick={onPick}
        fetchOptions={async () => [option]}
        getOptionKey={(entry) => entry.id}
        renderOption={(entry) => entry.name}
        debounceMs={0}
      />,
    );
    const choice = await screen.findByRole('option', { name: 'Alpha' });
    expect(choice).toBeVisible();
    expect(screen.queryByText('technical-source-key')).not.toBeInTheDocument();
    fireEvent.mouseDown(choice);
    expect(onPick).toHaveBeenCalledWith(option);
  });

  it('fires onPick (only) when the user clicks an option — does not echo onChange', async () => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    render(<Harness onPickSpy={onPick} onChangeSpy={onChange} />);

    // Type to trigger the debounced fetch + dropdown open.
    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'a' } });
    // The 'a' keystroke fires onChange once. Reset that baseline so we
    // only measure what `pick` does.
    expect(onChange).toHaveBeenCalledWith('a');
    onChange.mockClear();

    // Wait for the dropdown — fetchOptions is debounced/awaited inside
    // a useEffect, so we await microtasks until the option lands.
    await screen.findByText('Alpha');

    // mousedown is the activation event the autocomplete uses (so the
    // input doesn't lose focus mid-pick).
    fireEvent.mouseDown(screen.getByText('Alpha'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ id: 'a', name: 'Alpha' });
    // CRITICAL: onChange must NOT have fired from the pick. If it
    // did, callers' clear-on-edit handlers would wipe the library FK
    // they just captured in their own onPick.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('portals options into the containing sheet dialog and keeps them clickable', async () => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    render(
      <dialog open aria-label="Character sheet">
        <Harness onPickSpy={onPick} onChangeSpy={onChange} />
      </dialog>,
    );

    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'a' } });
    const dialog = screen.getByRole('dialog', { name: 'Character sheet' });
    const listbox = await within(dialog).findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Alpha' })).toBeVisible();

    fireEvent.mouseDown(within(listbox).getByRole('option', { name: 'Alpha' }));

    expect(onPick).toHaveBeenCalledWith({ id: 'a', name: 'Alpha' });
    expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the portaled list when the user clicks outside the sheet control', async () => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    render(
      <dialog open aria-label="Character sheet">
        <Harness onPickSpy={onPick} onChangeSpy={onChange} />
      </dialog>,
    );

    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'a' } });
    const dialog = screen.getByRole('dialog', { name: 'Character sheet' });
    await within(dialog).findByRole('listbox');

    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument());
    expect(onPick).not.toHaveBeenCalled();
  });

  it('lets Escape dismiss open suggestions without cancelling an enclosing modal', async () => {
    render(
      <dialog open aria-label="Add item">
        <Harness onPickSpy={vi.fn()} onChangeSpy={vi.fn()} />
      </dialog>,
    );
    const input = screen.getByPlaceholderText('search');
    fireEvent.change(input, { target: { value: 'a' } });
    const dialog = screen.getByRole('dialog', { name: 'Add item' });
    await within(dialog).findByRole('listbox');

    // fireEvent returns false when the handler prevented the default action.
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    await waitFor(() => expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument());
    // With no suggestions open, Escape keeps its normal dialog behavior.
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
  });
});
