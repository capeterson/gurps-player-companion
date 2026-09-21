import { type ReactNode, useId, useState } from 'react';
import { AppIcon } from './AppIcon.tsx';

interface FoldSectionProps {
  preferenceKey: string;
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** Device-only presentation preference. Hidden content stays mounted to retain drafts. */
export function FoldSection({
  preferenceKey,
  title,
  summary,
  defaultOpen = true,
  children,
  className = '',
}: FoldSectionProps) {
  const storageKey = `gpc:fold:${preferenceKey}`;
  const readPreference = () => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored !== 'closed';
    } catch {
      return defaultOpen;
    }
  };
  const [preference, setPreference] = useState(() => ({ key: storageKey, open: readPreference() }));
  const open = preference.key === storageKey ? preference.open : readPreference();
  const id = useId();
  function toggle() {
    const next = !open;
    setPreference({ key: storageKey, open: next });
    try {
      localStorage.setItem(storageKey, next ? 'open' : 'closed');
    } catch {
      /* Storage can be unavailable; folding still works. */
    }
  }
  return (
    <section className={`card fold-section min-w-0 ${className}`}>
      <h2>
        <button
          type="button"
          className="fold-heading"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
        >
          <span aria-hidden="true" className="text-muted">
            <AppIcon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
          </span>
          <span className="label-eyebrow">{title}</span>
          {!open && summary && (
            <span className="ml-auto min-w-0 text-right text-xs text-muted font-normal">
              {summary}
            </span>
          )}
        </button>
      </h2>
      <div id={id} hidden={!open} className="fold-body">
        {children}
      </div>
    </section>
  );
}
