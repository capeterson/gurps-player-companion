interface BrandMarkProps {
  className?: string;
}

/** Decorative app mark; the adjacent wordmark supplies the accessible name. */
export function BrandMark({ className = 'h-7 w-7' }: BrandMarkProps) {
  return (
    <img
      src="/icon-256.png"
      alt=""
      aria-hidden="true"
      width="256"
      height="256"
      draggable={false}
      className={`shrink-0 rounded-[8px] object-cover ${className}`}
    />
  );
}
