/**
 * Keeps an anchored overlay inside the visible horizontal viewport.
 *
 * Width constraints alone are not enough: a 296px dropdown anchored to a
 * bell in the middle of a 320px header can still start far off-screen. Every
 * tooltip, dropdown, and popover whose position is tied to a trigger should
 * use this hook and consume `--viewport-overlay-shift-x` in its anchored
 * position.
 *
 * The hook remeasures on resize, visual-viewport changes, scrolling, content
 * resize, and native <details> toggles. This covers rotation, browser zoom,
 * late-loading content, and dropdowns that remain mounted while closed.
 */

import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';

export const VIEWPORT_OVERLAY_MARGIN = 8;
export const VIEWPORT_OVERLAY_SHIFT_PROPERTY = '--viewport-overlay-shift-x';

interface HorizontalBounds {
  left: number;
  right: number;
}

interface ViewportBounds {
  left: number;
  width: number;
}

export function horizontalViewportShift(
  overlay: HorizontalBounds,
  viewport: ViewportBounds,
  currentShift = 0,
  margin = VIEWPORT_OVERLAY_MARGIN,
): number {
  const viewportLeft = viewport.left + margin;
  const viewportRight = viewport.left + viewport.width - margin;
  const naturalLeft = overlay.left - currentShift;
  const naturalRight = overlay.right - currentShift;
  const overlayWidth = naturalRight - naturalLeft;
  const availableWidth = Math.max(0, viewportRight - viewportLeft);

  // Content should also carry a viewport-relative max-width. If an
  // unbreakable child defeats that constraint, pin its left edge so the
  // beginning and controls remain reachable instead of oscillating between
  // two impossible edge corrections.
  if (overlayWidth > availableWidth) return viewportLeft - naturalLeft;
  if (naturalLeft < viewportLeft) return viewportLeft - naturalLeft;
  if (naturalRight > viewportRight) return viewportRight - naturalRight;
  return 0;
}

function visibleViewport(): ViewportBounds {
  const visual = window.visualViewport;
  return visual
    ? { left: visual.offsetLeft, width: visual.width }
    : { left: 0, width: window.innerWidth };
}

export function useViewportBoundedOverlay<T extends HTMLElement>(
  active = true,
  externalRef?: RefObject<T | null>,
): RefObject<T | null> {
  const internalRef = useRef<T>(null);
  const ref = externalRef ?? internalRef;

  const update = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const details = element.closest('details');
    if (details && !details.open) return;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;
    const currentShift =
      Number.parseFloat(element.style.getPropertyValue(VIEWPORT_OVERLAY_SHIFT_PROPERTY)) || 0;
    const next = horizontalViewportShift(rect, visibleViewport(), currentShift);
    if (next === currentShift) return;

    // Apply synchronously. Updating React state here lets ResizeObserver fire
    // after the logical shift changes but before the DOM style does, which can
    // double the correction on an opening transition.
    element.style.setProperty(VIEWPORT_OVERLAY_SHIFT_PROPERTY, `${next}px`);
  }, [ref]);

  useLayoutEffect(() => {
    if (!active) return;
    const element = ref.current;
    if (!element) return;
    const details = element.closest('details');
    const onToggle = () => update();

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    details?.addEventListener('toggle', onToggle);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
    resizeObserver?.observe(element);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      details?.removeEventListener('toggle', onToggle);
      resizeObserver?.disconnect();
    };
  }, [active, ref, update]);

  return ref;
}
