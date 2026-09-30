/**
 * Keeps an anchored overlay inside the visible horizontal viewport, with an
 * optional available-height constraint for downward-opening panels and vertical
 * collision handling for popovers that can lift above their triggers.
 *
 * Width constraints alone are not enough: a 296px dropdown anchored to a
 * bell in the middle of a 320px header can still start far off-screen. Every
 * tooltip, dropdown, and popover whose position is tied to a trigger should
 * use this hook, consume `--viewport-overlay-shift-x` in its anchored position,
 * and combine `--viewport-overlay-available-width` with its existing width cap.
 *
 * The hook remeasures on resize, visual-viewport changes, scrolling, content
 * resize, and native <details> toggles. This covers rotation, browser zoom,
 * late-loading content, and dropdowns that remain mounted while closed.
 */

import {
  type RefCallback,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

export const VIEWPORT_OVERLAY_MARGIN = 8;
export const VIEWPORT_OVERLAY_SHIFT_PROPERTY = '--viewport-overlay-shift-x';
export const VIEWPORT_OVERLAY_WIDTH_PROPERTY = '--viewport-overlay-available-width';
export const VIEWPORT_OVERLAY_HEIGHT_PROPERTY = '--viewport-overlay-available-height';
export const VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY = '--viewport-overlay-shift-y';

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
  options?: { constrainHeight?: boolean; shiftVertically?: boolean; minimumTop?: number },
): RefObject<T | null> | (RefCallback<T> & { readonly current: T | null }) {
  const elementRef = useRef<T | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const constrainHeight = options?.constrainHeight ?? false;
  const shiftVertically = options?.shiftVertically ?? false;
  const minimumTop = options?.minimumTop ?? 0;

  const update = useCallback(() => {
    if (!active) return;
    const element = externalRef?.current ?? elementRef.current;
    if (!element) return;
    const details = element.closest('details');
    if (details && !details.open) return;

    // Dynamic viewport units retain the layout width during pinch zoom. Apply
    // the visual width before measuring so wrapping and collision use the same
    // geometry, and let the cap grow again when the user zooms out.
    const viewport = visibleViewport();
    element.style.setProperty(
      VIEWPORT_OVERLAY_WIDTH_PROPERTY,
      `${Math.max(0, viewport.width - 2 * VIEWPORT_OVERLAY_MARGIN)}px`,
    );
    let rect = element.getBoundingClientRect();
    if (rect.width === 0) return;
    if (constrainHeight || shiftVertically) {
      const visual = window.visualViewport;
      const viewportTop = visual?.offsetTop ?? 0;
      const bottom = viewportTop + (visual?.height ?? window.innerHeight);
      const top = Math.max(viewportTop, minimumTop);
      const height = Math.max(0, bottom - top);
      element.style.setProperty(
        VIEWPORT_OVERLAY_HEIGHT_PROPERTY,
        `${Math.max(0, shiftVertically ? height - 2 * VIEWPORT_OVERLAY_MARGIN : bottom - rect.top - VIEWPORT_OVERLAY_MARGIN)}px`,
      );
      rect = element.getBoundingClientRect();
      if (shiftVertically) {
        const current =
          Number.parseFloat(
            element.style.getPropertyValue(VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY),
          ) || 0;
        const next = horizontalViewportShift(
          { left: rect.top, right: rect.bottom },
          { left: top, width: height },
          current,
        );
        element.style.setProperty(VIEWPORT_OVERLAY_VERTICAL_SHIFT_PROPERTY, `${next}px`);
      }
    }
    const currentShift =
      Number.parseFloat(element.style.getPropertyValue(VIEWPORT_OVERLAY_SHIFT_PROPERTY)) || 0;
    const next = horizontalViewportShift(rect, viewport, currentShift);
    if (next === currentShift) return;

    // Apply synchronously. Updating React state here lets ResizeObserver fire
    // after the logical shift changes but before the DOM style does, which can
    // double the correction on an opening transition.
    element.style.setProperty(VIEWPORT_OVERLAY_SHIFT_PROPERTY, `${next}px`);
  }, [active, constrainHeight, shiftVertically, minimumTop, externalRef]);

  const release = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const attach = useCallback(
    (element: T | null) => {
      elementRef.current = element;
      release();
      if (!active || !element) return;

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

      cleanupRef.current = () => {
        window.removeEventListener('resize', update);
        window.removeEventListener('scroll', update, true);
        window.visualViewport?.removeEventListener('resize', update);
        window.visualViewport?.removeEventListener('scroll', update);
        details?.removeEventListener('toggle', onToggle);
        resizeObserver?.disconnect();
      };
    },
    [active, release, update],
  );

  const internalCallback = useCallback<RefCallback<T>>((element) => attach(element), [attach]);
  const internalRef = useMemo(() => {
    const ref = internalCallback as RefCallback<T> & { readonly current: T | null };
    Object.defineProperty(ref, 'current', {
      configurable: true,
      get: () => elementRef.current,
    });
    return ref;
  }, [internalCallback]);

  useLayoutEffect(() => {
    const element = externalRef?.current ?? elementRef.current;
    attach(element);
    return release;
  }, [attach, externalRef, release]);

  return externalRef ?? internalRef;
}
