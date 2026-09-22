import type { ButtonHTMLAttributes } from 'react';
import { AppIcon } from './AppIcon.tsx';

/** Canonical handle for every explicitly reorderable control in the app. */
export function DragHandle({
  className = '',
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      draggable
      title={title ?? 'Drag to reorder, or focus and use the up/down arrow keys'}
      className={`btn btn-ghost btn-xs cursor-grab px-1 text-base-content/40 active:cursor-grabbing ${className}`}
      {...props}
    >
      <AppIcon name="gripVertical" size={16} />
    </button>
  );
}
