/**
 * Tappable skill/spell level for a table row's "Lvl" column. A computed
 * level opens the Play Mode roll sheet for that target (dispatch only —
 * it mutates nothing, so read-only viewers can roll too); a null level
 * (e.g. a 0-point Very Hard skill, which has no attribute default —
 * B173/B170) stays a plain em-dash, matching the pre-existing display.
 */
interface RollLevelChipProps {
  level: number | null;
  /** The skill/spell name, used to build the "{name} level" / "Roll {name}" labels. */
  name: string;
  /** Overrides the null-level span's title (e.g. an explanatory B173 note). */
  title?: string | undefined;
  onRoll: (level: number) => void;
}

export function RollLevelChip({ level, name, title, onRoll }: RollLevelChipProps) {
  if (level == null) {
    return (
      <span className="num text-right font-medium" aria-label={`${name} level`} title={title}>
        —
      </span>
    );
  }
  return (
    <button
      type="button"
      className="num rounded-md bg-primary/10 px-2 py-0.5 text-right text-base font-bold text-primary transition hover:bg-primary/20"
      aria-label={`Roll ${name}`}
      title={`Roll ${name}`}
      onClick={() => onRoll(level)}
    >
      {level}
    </button>
  );
}
