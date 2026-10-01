import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY,
  horizontalViewportShift,
  useViewportBoundedOverlay,
} from './useViewportBoundedOverlay.ts';

function LateOverlay({ mounted }: { mounted: boolean }) {
  const ref = useViewportBoundedOverlay<HTMLUListElement>(true, undefined, {
    constrainHeight: true,
  });
  return mounted ? (
    <details open>
      <summary>Open options</summary>
      <ul ref={ref} aria-label="Late overlay">
        <li>Settings</li>
      </ul>
    </details>
  ) : null;
}

function VerticalOverlay() {
  const ref = useViewportBoundedOverlay<HTMLDivElement>(true, undefined, {
    shiftVertically: true,
  });
  return <div ref={ref} role="dialog" aria-label="Vertical overlay" />;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

describe('useViewportBoundedOverlay', () => {
  it('clamps height and repositions a popover when the visual viewport shrinks or moves', () => {
    const visual = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      width: 320,
      height: 300,
    });
    vi.stubGlobal('visualViewport', visual);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const shift =
        Number.parseFloat(this.style.getPropertyValue(VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY)) ||
        0;
      return {
        left: 40,
        top: 50 + shift,
        right: 240,
        bottom: 150 + shift,
        width: 200,
        height: 100,
        x: 40,
        y: 50 + shift,
        toJSON: () => ({}),
      };
    });

    const overlay = render(<VerticalOverlay />).getByRole('dialog', { name: 'Vertical overlay' });
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-height')).toBe('284px');
    expect(overlay.style.getPropertyValue(VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY)).toBe('0px');

    visual.offsetTop = 90;
    visual.height = 120;
    visual.dispatchEvent(new Event('resize'));
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-height')).toBe('104px');
    expect(overlay.style.getPropertyValue(VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY)).toBe('48px');
  });

  it('tracks visual viewport resize and scroll offsets, then releases listeners', () => {
    const visual = Object.assign(new EventTarget(), {
      offsetLeft: 30,
      offsetTop: 10,
      width: 160,
      height: 300,
    });
    vi.stubGlobal('visualViewport', visual);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const shift =
        Number.parseFloat(this.style.getPropertyValue('--viewport-overlay-shift-x')) || 0;
      return {
        left: shift,
        top: 50,
        right: 100 + shift,
        bottom: 150,
        width: 100,
        height: 100,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      };
    });
    const { unmount } = render(<LateOverlay mounted />);
    const overlay = screen.getByRole('list', { name: 'Late overlay' });
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-width')).toBe('144px');
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-height')).toBe('252px');
    expect(overlay.style.getPropertyValue('--viewport-overlay-shift-x')).toBe('38px');
    visual.width = 320;
    visual.dispatchEvent(new Event('resize'));
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-width')).toBe('304px');
    visual.offsetTop = 40;
    visual.dispatchEvent(new Event('scroll'));
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-height')).toBe('282px');
    const measure = vi.spyOn(overlay, 'getBoundingClientRect');
    unmount();
    const count = measure.mock.calls.length;
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    expect(measure).toHaveBeenCalledTimes(count);
    vi.unstubAllGlobals();
  });
  it('measures a ref that mounts after the hook and releases its listeners', () => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const { rerender, unmount } = render(
      <StrictMode>
        <LateOverlay mounted={false} />
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <LateOverlay mounted />
      </StrictMode>,
    );
    const overlay = screen.getByRole('list', { name: 'Late overlay' });
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-height')).toBe('760px');

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    window.dispatchEvent(new Event('resize'));
    expect(overlay.style.getPropertyValue('--viewport-overlay-available-height')).toBe('392px');

    const measure = vi.spyOn(overlay, 'getBoundingClientRect');
    unmount();
    const measuredBeforeResize = measure.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    expect(measure).toHaveBeenCalledTimes(measuredBeforeResize);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  });
});
