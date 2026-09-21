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

import { type ReactNode, useId, useState } from 'react';
import { useViewportBoundedOverlay } from '../../hooks/useViewportBoundedOverlay.ts';

interface InfoTooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'bottom';
  ariaLabel?: string;
  triggerClassName?: string;
  onTriggerClick?: () => void;
  contentClassName?: string;
}

export function InfoTooltip({
  children,
  content,
  side = 'top',
  ariaLabel,
  triggerClassName,
  onTriggerClick,
  contentClassName = 'w-64',
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipRef = useViewportBoundedOverlay<HTMLSpanElement>(open);
  const id = useId();

  const positionClass =
    side === 'top' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top';

  return (
    <span className="relative inline-flex items-baseline">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (onTriggerClick) {
            setOpen(false);
            onTriggerClick();
          } else {
            setOpen((value) => !value);
          }
        }}
        className={
          triggerClassName ??
          'cursor-help rounded-sm border-b border-dotted border-base-content/30 px-1 -mx-1 hover:bg-accent-soft hover:text-base-content hover:border-base-content/60 transition-colors focus-visible:outline-2 focus-visible:outline-primary'
        }
      >
        {children}
      </button>
      {open && (
        <span
          ref={tooltipRef}
          id={id}
          role="tooltip"
          style={{
            transform: 'translateX(calc(-50% + var(--viewport-overlay-shift-x, 0px)))',
          }}
          className={`absolute left-1/2 z-50 ${positionClass} ${contentClassName} max-w-[calc(100dvw-1rem)] [overflow-wrap:anywhere] rounded-lg border border-base-300 bg-base-100 p-3 text-xs text-base-content shadow-lg pointer-events-none`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
