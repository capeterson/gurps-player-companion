import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FoldSection } from './FoldSection.tsx';

beforeEach(() => localStorage.clear());

it('keeps drafts mounted while folded and restores the preference after remount', () => {
  const content = (
    <FoldSection preferenceKey="hero:notes" title="Notes">
      <input aria-label="Draft" defaultValue="" />
    </FoldSection>
  );
  const view = render(content);
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsaved thought' } });
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved thought');
  expect(screen.getByLabelText('Draft')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  expect(screen.getByLabelText('Draft')).toBeVisible();
  expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved thought');
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  view.unmount();
  render(content);
  expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'false');
});

it('isolates preferences and preserves mounted content when the view preference changes', () => {
  const renderSection = (key: string) => (
    <FoldSection preferenceKey={key} title="Overview" defaultOpen={false}>
      <input aria-label="Draft" />
    </FoldSection>
  );
  const view = render(renderSection('hero:combat'));
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep me' } });
  view.rerender(renderSection('hero:sheet'));
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.getByLabelText('Draft')).toHaveValue('Keep me');
  view.rerender(renderSection('hero:combat'));
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-expanded', 'true');
});

it('still folds if browser storage is unavailable', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  render(
    <FoldSection preferenceKey="blocked" title="Armor">
      Protection
    </FoldSection>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Armor' }));
  expect(screen.getByText('Protection')).not.toBeVisible();
  read.mockRestore();
  write.mockRestore();
});
