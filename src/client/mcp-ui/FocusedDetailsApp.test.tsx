import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  bladeId,
  bladeName,
  mcpInventoryItem,
  mcpLibrarySkill,
} from '../../../tests/fixtures/mcp-character.ts';
import type { FocusedDetail } from '../../shared/schemas/details.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { FocusedDetailsApp } from './FocusedDetailsApp.tsx';

function show(data: FocusedDetail) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <FocusedDetailsApp data={data} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('focused MCP cards', () => {
  it('renders one item stat block without sheet navigation or unrelated inventory', async () => {
    show(mcpInventoryItem(bladeId));
    expect(screen.getByRole('heading', { name: bladeName })).toBeVisible();
    expect(await screen.findByText('balanced', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText(/Damage sw\+1 cut/)).toBeVisible();
    expect(screen.queryByText('Travelling pack')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contents' })).toBeNull();
  });

  it('shows a container’s contents with the shared read-only item disclosure', async () => {
    show(mcpInventoryItem());
    expect(screen.getByRole('heading', { name: 'Travelling pack' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Contents' })).toBeVisible();
    expect(screen.getByText(bladeName)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `View ${bladeName}` }));
    expect(await screen.findByText('balanced', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByRole('button', { name: `Edit ${bladeName}` })).toBeNull();
  });

  it('distinguishes an empty container from a leaf item', () => {
    const data = mcpInventoryItem();
    show({ ...data, contents: [] });
    expect(screen.getByText('Empty container.')).toBeVisible();
  });

  it('renders the campaign definition with the shared description, source, and effects', async () => {
    show(mcpLibrarySkill());
    expect(screen.getByText('Campaign library skill')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Broadsword' })).toBeVisible();
    expect(screen.getByText('DX/A')).toBeVisible();
    expect(await screen.findByText('balanced sword', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('Source · Synthetic Core p. 12')).toBeVisible();
    expect(screen.getByText('Prerequisites · A suitable weapon.')).toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
