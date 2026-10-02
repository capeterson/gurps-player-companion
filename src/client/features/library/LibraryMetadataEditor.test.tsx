import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';
import { SourcebooksContext } from './SourcebooksContext.tsx';

function Harness() {
  const [value, setValue] = useState<LibraryMetadata>({ sourceLocator: '1'.repeat(241) });
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

  it('opens and keeps an invalid page correction visible', async () => {
    render(<Harness />);

    const page = screen.getByRole('textbox', { name: /^Page$/ });
    const disclosure = screen.getByText('Source and completeness · complete');
    const details = disclosure.closest('details');
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('alert')).toHaveTextContent('Page');

    fireEvent.click(disclosure);

    await waitFor(() => expect(details).toHaveAttribute('open'));
    expect(page).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('preserves the existing definition identity while editing the page', () => {
    const onChange = vi.fn();
    render(
      <LibraryMetadataEditor
        value={{ key: 'existing-definition', sourceLocator: '42' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Source and completeness · complete'));
    expect(screen.queryByRole('textbox', { name: 'Canonical key' })).not.toBeInTheDocument();
    const page = screen.getByRole('textbox', { name: /^Page$/ });
    expect(page).toBeVisible();
    expect(page).toHaveValue('42');
    fireEvent.change(page, { target: { value: '43' } });
    expect(onChange).toHaveBeenCalledWith({ key: 'existing-definition', sourceLocator: '43' });
  });

  it('shows the sourcebook title and stores its UUID as the selected value', () => {
    const sourceId = '0193b3c0-f1f0-7000-8000-00000000c001';
    const source = {
      id: sourceId,
      campaignId: '0193b3c0-f1f0-7000-8000-00000000c002',
      name: 'GURPS Basic Set: Campaigns',
      abbreviation: 'BX',
      priority: 1,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const onChange = vi.fn();
    render(
      <SourcebooksContext.Provider value={[source]}>
        <LibraryMetadataEditor value={{}} onChange={onChange} />
      </SourcebooksContext.Provider>,
    );

    fireEvent.click(screen.getByText('Source and completeness · complete'));
    const picker = screen.getByRole('combobox', { name: 'Sourcebook' });
    expect(picker).toBeVisible();
    expect(screen.getByRole('option', { name: 'BX: GURPS Basic Set: Campaigns' })).toHaveValue(
      sourceId,
    );
    fireEvent.change(picker, { target: { value: sourceId } });
    expect(onChange).toHaveBeenCalledWith({ sourceId });
  });
});
