import { formatSigned } from '../../../../shared/format/number.ts';
import { useRollHistory } from './rollHistory.ts';

export interface RollHistoryPanelProps {
  characterId: string;
}

function formatRollTime(at: Date): string {
  return at.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatRollTimeTitle(at: Date): string {
  return at.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

/** Browse this character's device-only rolls, newest first. */
export function RollHistoryPanel({ characterId }: RollHistoryPanelProps) {
  const rolls = useRollHistory(characterId);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-base-content/50">
        Up to 250 rolls — saved on this device only and never synced.
      </p>
      {rolls.length === 0 ? (
        <p className="p-4 text-center text-sm text-base-content/50">No rolls yet.</p>
      ) : (
        <ul
          className="overflow-hidden rounded-lg border border-base-300 bg-base-100"
          aria-label="Roll history entries"
        >
          {rolls.map((roll) => (
            <li
              key={roll.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-base-200 px-3 py-2 text-sm last:border-0 hover:bg-base-200/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-base-content">{roll.label}</span>
                <time
                  className="block text-[11px] text-base-content/40"
                  dateTime={roll.at.toISOString()}
                  title={formatRollTimeTitle(roll.at)}
                >
                  {formatRollTime(roll.at)}
                </time>
              </span>
              {roll.kind === 'damage' ? (
                <span className="num flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-base-content/70">
                  <span>[{roll.dice.join(' ')}]</span>
                  <span className="font-semibold text-base-content">{roll.total}</span>
                  {roll.damageType && <span>{roll.damageType}</span>}
                </span>
              ) : (
                // Entries stored before damage rolls existed have no `kind`
                // and remain check rolls.
                <span className="num flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-base-content/70">
                  <span>vs {roll.target}</span>
                  <span>[{roll.dice.join(' ')}]</span>
                  <span className="font-semibold text-base-content">{roll.total}</span>
                  <span>{formatSigned(roll.margin ?? 0)}</span>
                  {roll.crit && (
                    <span
                      className={`badge badge-xs ${roll.crit === 'success' ? 'badge-success' : 'badge-error'}`}
                      title={
                        roll.manaDisaster
                          ? 'Very high mana: critical failure and spectacular disaster'
                          : undefined
                      }
                    >
                      {roll.manaDisaster
                        ? 'disaster'
                        : roll.crit === 'success'
                          ? 'crit'
                          : 'crit fail'}
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
