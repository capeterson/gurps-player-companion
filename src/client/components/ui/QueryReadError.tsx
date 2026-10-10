/** One error-and-retry affordance for online reads that may otherwise look empty. */
import { useConnectionStatus } from '../../hooks/useConnectionStatus.ts';
import { isNetworkError } from '../../lib/networkErrors.ts';

export function QueryReadError({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: unknown;
  onRetry: () => void;
}) {
  const { online } = useConnectionStatus();
  if (isNetworkError(error)) {
    return (
      <output className="flex flex-wrap items-center gap-2 text-sm text-base-content/70">
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label} unavailable offline</span>
        <button type="button" className="btn btn-sm" onClick={onRetry} disabled={!online}>
          Retry
        </button>
      </output>
    );
  }
  const reason = error instanceof Error ? error.message : 'Please try again.';
  return (
    <div role="alert" className="alert alert-error flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        Couldn&apos;t load {label} — {reason}
      </span>
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
