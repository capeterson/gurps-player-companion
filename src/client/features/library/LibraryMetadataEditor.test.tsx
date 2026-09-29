import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { LibraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';

function Harness() {
  const [value, setValue] = useState<LibraryMetadata>({ key: '   ' });
  return <LibraryMetadataEditor value={value} onChange={setValue} />;
}

describe('LibraryMetadataEditor validation', () => {
  it('labels and toggles the GM-only restriction', () => {
    render(<Harness />);
    const restricted = screen.getByRole('checkbox', { name: 'Restricted (GM only)' });
    expect(restricted).not.toBeChecked();
    fireEvent.click(restricted);
    expect(restricted).toBeChecked();
  });

  it('opens and keeps the canonical-key correction visible for whitespace-only keys', async () => {
    render(<Harness />);

    const key = screen.getByRole('textbox', { name: 'Canonical key' });
    const disclosure = screen.getByText('Source and completeness · complete');
    const details = disclosure.closest('details');
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('alert')).toHaveTextContent('Canonical key');

    fireEvent.click(disclosure);

    await waitFor(() => expect(details).toHaveAttribute('open'));
    expect(key).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
  });
});
