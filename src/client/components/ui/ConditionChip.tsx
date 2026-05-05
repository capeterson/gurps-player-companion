/**
 * Toggleable chip for postures, conditions, and other on/off filters.
 *
 * Wraps the project's existing `.chip` / `.chip.on` CSS so the visual
 * baseline stays consistent; the component layer adds `aria-pressed`
 * (so assistive tech announces it as a toggle, not a plain button)
 * and the small primary-coloured dot when active.
 */

interface ConditionChipProps {
  label: string;
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function ConditionChip({ label, active, onClick, disabled, className }: ConditionChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`chip ${active ? 'on' : ''} ${className ?? ''}`}
    >
      {active && <span className="chip-dot" aria-hidden="true" />}
      {label}
    </button>
  );
}
