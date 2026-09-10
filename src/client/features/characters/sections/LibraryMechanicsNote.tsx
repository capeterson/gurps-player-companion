import type { LibraryMechanics } from '../../../../shared/schemas/libraryMechanics.ts';

export function LibraryMechanicsNote({
  mechanics,
}: { mechanics: LibraryMechanics | null | undefined }) {
  if (!mechanics) return null;
  return (
    <span className="block text-xs text-base-content/60">
      {mechanics.effects === null
        ? 'Library rules unresolved — ask the GM to restore this copy.'
        : mechanics.detached
          ? 'Saved rules retained — no longer follows the library.'
          : 'Rules follow library updates.'}
      {mechanics.sourceRevision != null && ` Version ${mechanics.sourceRevision}.`}
    </span>
  );
}
