/**
 * TempBoostPopover — responsive safety.
 *
 * On a short phone viewport the popover must never grow taller than the
 * screen: it is clamped to the dynamic viewport height and scrolls its
 * own content so the Clear/Apply actions stay reachable.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TempBoostPopover } from './TempBoostPopover.tsx';

describe('TempBoostPopover', () => {
  it('is clamped to the dynamic viewport and scrolls its own content', () => {
    render(
      <TempBoostPopover
        label="ST"
        baseValue={10}
        temp={{ value: 0, onApply: () => {} }}
        onClose={() => {}}
      />,
    );

    const popover = screen.getByRole('dialog', { name: 'Modifiers for ST' });
    expect(popover.className).toMatch(/max-h-\[calc\(100dvh-/);
    expect(popover.className).toMatch(/overflow-y-auto/);
    expect(popover.className).not.toContain('100vh');
  });
});
