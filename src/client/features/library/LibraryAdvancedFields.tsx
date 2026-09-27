import { type ReactNode, useEffect, useState } from 'react';

/** Keep optional form drafts mounted when collapsed, and reveal invalid fields. */
export function LibraryAdvancedFields({
  title,
  children,
  defaultOpen = false,
  error,
  hint,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  error?: string | null;
  hint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (error && !open) setOpen(true);
  }, [error, open]);
  return (
    <details
      className="collapse collapse-arrow min-w-0 rounded-box border border-base-300"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="collapse-title min-h-0 py-3 text-sm font-medium">{title}</summary>
      <div className="collapse-content min-w-0 space-y-3">
        {hint && <p className="text-sm text-base-content/70">{hint}</p>}
        {children}
      </div>
    </details>
  );
}
