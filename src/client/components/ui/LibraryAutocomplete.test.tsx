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

import { fireEvent, render, screen } from '@testing-library/react';
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
});
