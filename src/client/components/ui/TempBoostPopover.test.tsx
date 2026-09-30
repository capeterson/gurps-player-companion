/**
 * TempBoostPopover — responsive safety.
 *
 * On a short phone viewport the popover must never grow taller than the
 * screen: it is clamped to the dynamic viewport height and scrolls its
 * own content so the Clear/Apply actions stay reachable.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TempBoostPopover } from './TempBoostPopover.tsx';

describe('TempBoostPopover', () => {
  it('keeps viewport bounds and exposes usable modifier controls', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <TempBoostPopover label="ST" baseValue={10} temp={{ value: 0, onApply }} onClose={onClose} />,
    );

    const popover = screen.getByRole('dialog', { name: 'Modifiers for ST' });
    expect(popover).toBeVisible();
    expect(popover.className).toMatch(/max-h-\[calc\(100dvh-/);
    expect(popover.className).toMatch(/max-w-\[min\(calc\(100dvw-/);
    expect(popover.className).toMatch(/overflow-y-auto/);
    expect(popover.className).not.toContain('100vh');
    expect(popover.getAttribute('style')).toContain('100dvh');

    const delta = screen.getByRole('textbox', { name: 'Temporary ST delta' });
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(delta).toBeVisible();
    expect(apply).toBeVisible();
    fireEvent.change(delta, { target: { value: '2' } });
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
