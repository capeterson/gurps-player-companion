import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.ts';
import { connectionStore } from '../../lib/connectionState.ts';
import { QueryReadError } from './QueryReadError.tsx';

afterEach(() => {
  connectionStore.reset();
  vi.restoreAllMocks();
});

it('shows network read failures as neutral offline status with a retry action', async () => {
  const onRetry = vi.fn();
  render(
    <QueryReadError label="Campaigns" error={new TypeError('Failed to fetch')} onRetry={onRetry} />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Campaigns unavailable offline');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it('keeps HTTP read failures as actionable alerts', () => {
  render(
    <QueryReadError label="Campaigns" error={new ApiError(503, 'HTTP 503')} onRetry={() => {}} />,
  );

  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load Campaigns — HTTP 503");
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
