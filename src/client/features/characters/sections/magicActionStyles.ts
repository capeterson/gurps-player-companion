/**
 * Shared Magic-tab row action sizes. Actions are compact with a fine pointer
 * and keep a 44px target on touch screens. Cost-carrying buttons use minimum
 * widths so actions occupy the same slot in every row.
 */
export const MAGIC_ACTION_CLASS =
  'btn btn-sm h-8 min-h-8 justify-between gap-2 whitespace-nowrap px-3 pointer-coarse:h-11 pointer-coarse:min-h-11';
export const MAGIC_ICON_ACTION_CLASS =
  'btn btn-ghost btn-sm btn-square h-8 min-h-8 w-8 pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:w-11';
/** Cast keeps a visible tinted fill and edge in both light and dark themes. */
export const MAGIC_CAST_CLASS = `${MAGIC_ACTION_CLASS} btn-soft btn-primary min-w-20 border-primary/30 bg-primary/15 hover:bg-primary/25`;
