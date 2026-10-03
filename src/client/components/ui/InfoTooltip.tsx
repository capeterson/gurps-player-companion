/**
 * Rich-content tooltip with viewport collision.
 *
 * DaisyUI's `.tooltip` only supports a single string via `data-tip`,
 * which can't render the multi-line "spent X / next Y / influences:
 * …" format we need on the sheet — so this is a hand-rolled popover
 * that takes ReactNode content and clamps to the viewport.
 *
 * The trigger renders as a button with a dotted underline (the
 * "more info available" affordance) and is keyboard-focusable.
 */

import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAppHeaderBottom } from '../../hooks/useAppHeaderBottom.ts';
import {
  VIEWPORT_OVERLAY_SHIFT_PROPERTY,
  horizontalViewportShift,
  useViewportBoundedOverlay,
} from '../../hooks/useViewportBoundedOverlay.ts';

interface InfoTooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'bottom';
  ariaLabel?: string;
  triggerClassName?: string;
  onTriggerClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  ariaExpanded?: boolean | undefined;
  ariaControls?: string | undefined;
  contentClassName?: string;
  /** Keep long lists reachable by pointer and keyboard inside the viewport. */
  scrollable?: boolean;
  /** Escape clipping ancestors such as inventory tables. */
  portal?: boolean;
}

export function InfoTooltip({
  children,
  content,
  side = 'top',
  ariaLabel,
  triggerClassName,
  onTriggerClick,
  ariaExpanded,
  ariaControls,
  contentClassName = 'w-64',
  scrollable = false,
  portal = false,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useViewportBoundedOverlay<HTMLDivElement>(open);
  const headerBottom = useAppHeaderBottom();
  const id = useId();
  const Container = scrollable ? 'div' : 'span';

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (portal && tooltipRef.current?.contains(document.activeElement))
          triggerRef.current?.focus();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [open, portal, tooltipRef]);

  useLayoutEffect(() => {
    if (!open || (!scrollable && !portal)) return;
    const update = () => {
      const element = tooltipRef.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      // Page content sits below the sticky header's stacking context. Keeping
      // the list below it makes even the first recipient reachable.
      const top = Math.max(viewportTop, headerBottom) + 8;
      const bottom = viewportTop + (viewport?.height ?? window.innerHeight) - 8;
      element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      if (portal) {
        const anchor = triggerRef.current?.getBoundingClientRect();
        if (!anchor) return;
        element.style.left = `${anchor.left + anchor.width / 2}px`;
        element.style.top = `${side === 'top' ? anchor.top - element.offsetHeight : anchor.bottom}px`;
        const currentX =
          Number.parseFloat(element.style.getPropertyValue(VIEWPORT_OVERLAY_SHIFT_PROPERTY)) || 0;
        element.style.setProperty(
          VIEWPORT_OVERLAY_SHIFT_PROPERTY,
          `${horizontalViewportShift(element.getBoundingClientRect(), { left: viewport?.offsetLeft ?? 0, width: viewport?.width ?? window.innerWidth }, currentX)}px`,
        );
      }
      const currentShift =
        Number.parseFloat(element.style.getPropertyValue('--tooltip-shift-y')) || 0;
      const rect = element.getBoundingClientRect();
      const naturalTop = rect.top - currentShift;
      const shift = Math.max(top - naturalTop, Math.min(0, bottom - (rect.bottom - currentShift)));
      element.style.setProperty('--tooltip-shift-y', `${shift}px`);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (tooltipRef.current) observer?.observe(tooltipRef.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [open, scrollable, portal, side, tooltipRef, headerBottom]);

  const positionClass =
    side === 'top' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top';

  const tooltip = open && (
    <Container
      ref={tooltipRef}
      id={id}
      role="tooltip"
      tabIndex={scrollable ? 0 : undefined}
      onClick={portal ? (event) => event.stopPropagation() : undefined}
      onMouseLeave={
        portal && scrollable
          ? (event) => {
              if (
                !(
                  event.relatedTarget instanceof Node &&
                  triggerRef.current?.contains(event.relatedTarget)
                )
              )
                setOpen(false);
            }
          : undefined
      }
      style={{
        transform:
          'translate(calc(-50% + var(--viewport-overlay-shift-x, 0px)), var(--tooltip-shift-y, 0px))',
      }}
      className={`${portal ? 'fixed z-[100]' : `absolute left-1/2 z-50 ${scrollable ? (side === 'top' ? 'bottom-full' : 'top-full') : positionClass}`} ${contentClassName} max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))] [overflow-wrap:anywhere] rounded-lg border border-base-300 bg-base-100 p-3 text-xs text-base-content shadow-lg ${scrollable ? 'overflow-y-auto' : 'pointer-events-none'}`}
    >
      {content}
    </Container>
  );

  return (
    <Container
      className="relative inline-flex items-baseline"
      onMouseLeave={
        scrollable
          ? (event) => {
              if (
                !(
                  event.relatedTarget instanceof Node &&
                  (event.currentTarget.contains(event.relatedTarget) ||
                    tooltipRef.current?.contains(event.relatedTarget))
                )
              )
                setOpen(false);
            }
          : undefined
      }
      onBlur={
        scrollable
          ? (event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !tooltipRef.current?.contains(event.relatedTarget)
              )
                setOpen(false);
            }
          : undefined
      }
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={scrollable ? undefined : () => setOpen(false)}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (portal && scrollable && open && event.key === 'ArrowDown') {
            event.preventDefault();
            tooltipRef.current?.focus();
          }
        }}
        onBlur={scrollable ? undefined : () => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          if (onTriggerClick) {
            setOpen(false);
            onTriggerClick(event);
          } else {
            // Focus/hover may already have opened a scrollable tooltip before
            // the click arrives. A tap must leave its recipient list open.
            setOpen((value) => scrollable || !value);
          }
        }}
        className={
          triggerClassName ??
          'cursor-help rounded-sm border-b border-dotted border-base-content/30 px-1 -mx-1 hover:bg-accent-soft hover:text-base-content hover:border-base-content/60 transition-colors focus-visible:outline-2 focus-visible:outline-primary'
        }
      >
        {children}
      </button>
      {tooltip && (portal ? createPortal(tooltip, document.body) : tooltip)}
    </Container>
  );
}
