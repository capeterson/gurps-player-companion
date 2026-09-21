import { describe, expect, it } from 'vitest';
import { horizontalViewportShift } from './useViewportBoundedOverlay.ts';

describe('horizontalViewportShift', () => {
  const viewport = { left: 0, width: 320 };

  it('leaves an overlay that already fits unchanged', () => {
    expect(horizontalViewportShift({ left: 32, right: 288 }, viewport)).toBe(0);
  });

  it('moves a centered left-edge tooltip fully into view', () => {
    expect(horizontalViewportShift({ left: -58, right: 198 }, viewport)).toBe(66);
  });

  it('moves a right-edge tooltip fully into view', () => {
    expect(horizontalViewportShift({ left: 164, right: 340 }, viewport)).toBe(-28);
  });

  it('recalculates from the natural position rather than compounding an old shift', () => {
    expect(horizontalViewportShift({ left: 8, right: 264 }, viewport, 66)).toBe(66);
  });

  it('uses visual viewport offsets and pins an oversized overlay to its readable edge', () => {
    expect(horizontalViewportShift({ left: -20, right: 340 }, { left: 50, width: 320 }, 0)).toBe(
      78,
    );
  });
});
