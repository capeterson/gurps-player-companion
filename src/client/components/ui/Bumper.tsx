/**
 * Big touch-target ±N button used in the combat tracker.
 *
 * Wraps the project's existing `.bumper` / `.bumper.dmg` CSS so the
 * spacing and colour rules stay in one place; the component layer
 * just adds typed props and an aria label.
 */

import type { ReactNode } from 'react';

interface BumperProps {
  children: ReactNode;
  onClick: () => void;
  tone: 'dmg' | 'heal';
  ariaLabel?: string;
  disabled?: boolean;
}

export function Bumper({ children, onClick, tone, ariaLabel, disabled }: BumperProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={tone === 'dmg' ? 'bumper dmg' : 'bumper'}
    >
      {children}
    </button>
  );
}
