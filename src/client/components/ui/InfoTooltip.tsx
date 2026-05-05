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

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

const TOOLTIP_WIDTH = 256;
const VIEWPORT_MARGIN = 8;

interface InfoTooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'bottom';
}

export function InfoTooltip({ children, content, side = 'top' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const left = center - TOOLTIP_WIDTH / 2;
    const right = center + TOOLTIP_WIDTH / 2;
    if (left < VIEWPORT_MARGIN) {
      setShiftX(VIEWPORT_MARGIN - left);
    } else if (right > window.innerWidth - VIEWPORT_MARGIN) {
      setShiftX(window.innerWidth - VIEWPORT_MARGIN - right);
    } else {
      setShiftX(0);
    }
  }, [open]);

  const positionClass =
    side === 'top' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top';

  return (
    <span className="relative inline-flex items-baseline">
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="cursor-help rounded-sm border-b border-dotted border-base-content/30 px-1 -mx-1 hover:bg-accent-soft hover:text-base-content hover:border-base-content/60 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
      >
        {children}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
          className={`absolute z-50 left-1/2 ${positionClass} w-64 rounded-lg border border-base-300 bg-base-100 p-3 text-xs text-base-content shadow-lg pointer-events-none`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
