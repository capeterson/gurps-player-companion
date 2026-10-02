import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveEffectForm } from './ActiveEffectForm.tsx';

describe('ActiveEffectForm shared definition editor', () => {
  it('keeps an invalid stacking key visible and saves after the player repairs it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ActiveEffectForm campaignId="campaign-1" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Raw YAML'), {
      target: { value: 'name: Fleetness\nstacking:\n  kind: additive\n  key: ""' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add active effect' }));

    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByLabelText('Raw YAML')).toHaveValue(
      'name: Fleetness\nstacking:\n  kind: additive\n  key: ""',
    );
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Raw YAML'), {
      target: { value: 'name: Fleetness\nstacking:\n  kind: additive\n  key: quickness' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add active effect' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Fleetness',
          stacking: { kind: 'additive', key: 'quickness' },
        }),
      ),
    );
  });
});
