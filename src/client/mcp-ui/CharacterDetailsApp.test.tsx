import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  bladeName,
  mcpCharacter,
  mcpMinimalCharacter,
} from '../../../tests/fixtures/mcp-character.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { CharacterDetailsApp } from './CharacterDetailsApp.tsx';

function show(data = mcpCharacter()) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CharacterDetailsApp data={data} error={null} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('embedded character details', () => {
  it('renders authoritative effective stats and the existing read-only skill details', async () => {
    show();
    expect(screen.getByRole('heading', { name: 'MCP Test Hero' })).toBeVisible();
    const strength = screen.getByText('ST', { exact: true }).parentElement;
    if (!strength) throw new Error('Missing ST display');
    expect(within(strength).getByText('15')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(screen.queryByRole('heading', { name: /^Attributes$/ })).toBeNull();
    expect(screen.getByText('Broadsword')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View Broadsword' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View Broadsword' }));
    expect(await screen.findByText('blade', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '+ Add skill' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Broadsword name' })).toBeNull();
  });

  it('reuses nested inventory rows and opens read-only item details', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand contents' }));
    expect(screen.getByText(bladeName)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `View ${bladeName}` }));
    expect(await screen.findByText('balanced', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText(/Damage sw\+1 cut/)).toBeVisible();
    expect(screen.queryByRole('button', { name: `Edit ${bladeName}` })).toBeNull();
  });

  it('minimal views expose only public identity and replace full details', async () => {
    const view = show();
    view.rerender(
      <MemoryRouter>
        <ToastProvider>
          <CharacterDetailsApp data={mcpMinimalCharacter()} error={null} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Limited view/)).toBeVisible();
    expect(await screen.findByText('Public description')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull();
    expect(screen.queryByText('ST')).toBeNull();
    expect(screen.queryByText('Broadsword')).toBeNull();
  });

  it('failure clears the character and offers an explicit refresh', () => {
    const view = show();
    view.rerender(
      <CharacterDetailsApp data={null} error="Access denied" refresh={() => undefined} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(screen.queryByText('MCP Test Hero')).toBeNull();
  });
});
