import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveEffectForm } from './ActiveEffectForm.tsx';

describe('ActiveEffectForm stacking key', () => {
  it('requires a visible stacking key and saves after the player repairs it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ActiveEffectForm campaignId="campaign-1" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Effect name' }), {
      target: { value: 'Fleetness' },
    });
    const key = screen.getByRole('textbox', { name: 'Stacking key' });

    fireEvent.click(screen.getByRole('button', { name: 'Save effect' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/stacking key/i);
    expect(key).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(key, { target: { value: 'quickness' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save effect' }));

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
