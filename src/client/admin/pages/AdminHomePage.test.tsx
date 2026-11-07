import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { AdminHomePage } from './AdminHomePage.tsx';

it('lists each admin area with a link and description', () => {
  render(
    <MemoryRouter>
      <AdminHomePage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Admin' })).toBeVisible();
  expect(screen.getByRole('link', { name: /Users/ })).toHaveAttribute('href', '/admin/users');
  expect(screen.getByRole('link', { name: /Campaigns/ })).toHaveAttribute(
    'href',
    '/admin/campaigns',
  );
  expect(screen.getByRole('link', { name: /Images/ })).toHaveAttribute('href', '/admin/media');
});
