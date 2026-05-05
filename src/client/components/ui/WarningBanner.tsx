/**
 * Inline soft banner used for GURPS rule warnings on the sheet.
 *
 * Severity choice maps to DaisyUI semantic colours so an "info"
 * code can never accidentally render with warning yellow.
 */

import type { ReactNode } from 'react';

interface WarningBannerProps {
  severity: 'info' | 'warn';
  title: string;
  children: ReactNode;
  onDismiss?: (() => void) | undefined;
  trailing?: ReactNode | undefined;
}

export function WarningBanner({
  severity,
  title,
  children,
  onDismiss,
  trailing,
}: WarningBannerProps) {
  const accent = severity === 'warn' ? 'border-l-warning text-warning' : 'border-l-info text-info';
  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: the native <output> element is for
      // form-result values; this is an inline status banner with prose content, where
      // role="status" is the matching ARIA pattern.
      role="status"
      className={`card bg-base-100 border border-base-300/60 border-l-[3px] ${accent} shadow-sm rounded-2xl`}
    >
      <div className="card-body py-3 px-4 flex flex-row items-center gap-3 flex-wrap">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{
            background: severity === 'warn' ? 'var(--color-warning)' : 'var(--color-info)',
          }}
        />
        <span className="text-sm">
          <span className="font-semibold mr-2">{title}</span>
          <span className="text-base-content">{children}</span>
        </span>
        <span className="grow" />
        {trailing}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="btn btn-ghost btn-xs text-muted">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
