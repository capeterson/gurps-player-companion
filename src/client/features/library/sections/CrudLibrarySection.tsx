import { type ReactNode, useCallback } from 'react';
import {
  LibraryDeleteDialog,
  type LibraryListRow,
  LibrarySection,
  type LibrarySectionConfig,
} from '../LibrarySection.tsx';
import type { LibraryMutationState, LocalLibrary } from '../useLocalLibrary.ts';

/** Props every section receives from the page shell. */
export interface LibrarySectionShellProps {
  readonly campaignId: string;
  readonly library: LocalLibrary;
  readonly words: readonly string[];
  readonly active: boolean;
  readonly isOwner: boolean;
  readonly expandedId: string | null;
  readonly onToggleExpanded: (id: string) => void;
  readonly jumpSlot: HTMLElement | null;
  readonly revealId: string | null;
  readonly onRevealed: () => void;
}

/** The slice of `useLibraryEntryMutations` the shared list needs. */
export interface LibraryCrudControls {
  readonly addOpen: boolean;
  readonly setAddOpen: (open: boolean) => void;
  readonly editId: string | null;
  readonly setEditId: (id: string | null) => void;
  readonly deleteId: string | null;
  readonly setDeleteId: (id: string | null) => void;
  readonly remove: LibraryMutationState & { mutate: (id: string) => void };
}

/** One section: the generic list plus its owner-only delete confirmation. */
export function CrudLibrarySection<R extends LibraryListRow>({
  shell,
  config,
  entries,
  crud,
  renderForm,
}: {
  shell: LibrarySectionShellProps;
  config: LibrarySectionConfig<R>;
  entries: readonly R[];
  crud: LibraryCrudControls;
  renderForm: (row: R | null) => ReactNode;
}) {
  const { setEditId, setAddOpen, setDeleteId } = crud;
  const onEdit = useCallback(
    (id: string) => {
      setEditId(id);
      setAddOpen(false);
    },
    [setEditId, setAddOpen],
  );
  const onAdd = useCallback(() => {
    setAddOpen(true);
    setEditId(null);
  }, [setAddOpen, setEditId]);
  const doomed = entries.find((entry) => entry.id === crud.deleteId);
  return (
    <>
      <LibrarySection
        config={config}
        campaignId={shell.campaignId}
        entries={entries}
        words={shell.words}
        active={shell.active}
        isOwner={shell.isOwner}
        expandedId={shell.expandedId}
        onToggleExpanded={shell.onToggleExpanded}
        editId={crud.editId}
        onEdit={onEdit}
        addOpen={crud.addOpen}
        onAdd={onAdd}
        renderForm={renderForm}
        onDeleteRequest={setDeleteId}
        jumpSlot={shell.jumpSlot}
        revealId={shell.revealId}
        onRevealed={shell.onRevealed}
      />
      <LibraryDeleteDialog
        open={!!crud.deleteId}
        title={config.deleteTitle}
        name={doomed?.name}
        note={config.deleteNote}
        pending={crud.remove.isPending}
        error={crud.remove.error}
        onConfirm={() => {
          if (crud.deleteId && !crud.remove.isPending) crud.remove.mutate(crud.deleteId);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}
