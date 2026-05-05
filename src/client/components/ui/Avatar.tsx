/**
 * Tiny initial-circle avatar. Used in member stacks, log authors,
 * and anywhere we need a visual handle for a person without a real
 * profile image.
 */
export function Avatar({
  name,
  size = 24,
  ring = true,
}: {
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`num inline-flex shrink-0 items-center justify-center rounded-full bg-base-200 text-[10px] font-medium text-base-content/70 ${
        ring ? 'border border-base-300' : ''
      }`}
      style={{ width: size, height: size }}
      aria-label={name}
      title={name}
    >
      {initial}
    </span>
  );
}

/**
 * Stacked avatar group with a `+N` overflow chip when the list is
 * longer than `max`. Negative margin makes the circles overlap.
 */
export function AvatarStack({
  names,
  size = 24,
  max = 5,
}: {
  names: readonly string[];
  size?: number;
  max?: number;
}) {
  const visible = names.slice(0, max);
  const overflow = names.length - visible.length;
  return (
    <div className="flex items-center" aria-label={`${names.length} members`}>
      {visible.map((n, i) => {
        // Members can theoretically share a display name; pair the name with
        // its position so React's reconciliation doesn't fold duplicates.
        const key = `${i}:${n}`;
        return (
          <span key={key} className={i === 0 ? '' : '-ml-2'}>
            <Avatar name={n} size={size} />
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className="num -ml-2 inline-flex items-center justify-center rounded-full bg-base-300 px-1.5 text-[10px] text-base-content/70 border border-base-300"
          style={{ height: size }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
