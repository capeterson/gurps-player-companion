/** Cancel / submit actions and the error alert shared by every library entry form. */
export function LibraryFormFooter({
  noun,
  editing,
  isPending,
  canSubmit,
  error,
  onCancel,
  onSubmit,
}: {
  /** Entry kind for the create button, e.g. "trait" → "Add trait". */
  noun: string;
  /** Editing an existing entry ("Save changes") rather than adding one. */
  editing: boolean;
  isPending: boolean;
  /** Whether the draft is valid; the submit button stays disabled otherwise. */
  canSubmit: boolean;
  error?: string | null | undefined;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onSubmit}
          disabled={isPending || !canSubmit}
        >
          {isPending ? 'Saving…' : editing ? 'Save changes' : `Add ${noun}`}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </>
  );
}
