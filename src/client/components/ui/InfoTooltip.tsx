/**
 * Rich-content tooltip with viewport collision.
 *
 * DaisyUI's `.tooltip` only supports a single string via `data-tip`,
 * which can't render the multi-line "spent X / next Y / influences:
 * …" format we need on the sheet — so this is a hand-rolled popover
 * that takes ReactNode content and clamps to the viewport.
 *
 * The default trigger is a keyboard-focusable button with a dotted underline.
 * A custom trigger can reuse an existing editable input.
 */

import { type ReactNode, useEffect, useId, useLayoutEffect, useState } from 'react';
import { useAppHeaderBottom } from '../../hooks/useAppHeaderBottom.ts';
import { useViewportBoundedOverlay } from '../../hooks/useViewportBoundedOverlay.ts';

interface InfoTooltipProps {
  children?: ReactNode;
  /** An existing input can open the tooltip without adding a second control. */
  renderTrigger?: (descriptionId: string | undefined) => ReactNode;
  containerClassName?: string;
  content: ReactNode;
  side?: 'top' | 'bottom';
  ariaLabel?: string;
  triggerClassName?: string;
  onTriggerClick?: () => void;
  contentClassName?: string;
  /** Keep long lists reachable by pointer and keyboard inside the viewport. */
  scrollable?: boolean;
}

export function InfoTooltip({
  children,
  renderTrigger,
  containerClassName = '',
  content,
  side = 'top',
  ariaLabel,
  triggerClassName,
  onTriggerClick,
  contentClassName = 'w-64',
  scrollable = false,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipRef = useViewportBoundedOverlay<HTMLDivElement>(open);
  const headerBottom = useAppHeaderBottom();
  const id = useId();
  const Container = scrollable ? 'div' : 'span';
  const hasCustomTrigger = Boolean(renderTrigger);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !scrollable) return;
    const update = () => {
      const element = tooltipRef.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      // Page content sits below the sticky header's stacking context. Keeping
      // the list below it makes even the first recipient reachable.
      const top = Math.max(viewportTop, headerBottom) + 8;
      let bottom = viewportTop + (viewport?.height ?? window.innerHeight) - 8;
      if (hasCustomTrigger) {
        // The sheet's fixed navigation must not obscure linked contributors.
        // Measure the rendered controls instead of assuming a dock/FAB height.
        for (const navigation of document.querySelectorAll('.sheet-dock, .sheet-nav-toggle')) {
          const rect = navigation.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top > top) {
            bottom = Math.min(bottom, rect.top - 8);
          }
        }
        const trigger = element.parentElement?.getBoundingClientRect();
        if (trigger) {
          const above = Math.max(0, Math.min(trigger.top, bottom) - top - 8);
          const below = Math.max(0, bottom - Math.max(trigger.bottom, top) - 8);
          const upward = above > below;
          // Keep the edited value visible. Long explanations scroll on the
          // clearer side of the input instead of expanding across it.
          element.style.top = upward ? 'auto' : '100%';
          element.style.bottom = upward ? '100%' : 'auto';
          element.style.marginTop = upward ? '0' : '8px';
          element.style.marginBottom = upward ? '8px' : '0';
          element.style.maxHeight = `${upward ? above : below}px`;
        }
      } else {
        element.style.maxHeight = `${Math.max(0, bottom - top)}px`;
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
    if (tooltipRef.current) {
      observer?.observe(tooltipRef.current);
      if (hasCustomTrigger && tooltipRef.current.parentElement) {
        observer?.observe(tooltipRef.current.parentElement);
      }
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [open, scrollable, tooltipRef, headerBottom, hasCustomTrigger]);

  const positionClass =
    side === 'top' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top';

  return (
    <Container
      className={`relative inline-flex items-baseline ${containerClassName}`}
      onMouseEnter={renderTrigger ? () => setOpen(true) : undefined}
      onFocus={renderTrigger ? () => setOpen(true) : undefined}
      onMouseLeave={
        scrollable
          ? (event) => {
              if (renderTrigger && event.currentTarget.contains(document.activeElement)) return;
              setOpen(false);
            }
          : undefined
      }
      onBlur={
        scrollable
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }
          : undefined
      }
    >
      {renderTrigger ? (
        renderTrigger(open ? id : undefined)
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          aria-describedby={open ? id : undefined}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={scrollable ? undefined : () => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={scrollable ? undefined : () => setOpen(false)}
          onClick={() => {
            if (onTriggerClick) {
              setOpen(false);
              onTriggerClick();
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
      )}
      {open && (
        <Container
          ref={tooltipRef}
          id={id}
          role="tooltip"
          tabIndex={scrollable ? 0 : undefined}
          style={{
            transform:
              'translate(calc(-50% + var(--viewport-overlay-shift-x, 0px)), var(--tooltip-shift-y, 0px))',
          }}
          className={`absolute left-1/2 z-50 ${scrollable ? (side === 'top' ? 'bottom-full' : 'top-full') : positionClass} ${contentClassName} max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))] [overflow-wrap:anywhere] rounded-lg border border-base-300 bg-base-100 p-3 text-xs text-base-content shadow-lg ${scrollable ? 'overflow-y-auto' : 'pointer-events-none'}`}
        >
          {content}
        </Container>
      )}
    </Container>
  );
}
